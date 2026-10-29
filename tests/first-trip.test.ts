import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newTracker, updateTracker, type A2Record } from '../src/collector/first-trip.ts';

const opts = { direction: 0, destinationStopUID: 'T1', earliestTripStart: '04:30' };
const DATE = '2026-10-30';

function a2(plate: string, stop: string, tripStart: string | null, gps: string, overrides: Partial<A2Record> = {}): A2Record {
  return {
    PlateNumb: plate,
    Direction: 0,
    StopUID: stop,
    StopSequence: 1,
    A2EventType: 1,
    GPSTime: `${DATE}T${gps}:00+08:00`,
    TripStartTime: tripStart === null ? null : `${DATE}T${tripStart}:00+08:00`,
    ...overrides,
  };
}

test('no target before the first trip departs', () => {
  const s = updateTracker(newTracker(DATE), [], opts);
  assert.equal(s.target, null);
  assert.equal(s.done, null);
});

test('picks the earliest trip that started after the earliest allowed start', () => {
  const s = updateTracker(
    newTracker(DATE),
    [a2('LATE', 'S2', '04:55', '04:58'), a2('FIRST', 'S3', '04:41', '04:52'), a2('NIGHT', 'S5', '04:10', '04:50')],
    opts,
  );
  assert.deepEqual(s.target, { plate: 'FIRST', tripStartTime: `${DATE}T04:41:00+08:00` });
  assert.equal(s.done, null);
});

test('ignores trips that started on the previous service date', () => {
  const s = updateTracker(newTracker(DATE), [a2('OLD', 'S2', null, '04:45', { TripStartTime: '2026-10-29T23:30:00+08:00' })], opts);
  assert.equal(s.target, null);
});

test('finishes when the target trip reaches the destination stop', () => {
  let s = updateTracker(newTracker(DATE), [a2('FIRST', 'S3', '04:41', '04:52')], opts);
  s = updateTracker(s, [a2('FIRST', 'T1', '04:41', '05:48', { A2EventType: 1 })], opts);
  assert.deepEqual(s.done, { reason: 'arrived', gpsTime: `${DATE}T05:48:00+08:00`, eventType: 1 });
});

test('does not finish when another trip reaches the destination stop', () => {
  let s = updateTracker(newTracker(DATE), [a2('FIRST', 'S3', '04:41', '04:52')], opts);
  s = updateTracker(s, [a2('FIRST', 'S5', '04:41', '05:40'), a2('OTHER', 'T1', '05:00', '05:41')], opts);
  assert.equal(s.done, null);
});

test('treats a small revision of an estimated start time as the same trip', () => {
  let s = updateTracker(newTracker(DATE), [a2('FIRST', 'S3', '04:41', '04:52')], opts);
  s = updateTracker(s, [a2('FIRST', 'T1', '04:44', '05:48')], opts);
  assert.equal(s.done?.reason, 'arrived');
});

test('stops when the target vehicle starts a return trip without a destination event', () => {
  let s = updateTracker(newTracker(DATE), [a2('FIRST', 'S5', '04:41', '05:40')], opts);
  s = updateTracker(s, [a2('FIRST', 'R1', '06:10', '06:12', { Direction: 1 })], opts);
  assert.equal(s.done?.reason, 'trip-ended-without-arrival-event');
});

test('a record without a trip start time does not end the trip', () => {
  let s = updateTracker(newTracker(DATE), [a2('FIRST', 'S3', '04:41', '04:52')], opts);
  s = updateTracker(s, [a2('FIRST', 'S4', null, '04:58')], opts);
  assert.equal(s.done, null);
});

test('state stays finished once done', () => {
  let s = updateTracker(newTracker(DATE), [a2('FIRST', 'T1', '04:41', '05:48')], opts);
  const done = s.done;
  s = updateTracker(s, [a2('FIRST', 'R1', '06:10', '06:12', { Direction: 1 })], opts);
  assert.deepEqual(s.done, done);
});
