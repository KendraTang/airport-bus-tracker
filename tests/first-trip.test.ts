import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  newTracker,
  nextPollDelay,
  updateTracker,
  type A1Record,
  type A2Record,
  type TrackerOptions,
  type TrackerState,
} from '../src/collector/first-trip.ts';
import { COLLECT, ROUTE } from '../src/config.ts';

const DATE = '2026-10-30';
const MIN = 60_000;

// Stops on a line of longitude, 1 km apart; T1 is 30.5 km past S5.
const KM_LAT = 1 / 111.195;
const stops = [
  ...[1, 2, 3, 4, 5].map((seq) => ({ seq, stopUID: `S${seq}`, lat: 25 + (seq - 1) * KM_LAT, lon: 121.5 })),
  { seq: 6, stopUID: 'T1', lat: 25 + 34.5 * KM_LAT, lon: 121.5 },
];
const opts: TrackerOptions = {
  direction: 0,
  destinationStopUID: 'T1',
  earliestTripStart: '04:30',
  stops,
  maxSpeedKmh: 120,
  stallMs: 20 * MIN,
  progressMeters: 300,
  nearDestinationMeters: 150,
  nearDestinationGraceMs: 2 * MIN,
};

const at = (hhmm: string, ss = '00') => `${DATE}T${hhmm}:${ss}+08:00`;

function a2(plate: string, stop: string, tripStart: string | null, gps: string, overrides: Partial<A2Record> = {}): A2Record {
  return {
    PlateNumb: plate,
    Direction: 0,
    StopUID: stop,
    StopSequence: 1,
    A2EventType: 1,
    GPSTime: at(gps),
    TripStartTime: tripStart === null ? null : at(tripStart),
    ...overrides,
  };
}

// An A1 position `km` kilometres north of S1.
function a1(plate: string, km: number, gps: string, overrides: Partial<A1Record> = {}): A1Record {
  return { PlateNumb: plate, Direction: 0, BusPosition: { PositionLat: 25 + km * KM_LAT, PositionLon: 121.5 }, GPSTime: at(gps), ...overrides };
}

function update(s: TrackerState, time: string, a2s: A2Record[], a1s: A1Record[] | null = []): TrackerState {
  return updateTracker(s, { at: at(time), a2: a2s, a1: a1s }, opts);
}

test('no target before the first trip departs', () => {
  const s = update(newTracker(DATE), '04:40', []);
  assert.equal(s.target, null);
  assert.equal(s.done, null);
});

test('picks the earliest trip that started after the earliest allowed start', () => {
  const s = update(newTracker(DATE), '04:58', [
    a2('LATE', 'S2', '04:55', '04:58'),
    a2('FIRST', 'S3', '04:41', '04:52'),
    a2('NIGHT', 'S5', '04:10', '04:50'),
  ]);
  assert.deepEqual(s.target, { plate: 'FIRST', tripStartTime: at('04:41') });
  assert.equal(s.done, null);
});

test('ignores trips that started on the previous service date', () => {
  const s = update(newTracker(DATE), '04:45', [a2('OLD', 'S2', null, '04:45', { TripStartTime: '2026-10-29T23:30:00+08:00' })]);
  assert.equal(s.target, null);
});

test('finishes when the target trip reaches the destination stop', () => {
  let s = update(newTracker(DATE), '04:52', [a2('FIRST', 'S3', '04:41', '04:52')]);
  s = update(s, '05:48', [a2('FIRST', 'T1', '04:41', '05:48', { A2EventType: 1 })]);
  assert.deepEqual(s.done, { reason: 'arrived', gpsTime: at('05:48'), eventType: 1 });
});

test('does not finish when another trip reaches the destination stop', () => {
  let s = update(newTracker(DATE), '04:52', [a2('FIRST', 'S3', '04:41', '04:52')]);
  s = update(s, '05:41', [a2('FIRST', 'S5', '04:41', '05:40'), a2('OTHER', 'T1', '05:00', '05:41')]);
  assert.equal(s.done, null);
});

test('treats a small revision of an estimated start time as the same trip', () => {
  let s = update(newTracker(DATE), '04:52', [a2('FIRST', 'S3', '04:41', '04:52')]);
  s = update(s, '05:48', [a2('FIRST', 'T1', '04:44', '05:48')]);
  assert.equal(s.done?.reason, 'arrived');
});

test('stops when the target vehicle starts a return trip without a destination event', () => {
  let s = update(newTracker(DATE), '05:40', [a2('FIRST', 'S5', '04:41', '05:40')]);
  s = update(s, '06:12', [a2('FIRST', 'R1', '06:10', '06:12', { Direction: 1 })]);
  assert.equal(s.done?.reason, 'trip-ended-without-arrival-event');
});

test('a record without a trip start time does not end the trip', () => {
  let s = update(newTracker(DATE), '04:52', [a2('FIRST', 'S3', '04:41', '04:52')]);
  s = update(s, '04:58', [a2('FIRST', 'S4', null, '04:58')]);
  assert.equal(s.done, null);
});

test('state stays finished once done', () => {
  let s = update(newTracker(DATE), '05:48', [a2('FIRST', 'T1', '04:41', '05:48')]);
  const done = s.done;
  s = update(s, '06:12', [a2('FIRST', 'R1', '06:10', '06:12', { Direction: 1 })]);
  assert.deepEqual(s.done, done);
});

test('records the highest stop seen for the target trip', () => {
  let s = update(newTracker(DATE), '04:52', [a2('FIRST', 'S3', '04:41', '04:52', { StopSequence: 3 })]);
  s = update(s, '04:53', [a2('FIRST', 'S2', '04:41', '04:53', { StopSequence: 2 }), a2('OTHER', 'S5', '04:50', '04:53', { StopSequence: 5 })]);
  assert.equal(s.seenSeq, 3);
});

// Pacing

test('polls every interval until the target has a position', () => {
  const s = update(newTracker(DATE), '04:52', [a2('FIRST', 'S3', '04:41', '04:52', { StopSequence: 3 })]);
  assert.equal(nextPollDelay(s, opts, new Date(at('04:52')), MIN), MIN);
});

test('pauses until one interval before the earliest possible arrival at the next stop', () => {
  // Seen at S5, 4 km along; T1 is 30.5 km away, which takes at least 15.25 min at 120 km/h.
  const s = update(newTracker(DATE), '05:00', [a2('FIRST', 'S5', '04:41', '05:00', { StopSequence: 5 })], [a1('FIRST', 4, '05:00')]);
  assert.equal(nextPollDelay(s, opts, new Date(at('05:00')), MIN), 14 * MIN);
});

test('an older position shortens the pause', () => {
  const s = update(newTracker(DATE), '05:00', [a2('FIRST', 'S5', '04:41', '04:58', { StopSequence: 5 })], [a1('FIRST', 4, '04:58')]);
  assert.equal(nextPollDelay(s, opts, new Date(at('05:00')), MIN), 12 * MIN);
});

test('a stop without an A2 event still counts as ahead, so a gap never makes the pause longer', () => {
  // Seen at S4 only; S5 was passed without an event, and the vehicle is 0.5 km past it.
  const s = update(newTracker(DATE), '05:00', [a2('FIRST', 'S4', '04:41', '04:58', { StopSequence: 4 })], [a1('FIRST', 4.5, '05:00')]);
  assert.equal(nextPollDelay(s, opts, new Date(at('05:00')), MIN), MIN);
});

test('keeps the last position when the A1 request fails', () => {
  let s = update(newTracker(DATE), '05:00', [a2('FIRST', 'S5', '04:41', '05:00', { StopSequence: 5 })], [a1('FIRST', 4, '05:00')]);
  s = update(s, '05:01', [a2('FIRST', 'S5', '04:41', '05:00', { StopSequence: 5 })], null);
  assert.equal(nextPollDelay(s, opts, new Date(at('05:01')), MIN), 13 * MIN);
});

// Stop conditions based on position

test('stops when the target has not moved closer for the stall period', () => {
  const ev = a2('FIRST', 'S5', '04:41', '05:00', { StopSequence: 5 });
  let s = update(newTracker(DATE), '05:00', [ev], [a1('FIRST', 10, '05:00')]);
  s = update(s, '05:10', [ev], [a1('FIRST', 10.2, '05:10')]);
  assert.equal(s.done, null);
  s = update(s, '05:20', [ev], [a1('FIRST', 10.2, '05:20')]);
  assert.deepEqual(s.done, { reason: 'stalled', gpsTime: at('05:20'), eventType: null });
});

test('moving closer resets the stall period', () => {
  const ev = a2('FIRST', 'S5', '04:41', '05:00', { StopSequence: 5 });
  let s = update(newTracker(DATE), '05:00', [ev], [a1('FIRST', 10, '05:00')]);
  s = update(s, '05:15', [ev], [a1('FIRST', 10.4, '05:15')]);
  s = update(s, '05:30', [ev], [a1('FIRST', 10.5, '05:30')]);
  assert.equal(s.done, null);
  s = update(s, '05:35', [ev], [a1('FIRST', 10.5, '05:35')]);
  assert.equal(s.done?.reason, 'stalled');
});

test('a new A2 event resets the stall period', () => {
  let s = update(newTracker(DATE), '05:00', [a2('FIRST', 'S4', '04:41', '05:00', { StopSequence: 4 })], [a1('FIRST', 3, '05:00')]);
  s = update(s, '05:15', [a2('FIRST', 'S4', '04:41', '05:14', { StopSequence: 4, A2EventType: 0 })], [a1('FIRST', 3, '05:15')]);
  s = update(s, '05:30', [a2('FIRST', 'S4', '04:41', '05:14', { StopSequence: 4, A2EventType: 0 })], [a1('FIRST', 3, '05:30')]);
  assert.equal(s.done, null);
});

test('never stalls without an A1 position of the target', () => {
  const ev = a2('FIRST', 'S4', '04:41', '04:58', { StopSequence: 4 });
  let s = update(newTracker(DATE), '05:00', [ev], []);
  s = update(s, '05:40', [ev], null);
  s = update(s, '06:20', [ev], [a1('OTHER', 3, '06:20')]);
  assert.equal(s.done, null);
});

test('arrives by position when no A2 event follows within the grace period', () => {
  const ev = a2('FIRST', 'S5', '04:41', '05:20', { StopSequence: 5 });
  let s = update(newTracker(DATE), '05:39', [ev], [a1('FIRST', 34.45, '05:38', { GPSTime: at('05:38', '40') })]);
  s = update(s, '05:40', [ev], [a1('FIRST', 34.5, '05:39')]);
  assert.equal(s.done, null);
  s = update(s, '05:41', [ev], [a1('FIRST', 34.5, '05:40')]);
  assert.deepEqual(s.done, { reason: 'reached-by-position', gpsTime: at('05:38', '40'), eventType: null });
});

test('an A2 destination event within the grace period wins', () => {
  const ev = a2('FIRST', 'S5', '04:41', '05:20', { StopSequence: 5 });
  let s = update(newTracker(DATE), '05:39', [ev], [a1('FIRST', 34.5, '05:38')]);
  s = update(s, '05:40', [a2('FIRST', 'T1', '04:41', '05:39')], [a1('FIRST', 34.5, '05:39')]);
  assert.equal(s.done?.reason, 'arrived');
});

// Replay of the 2026-10-30 run, which polled every minute.

type Line<T> = { fetchedAt: string; status: number; body: T[] };
function readLines<T>(name: string): Line<T>[] {
  return readFileSync(`data/raw/local/2026-10-30/${name}.jsonl`, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line<T>)
    .filter((l) => l.fetchedAt >= at('04:40'));
}

const realOpts: TrackerOptions = { ...opts, ...COLLECT, destinationStopUID: ROUTE.destinationStopUID, stops: ROUTE.stops };
const TARGET = 'KKB-2179';
const eventKey = (r: A2Record) => `${r.StopSequence}/${r.A2EventType}/${r.GPSTime}`;

function replay(dropA2: (r: A2Record) => boolean = () => false) {
  const a2Lines = readLines<A2Record>('a2');
  const a1Lines = readLines<A1Record>('a1');
  let s = newTracker(DATE);
  let polls = 0;
  const events = new Set<string>();
  for (let i = 0; i < a2Lines.length && !s.done; ) {
    polls++;
    const a2s = a2Lines[i]!.body.filter((r) => !dropA2(r));
    for (const r of a2s) if (r.PlateNumb === TARGET && r.Direction === 0) events.add(eventKey(r));
    s = updateTracker(s, { at: a2Lines[i]!.fetchedAt, a2: a2s, a1: a1Lines[i]!.body }, realOpts);
    i += Math.round(nextPollDelay(s, realOpts, new Date(a2Lines[i]!.fetchedAt), MIN) / MIN);
  }
  return { s, polls, events };
}

test('replay: pausing keeps every A2 event the per-minute run saw', () => {
  const full = replay();
  const everyMinute = new Set(
    readLines<A2Record>('a2').flatMap((l) => l.body.filter((r) => r.PlateNumb === TARGET && r.Direction === 0).map(eventKey)),
  );
  assert.equal(full.s.done?.reason, 'arrived');
  assert.deepEqual([...full.events].sort(), [...everyMinute].sort());
  assert.ok(full.polls <= 40, `expected at most 40 polls, got ${full.polls}`);
});

test('replay: a missing stop shortens the pause but still reaches the destination', () => {
  const full = replay();
  const gap = replay((r) => r.StopUID === 'THB255379');
  assert.equal(gap.s.done?.reason, 'arrived');
  assert.ok(gap.polls > full.polls);
});

test('replay: without the destination event the run keeps going and notes the position', () => {
  const gap = replay((r) => r.StopUID === ROUTE.destinationStopUID);
  assert.equal(gap.s.done, null);
  assert.equal(gap.s.nearDestinationAt, '2026-10-30T05:39:43+08:00');
});
