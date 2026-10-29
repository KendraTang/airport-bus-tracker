import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExternalLog, readExternalLogs, type RawExternalLog } from '../src/export/external.ts';

const stops = [
  { seq: 1, stopUID: 'A', name: 'A' },
  { seq: 2, stopUID: 'B', name: 'B' },
];

function raw(trips: RawExternalLog['trips']): RawExternalLog {
  return { source: { app: '', package: '', version: '', view: '', retrievedAt: '', method: '' }, notes: [], stops, trips };
}

test('gaps are estimated from trips of the same rank, and trips are sorted first trips first, newest first', () => {
  const log = buildExternalLog(
    raw([
      { date: '2026-10-28', weekday: '三', rank: 1, plate: 'X', times: { A: '05:33', B: '05:37' } },
      { date: '2026-10-28', weekday: '三', rank: 2, plate: 'Y', times: { A: '06:20', B: '06:30' } },
      { date: '2026-10-29', weekday: '四', rank: 1, plate: 'X', times: { A: '05:33', B: null }, nextEvent: { label: '回程', time: '05:54' } },
    ]),
  );
  assert.deepEqual(
    log.trips.map((t) => [t.date, t.rank]),
    [
      ['2026-10-29', 1],
      ['2026-10-28', 1],
      ['2026-10-28', 2],
    ],
  );
  assert.deepEqual(log.trips[0]!.stopTimes, [
    { state: 'observed', time: '05:33' },
    { state: 'estimated', time: '05:37', lower: '05:33', upper: '05:54' },
  ]);
});

test('the committed app driving log resolves every gap and keeps observed times as recorded', () => {
  const [file] = readExternalLogs('data');
  assert.ok(file, 'expected data/external/app-driving-log to contain a file');
  const log = buildExternalLog(file);
  for (const trip of log.trips) {
    const rawTrip = file.trips.find((t) => t.date === trip.date && t.rank === trip.rank)!;
    trip.stopTimes.forEach((st, i) => {
      const recorded = rawTrip.times[file.stops[i]!.stopUID];
      if (recorded != null) assert.deepEqual(st, { state: 'observed', time: recorded });
      else assert.notEqual(st.state, 'observed');
    });
  }
});
