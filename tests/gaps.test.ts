import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStopTimes, segmentMedians } from '../src/analysis/gaps.ts';

test('segment medians use only trips that recorded both stops', () => {
  assert.deepEqual(
    segmentMedians([
      [0, 4, 10],
      [0, 3, null],
      [0, 5, 12],
    ]),
    [4, 6.5],
  );
  assert.deepEqual(segmentMedians([[0, null, 10]]), [null, null]);
});

test('observed times are kept as they are', () => {
  assert.deepEqual(resolveStopTimes([1, 2], [1]), [
    { state: 'observed', time: 1 },
    { state: 'observed', time: 2 },
  ]);
});

test('a gap between records is split in proportion to typical segment times', () => {
  const [, gap] = resolveStopTimes([0, null, 30], [10, 20]);
  assert.deepEqual(gap, { state: 'estimated', time: 10, lower: 0, upper: 30 });
});

test('a gap at the end is estimated forward and capped by the next record of the vehicle', () => {
  // 10/26 first trip: T2 05:33, T1 missing, vehicle's next record 05:54.
  const t2 = 5 * 60 + 33;
  assert.deepEqual(resolveStopTimes([t2, null], [3], 5 * 60 + 54)[1], { state: 'estimated', time: t2 + 3, lower: t2, upper: 5 * 60 + 54 });
  assert.deepEqual(resolveStopTimes([t2, null], [30], t2 + 5)[1], { state: 'estimated', time: t2 + 5, lower: t2, upper: t2 + 5 });
});

test('a gap at the end without a later record has only a lower bound', () => {
  assert.deepEqual(resolveStopTimes([100, null], [3])[1], { state: 'estimated', time: 103, lower: 100, upper: null });
});

test('a gap at the start is estimated backward from the first record', () => {
  assert.deepEqual(resolveStopTimes([null, null, 100], [4, 6]).slice(0, 2), [
    { state: 'estimated', time: 90, lower: null, upper: 100 },
    { state: 'estimated', time: 94, lower: null, upper: 100 },
  ]);
});

test('without typical segment times only the bounds are given', () => {
  assert.deepEqual(resolveStopTimes([0, null, 30], [null, 20])[1], { state: 'interval', lower: 0, upper: 30 });
});

test('a trip with no records at all stays missing', () => {
  assert.deepEqual(resolveStopTimes([null, null], [1]), [{ state: 'missing' }, { state: 'missing' }]);
});
