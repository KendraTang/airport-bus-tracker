// Collect real-time A2 and A1 for the first morning trip of the route, until it reaches the destination stop.
// Polling pauses while the vehicle is far from the next stops (see nextPollDelay in collector/first-trip.ts).
// On full-day dates (see collector/full-day.ts) it then keeps polling A2 for every trip until service ends.
//
//   npm run collect            daily run, started by cron at 04:40
//   npm run collect -- --once  single poll, ignores the cutoff (for testing)
//
// Afterwards the data is committed and pushed (see collector/publish.ts); --no-publish skips that.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BUDGET, COLLECT, FULL_DAY, PATHS, ROUTE } from '../config.ts';
import {
  newTracker,
  nextPollDelay,
  updateTracker,
  type A1Record,
  type A2Record,
  type TrackerOptions,
  type TrackerState,
} from '../collector/first-trip.ts';
import { chooseFullDayTier, dayStopReason, isFullDayDate, newDayLog, recordDayPoll } from '../collector/full-day.ts';
import { publishData } from '../collector/publish.ts';
import { TdxClient, type TdxResponse } from '../tdx/client.ts';
import { BudgetExceededError, monthPoints } from '../tdx/usage.ts';
import { taipeiIso, taipeiParts } from '../time.ts';

const once = process.argv.includes('--once');
const publish = !process.argv.includes('--no-publish');

// A full-day run lasts until the next morning, and may be started by hand before the cron run, so only one collector
// may run at a time. A lock left by a process that no longer exists is taken over.
const LOCK_FILE = join('logs', 'collect.lock');
function acquireLock(): boolean {
  mkdirSync('logs', { recursive: true });
  try {
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    try {
      process.kill(Number(readFileSync(LOCK_FILE, 'utf8')), 0);
      return false;
    } catch {
      writeFileSync(LOCK_FILE, String(process.pid));
      return true;
    }
  }
}
if (!acquireLock()) {
  console.log(`another collector holds ${LOCK_FILE}; exiting`);
  process.exit(0);
}
process.on('exit', () => {
  if (existsSync(LOCK_FILE) && readFileSync(LOCK_FILE, 'utf8') === String(process.pid)) rmSync(LOCK_FILE);
});

if (existsSync('.env')) process.loadEnvFile('.env');
const { TDX_CLIENT_ID, TDX_CLIENT_SECRET } = process.env;
if (!TDX_CLIENT_ID || !TDX_CLIENT_SECRET) {
  console.error('TDX_CLIENT_ID and TDX_CLIENT_SECRET must be set');
  process.exit(1);
}

const client = new TdxClient({
  clientId: TDX_CLIENT_ID,
  clientSecret: TDX_CLIENT_SECRET,
  source: COLLECT.source,
  dataDir: PATHS.dataDir,
});

const startedAt = new Date();
const serviceDate = taipeiParts(startedAt).date;
const outDir = join(PATHS.dataDir, 'raw', COLLECT.source, serviceDate);
mkdirSync(outDir, { recursive: true });

const filter = encodeURIComponent(`RouteName/Zh_tw eq '${ROUTE.routeName}'`);
const endpoints = {
  a2: `/v2/Bus/RealTimeNearStop/InterCity?$filter=${filter}&$format=JSON`,
  a1: `/v2/Bus/RealTimeByFrequency/InterCity?$filter=${filter}&$format=JSON`,
} as const;

function log(message: string): void {
  console.log(`[${taipeiIso(new Date())}] ${message}`);
}

// Responses are kept whole; only an envelope with the fetch time and status is added.
function save(name: string, res: TdxResponse): void {
  let body: unknown;
  try {
    body = JSON.parse(res.text);
  } catch {
    body = undefined;
  }
  const line = { fetchedAt: res.fetchedAt, status: res.status, bytes: res.bytes, ...(body === undefined ? { bodyText: res.text } : { body }) };
  appendFileSync(join(outDir, `${name}.jsonl`), JSON.stringify(line) + '\n');
}

const trackerOptions: TrackerOptions = {
  direction: ROUTE.direction,
  destinationStopUID: ROUTE.destinationStopUID,
  earliestTripStart: COLLECT.earliestTripStart,
  stops: ROUTE.stops,
  maxSpeedKmh: COLLECT.maxSpeedKmh,
  stallMs: COLLECT.stallMs,
  progressMeters: COLLECT.progressMeters,
  nearDestinationMeters: COLLECT.nearDestinationMeters,
  nearDestinationGraceMs: COLLECT.nearDestinationGraceMs,
};

function parseRecords<T>(res: TdxResponse): T[] | null {
  if (res.status !== 200) return null;
  try {
    return JSON.parse(res.text) as T[];
  } catch {
    return null;
  }
}

// Decided up front, because on full-day dates the first-trip pauses are capped to keep every trip covered.
const fullDay =
  !once && isFullDayDate(serviceDate, FULL_DAY)
    ? chooseFullDayTier(serviceDate, monthPoints(PATHS.dataDir, taipeiParts(startedAt).month), BUDGET.monthlyPoints - BUDGET.reservePoints, FULL_DAY)
    : null;
if (!once && isFullDayDate(serviceDate, FULL_DAY)) {
  log(fullDay ? `full-day date: will continue after the first trip (${fullDay.name})` : 'full-day date skipped: not enough budget left');
}

let state: TrackerState = newTracker(serviceDate);
let polls = 0;
let failures = 0;
let stopReason = '';

while (true) {
  const pollStart = Date.now();
  if (!once && taipeiParts(new Date()).hhmm >= COLLECT.cutoff) {
    stopReason = 'cutoff';
    break;
  }

  polls++;
  try {
    const a2 = await client.get('basic', endpoints.a2);
    save('a2', a2);
    const a1 = await client.get('basic', endpoints.a1);
    save('a1', a1);

    const a2Records = parseRecords<A2Record>(a2);
    if (a2Records) {
      state = updateTracker(state, { at: a2.fetchedAt, a2: a2Records, a1: parseRecords<A1Record>(a1) }, trackerOptions);
    } else {
      failures++;
    }
    log(`poll ${polls}: a2 HTTP ${a2.status} (${a2.bytes}B), a1 HTTP ${a1.status} (${a1.bytes}B), target=${state.target ? `${state.target.plate}@${state.target.tripStartTime}` : 'none'}, seen stop ${state.seenSeq}`);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      stopReason = 'budget';
      log(err.message);
      break;
    }
    failures++;
    log(`poll ${polls} failed: ${(err as Error).message}`);
  }

  if (state.done) {
    stopReason = state.done.reason;
    break;
  }
  if (once) {
    stopReason = 'once';
    break;
  }
  let delay = nextPollDelay(state, trackerOptions, new Date(pollStart), COLLECT.intervalMs);
  if (fullDay) delay = Math.min(delay, fullDay.intervalMs);
  if (delay > COLLECT.intervalMs) log(`pausing ${delay / 60_000} min: the target cannot reach the next stop sooner`);
  await sleep(Math.max(0, delay - (Date.now() - pollStart)));
}

const run = {
  source: COLLECT.source,
  serviceDate,
  startedAt: taipeiIso(startedAt),
  endedAt: taipeiIso(new Date()),
  mode: once ? 'once' : 'daily',
  polls,
  failures,
  stopReason,
  target: state.target,
  arrival: state.done,
};
appendFileSync(join(outDir, 'runs.jsonl'), JSON.stringify(run) + '\n');
log(`done: ${JSON.stringify(run)}`);

function publishNow(): void {
  if (!publish) return;
  const result = publishData({ repoDir: '.', dataDir: PATHS.dataDir, source: COLLECT.source, serviceDate, branch: COLLECT.publishBranch });
  log(`publish: ${JSON.stringify(result)}`);
}

publishNow();

if (fullDay && stopReason !== 'budget') {
  const dayStartedAt = new Date();
  const day = newDayLog(serviceDate, dayStartedAt);
  let dayFailures = 0;
  let dayStopReasonText = '';
  while (true) {
    const pollStart = Date.now();
    const reason = dayStopReason(day, new Date(), FULL_DAY, fullDay);
    if (reason) {
      dayStopReasonText = reason;
      break;
    }
    try {
      const a2 = await client.get('basic', endpoints.a2);
      save('a2', a2);
      const a1 = fullDay.withA1 ? await client.get('basic', endpoints.a1) : null;
      if (a1) save('a1', a1);
      const records = parseRecords<A2Record>(a2);
      if (records) {
        const added = recordDayPoll(day, records, new Date(), FULL_DAY);
        log(`full-day poll ${day.polls}: a2 HTTP ${a2.status} (${a2.bytes}B)${a1 ? `, a1 HTTP ${a1.status} (${a1.bytes}B)` : ''}, ${added} new events, ${day.seen.size} in total`);
      } else {
        day.polls++;
        dayFailures++;
        log(`full-day poll ${day.polls}: a2 HTTP ${a2.status}`);
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        dayStopReasonText = 'budget';
        log(err.message);
        break;
      }
      day.polls++;
      dayFailures++;
      log(`full-day poll ${day.polls} failed: ${(err as Error).message}`);
    }
    await sleep(Math.max(0, fullDay.intervalMs - (Date.now() - pollStart)));
  }

  const dayRun = {
    source: COLLECT.source,
    serviceDate,
    startedAt: taipeiIso(dayStartedAt),
    endedAt: taipeiIso(new Date()),
    mode: 'full-day',
    tier: fullDay.name,
    polls: day.polls,
    failures: dayFailures,
    stopReason: dayStopReasonText,
    events: day.seen.size,
  };
  appendFileSync(join(outDir, 'runs.jsonl'), JSON.stringify(dayRun) + '\n');
  log(`full-day done: ${JSON.stringify(dayRun)}`);
  publishNow();
}
