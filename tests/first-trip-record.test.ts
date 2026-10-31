import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { eventIndex, eventMedians, findFirstTrip, resolveFirstTrip, tripEvents } from '../src/analysis/first-trip-record.ts';
import type { A2Record } from '../src/collector/first-trip.ts';
import { buildFirstTripLog, readDayRecords } from '../src/export/first-trips.ts';

// Real records: 10/30 has the first trip only; 10/31 has every trip of the day, polled every minute.
const DAY = '2026-10-31';
const records = readDayRecords('data', DAY);
const rule = (earliestTripStart: string) => ({ direction: 0, earliestTripStart });
const FIRST = rule('04:30');
const STOPS = 6;

// Seconds since midnight to HH:MM:SS, for readable assertions.
const clock = (s: number | null) =>
  s === null ? null : [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');

function eventsOf(earliestTripStart: string, recs: A2Record[] = records) {
  const target = findFirstTrip(recs, DAY, rule(earliestTripStart));
  assert.ok(target);
  return tripEvents(recs, target, DAY, rule(earliestTripStart), STOPS);
}

test('events are laid out as departure, then arrival and departure at each stop in between, then arrival', () => {
  assert.equal(eventIndex(1, 0, 6), 0);
  assert.equal(eventIndex(1, 1, 6), null);
  assert.equal(eventIndex(2, 1, 6), 1);
  assert.equal(eventIndex(5, 0, 6), 8);
  assert.equal(eventIndex(6, 1, 6), 9);
  assert.equal(eventIndex(6, 0, 6), null);
});

test('the first trip is the earliest airport-bound trip that left on the service date', () => {
  assert.deepEqual(findFirstTrip(records, DAY, FIRST), { plate: 'KKB-2179', tripStartTime: '2026-10-31T04:42:13+08:00' });
  // On 10/30 the file also has a test poll at 01:04, which only showed trips of the previous day.
  assert.deepEqual(findFirstTrip(readDayRecords('data', '2026-10-30'), '2026-10-30', FIRST), {
    plate: 'KKB-2179',
    tripStartTime: '2026-10-30T04:41:07+08:00',
  });
});

test('a normal arrival: every stop observed except the T2 arrival', () => {
  const events = eventsOf('04:30');
  assert.deepEqual(events.times.map(clock), [
    '04:42:13',
    '04:46:42',
    '04:47:48',
    '04:53:47',
    '04:54:46',
    '04:57:22',
    '04:58:28',
    null,
    '05:34:32',
    '05:37:21',
  ]);
});

test('later trips of the same vehicle do not leak into its first trip', () => {
  // KKB-2179 ran the 05:56 trip to Taipei and the 07:24 trip to the airport the same morning.
  const events = eventsOf('04:30');
  assert.ok(events.times.every((t) => t === null || t < 6 * 3600));
});

test('a missing stop is bounded by the records before and after it', () => {
  const stops = resolveFirstTrip(eventsOf('04:30'), Array(9).fill(null), false);
  assert.deepEqual(stops[4]!.arrival, { state: 'interval', lower: 4 * 3600 + 58 * 60 + 28, upper: 5 * 3600 + 34 * 60 + 32 });
  assert.equal(stops[0]!.arrival, null);
  assert.equal(stops[5]!.departure, null);
});

test('a missing T1 arrival is bounded by the departure from T1', () => {
  // The 16:00 trip: no arrival event at T1, only the departure 1 minute later.
  // Its first-stop arrival came with a start time 2 minutes earlier, which counts as the same trip.
  const events = eventsOf('15:50');
  assert.equal(events.target.plate, 'KKA-9833');
  assert.equal(clock(events.times[0]), '16:03:15');
  assert.equal(clock(events.times[9]), null);
  assert.equal(clock(events.after), '17:28:47');
  const t1 = resolveFirstTrip(events, Array(9).fill(null), false)[5]!.arrival;
  assert.deepEqual(t1, { state: 'interval', lower: 17 * 3600 + 25 * 60 + 36, upper: 17 * 3600 + 28 * 60 + 47 });
});

test('without any T1 event, the vehicle\'s next trip bounds the arrival', () => {
  // The 06:00 trip left T2 at 06:58 and has no event at T1; the same bus left on its next trip at 07:37.
  const events = eventsOf('05:50');
  assert.equal(events.target.plate, 'KKB-2187');
  assert.equal(clock(events.after), '07:37:13');
});

test('stops after the last record are marked as not arrived when collection stopped early', () => {
  const until = Date.parse(`${DAY}T05:20:00+08:00`);
  const early = readFileSync(`data/raw/local/${DAY}/a2.jsonl`, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { fetchedAt: string; body: A2Record[] })
    .filter((p) => Date.parse(p.fetchedAt) < until)
    .flatMap((p) => p.body);
  const events = eventsOf('04:30', early);
  const stops = resolveFirstTrip(events, eventMedians([eventsOf('04:30')]), true);
  const fuhua = 4 * 3600 + 58 * 60 + 28;
  assert.deepEqual(stops[4]!.arrival, { state: 'not_arrived_by_cutoff', lower: fuhua });
  assert.deepEqual(stops[5]!.arrival, { state: 'not_arrived_by_cutoff', lower: fuhua });
  // Without the early stop, the same gap is only open-ended (no day has a T2 arrival to estimate from).
  assert.deepEqual(resolveFirstTrip(events, eventMedians([eventsOf('04:30')]), false)[5]!.arrival, { state: 'interval', lower: fuhua, upper: null });
});

test('the site table has one row per day, newest first, with times in Asia/Taipei', () => {
  const stops = Array.from({ length: STOPS }, (_, k) => ({ seq: k + 1, stopUID: `S${k + 1}`, name: `S${k + 1}` }));
  const log = buildFirstTripLog(
    [
      { date: '2026-10-30', records: readDayRecords('data', '2026-10-30'), run: { endedAt: '2026-10-30T05:40:03+08:00', stopReason: 'arrived' } },
      { date: DAY, records, run: { endedAt: '2026-10-31T05:38:01+08:00', stopReason: 'arrived' } },
      { date: '2026-11-02', records: [], run: { endedAt: '2026-11-02T07:30:00+08:00', stopReason: 'cutoff' } },
    ],
    stops,
    FIRST,
  );
  assert.deepEqual(
    log.days.map((d) => [d.date, d.weekday, d.plate]),
    [
      ['2026-11-02', '一', null],
      [DAY, '六', 'KKB-2179'],
      ['2026-10-30', '五', 'KKB-2179'],
    ],
  );
  const oct31 = log.days[1]!.stopTimes;
  assert.deepEqual(oct31[0], { arrival: null, departure: { state: 'observed', time: '04:42' } });
  assert.deepEqual(oct31[5], { arrival: { state: 'observed', time: '05:37' }, departure: null });
  assert.deepEqual(oct31[4]!.arrival, { state: 'interval', lower: '04:58', upper: '05:34' });
  assert.deepEqual(log.days[0]!.stopTimes[1], { arrival: { state: 'missing' }, departure: { state: 'missing' } });
});
