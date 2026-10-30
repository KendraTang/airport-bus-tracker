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
  endBy: '02:00',
  quietAfter: '22:00',
  quietMs: 60 * 60_000,
  firstTripDailyPoints: 0.06,
};

const t = (iso: string) => new Date(`${iso}+08:00`);

function ev(plate: string, seq: number, gps: string): A2Record {
  return { PlateNumb: plate, Direction: 0, StopSequence: seq, A2EventType: 0, GPSTime: `${gps}+08:00`, TripStartTime: null };
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
  assert.equal(recordDayPoll(log, [ev('A', 1, '2026-11-01T05:41:00'), ev('B', 3, '2026-11-01T05:39:00')], t('2026-11-01T05:42:00')), 2);
  assert.equal(recordDayPoll(log, [ev('A', 1, '2026-11-01T05:41:00'), ev('B', 4, '2026-11-01T05:44:00')], t('2026-11-01T05:45:00')), 1);
  assert.equal(log.lastNewEventAt, t('2026-11-01T05:45:00').getTime());
  assert.equal(recordDayPoll(log, [ev('B', 4, '2026-11-01T05:44:00')], t('2026-11-01T05:48:00')), 0);
  assert.equal(log.lastNewEventAt, t('2026-11-01T05:45:00').getTime());
});

test('a quiet hour during the day does not end the run', () => {
  const log = newDayLog('2026-11-01', t('2026-11-01T05:40:00'));
  recordDayPoll(log, [ev('A', 1, '2026-11-01T13:00:00')], t('2026-11-01T13:00:00'));
  assert.equal(dayStopReason(log, t('2026-11-01T15:00:00'), opts, sparse), null);
});

test('after the quiet time, an hour without new events ends the run', () => {
  const log = newDayLog('2026-11-01', t('2026-11-01T05:40:00'));
  recordDayPoll(log, [ev('A', 1, '2026-11-01T23:10:00')], t('2026-11-01T23:12:00'));
  assert.equal(dayStopReason(log, t('2026-11-02T00:11:00'), opts, sparse), null);
  assert.equal(dayStopReason(log, t('2026-11-02T00:12:00'), opts, sparse), 'service-ended');
});

test('stops the next morning at the end of the window, even across a month boundary', () => {
  const log = newDayLog('2026-11-30', t('2026-11-30T05:40:00'));
  recordDayPoll(log, [ev('A', 1, '2026-12-01T01:59:00')], t('2026-12-01T01:59:00'));
  assert.equal(dayStopReason(log, t('2026-12-01T01:59:30'), opts, sparse), null);
  assert.equal(dayStopReason(log, t('2026-12-01T02:00:00'), opts, sparse), 'end-of-window');
});

test('stops at the poll cap', () => {
  const log = newDayLog('2026-11-01', t('2026-11-01T05:40:00'));
  log.polls = sparse.maxPolls;
  assert.equal(dayStopReason(log, t('2026-11-01T12:00:00'), opts, sparse), 'poll-cap');
});
