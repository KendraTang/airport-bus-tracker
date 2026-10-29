// Collect real-time A2 and A1 for the first morning trip of the route, until it reaches the destination stop.
//
//   npm run collect            daily run, started by cron at 04:40
//   npm run collect -- --once  single poll, ignores the cutoff (for testing)

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { COLLECT, PATHS, ROUTE } from '../config.ts';
import { newTracker, updateTracker, type A2Record, type TrackerState } from '../collector/first-trip.ts';
import { TdxClient, type TdxResponse } from '../tdx/client.ts';
import { BudgetExceededError } from '../tdx/usage.ts';
import { taipeiIso, taipeiParts } from '../time.ts';

const once = process.argv.includes('--once');

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

    if (a2.status === 200) {
      const records = JSON.parse(a2.text) as A2Record[];
      state = updateTracker(state, records, {
        direction: ROUTE.direction,
        destinationStopUID: ROUTE.destinationStopUID,
        earliestTripStart: COLLECT.earliestTripStart,
      });
    } else {
      failures++;
    }
    log(`poll ${polls}: a2 HTTP ${a2.status} (${a2.bytes}B), a1 HTTP ${a1.status} (${a1.bytes}B), target=${state.target ? `${state.target.plate}@${state.target.tripStartTime}` : 'none'}`);
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
  await sleep(Math.max(0, COLLECT.intervalMs - (Date.now() - pollStart)));
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
