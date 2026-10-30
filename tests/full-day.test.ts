import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { A2Record } from '../src/collector/first-trip.ts';
import { chooseFullDayTier, dayStopReason, isFullDayDate, newDayLog, recordDayPoll, type FullDayOptions } from '../src/collector/full-day.ts';

const opts: FullDayOptions = {
  epoch: '2026-11-01',
  everyDays: 6,
  tiers: [
    { name: 'dense', intervalMs: 60_000, withA1: true, maxPolls: 1400, estimatedPoints: 2.3 },
    { name: 'sparse', intervalMs: 3 * 60_000, withA1: false, maxPolls: 450, estimatedPoints: 0.32 },
  ],
  lastTrip: { direction: 1, departsNextDay: '00:15', terminalStopUID: 'CITY' },
  lastTripMaxMs: 2 * 3600_000,
  quietMs: 30 * 60_000,
  endBy: '04:30',
  firstTripDailyPoints: 0.06,
};

const t = (iso: string) => new Date(`${iso}+08:00`);

function ev(plate: string, seq: number, gps: string, overrides: Partial<A2Record> = {}): A2Record {
  return { PlateNumb: plate, Direction: 0, StopSequence: seq, A2EventType: 0, GPSTime: `${gps}+08:00`, TripStartTime: null, ...overrides };
}

// An arrival at the terminal stop of a trip in the direction of the last trip.
function terminal(plate: string, tripStart: string, gps: string): A2Record {
  return ev(plate, 9, gps, { Direction: 1, StopUID: 'CITY', A2EventType: 1, TripStartTime: `${tripStart}+08:00` });
}

test('full-day dates repeat every few days from the epoch, rotating the weekday', () => {
  const dates = ['2026-10-31', '2026-11-01', '2026-11-05', '2026-11-07', '2026-11-13', '2026-12-01'];
  assert.deepEqual(
    dates.filter((d) => isFullDayDate(d, opts)),
    ['2026-11-01', '2026-11-07', '2026-11-13', '2026-12-01'],
  );
  assert.equal(isFullDayDate('2026-10-31', opts), false);
});

const sparse = opts.tiers[1]!;

test('uses the densest tier the budget allows, keeping the remaining first-trip runs', () => {
  // 29 days left in November: the sparse tier needs 0.32 + 29 * 0.06 = 2.06.
  assert.equal(chooseFullDayTier('2026-11-01', 0.7, 2.8, opts)?.name, 'sparse');
  assert.equal(chooseFullDayTier('2026-11-01', 0.8, 2.8, opts), null);
  // Last day of a month with points left: nothing to reserve, so the leftover goes to the dense tier.
  assert.equal(chooseFullDayTier('2026-10-31', 0.3, 2.8, opts)?.name, 'dense');
  assert.equal(chooseFullDayTier('2026-10-31', 0.6, 2.8, opts)?.name, 'sparse');
});

test('only new events count, since records persist after a vehicle stops', () => {
  const log = newDayLog('2026-11-01', t('2026-11-01T05:40:00'));
  assert.equal(recordDayPoll(log, [ev('A', 1, '2026-11-01T05:41:00'), ev('B', 3, '2026-11-01T05:39:00')], t('2026-11-01T05:42:00'), opts), 2);
  assert.equal(recordDayPoll(log, [ev('A', 1, '2026-11-01T05:41:00'), ev('B', 4, '2026-11-01T05:44:00')], t('2026-11-01T05:45:00'), opts), 1);
  assert.equal(log.lastNewEventAt, t('2026-11-01T05:45:00').getTime());
  assert.equal(recordDayPoll(log, [ev('B', 4, '2026-11-01T05:44:00')], t('2026-11-01T05:48:00'), opts), 0);
  assert.equal(log.lastNewEventAt, t('2026-11-01T05:45:00').getTime());
});

test('ends when the last trip on the timetable reaches its terminal stop', () => {
  const log = newDayLog('2026-11-01', t('2026-11-01T05:40:00'));
  // The previous day's last trip, still in the response in the morning, does not count.
  recordDayPoll(log, [terminal('A', '2026-11-01T00:16:00', '2026-11-01T01:14:00')], t('2026-11-01T05:41:00'), opts);
  // Neither does an earlier trip that evening.
  recordDayPoll(log, [terminal('B', '2026-11-01T22:41:00', '2026-11-01T23:46:00')], t('2026-11-01T23:47:00'), opts);
  assert.equal(dayStopReason(log, t('2026-11-01T23:47:00'), opts, sparse), null);
  recordDayPoll(log, [terminal('A', '2026-11-02T00:17:00', '2026-11-02T01:16:00')], t('2026-11-02T01:17:00'), opts);
  assert.equal(log.lastTripEndedAt, '2026-11-02T01:16:00+08:00');
  assert.equal(dayStopReason(log, t('2026-11-02T01:17:00'), opts, sparse), 'last-trip-ended');
});

test('quiet stretches before the last trip is due to end do not stop the run', () => {
  const log = newDayLog('2026-11-01', t('2026-11-01T05:40:00'));
  recordDayPoll(log, [ev('A', 1, '2026-11-01T23:10:00')], t('2026-11-01T23:12:00'), opts);
  assert.equal(dayStopReason(log, t('2026-11-02T01:30:00'), opts, sparse), null);
});

test('without the last trip event, stops after a quiet half hour once it should have ended', () => {
  const log = newDayLog('2026-11-01', t('2026-11-01T05:40:00'));
  recordDayPoll(log, [ev('A', 8, '2026-11-02T01:50:00', { Direction: 1 })], t('2026-11-02T01:51:00'), opts);
  assert.equal(dayStopReason(log, t('2026-11-02T02:20:00'), opts, sparse), null);
  assert.equal(dayStopReason(log, t('2026-11-02T02:21:00'), opts, sparse), 'service-ended');
});

test('stops the next morning at the end of the window, even across a month boundary', () => {
  const log = newDayLog('2026-11-30', t('2026-11-30T05:40:00'));
  recordDayPoll(log, [ev('A', 1, '2026-12-01T04:29:00')], t('2026-12-01T04:29:00'), opts);
  assert.equal(dayStopReason(log, t('2026-12-01T04:29:30'), opts, sparse), null);
  assert.equal(dayStopReason(log, t('2026-12-01T04:30:00'), opts, sparse), 'end-of-window');
});

test('stops at the poll cap', () => {
  const log = newDayLog('2026-11-01', t('2026-11-01T05:40:00'));
  log.polls = sparse.maxPolls;
  assert.equal(dayStopReason(log, t('2026-11-01T12:00:00'), opts, sparse), 'poll-cap');
});
