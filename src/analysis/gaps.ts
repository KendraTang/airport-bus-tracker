// Fill in stop times that have no record, without ever presenting them as observed.
// Times are minutes since midnight; null means no record.

export type Resolved =
  | { state: 'observed'; time: number }
  | { state: 'estimated'; time: number; lower: number | null; upper: number | null }
  | { state: 'interval'; lower: number | null; upper: number | null }
  | { state: 'missing' };

// Median minutes from each stop to the next, over trips that recorded both; null when no trip did.
export function segmentMedians(trips: (number | null)[][]): (number | null)[] {
  const stops = Math.max(0, ...trips.map((t) => t.length));
  return Array.from({ length: Math.max(0, stops - 1) }, (_, k) => {
    const durations = trips.flatMap((t) => (t[k] != null && t[k + 1] != null ? [t[k + 1]! - t[k]!] : []));
    return median(durations);
  });
}

// `after` is the vehicle's next record after this trip, an upper bound for gaps at the end of the trip.
export function resolveStopTimes(times: (number | null)[], medians: (number | null)[], after: number | null = null): Resolved[] {
  return times.map((time, i) => {
    if (time != null) return { state: 'observed', time };

    const lo = findIndex(times, i, -1);
    const hi = findIndex(times, i, 1);
    const lower = lo === -1 ? null : times[lo]!;
    const upper = hi === -1 ? after : times[hi]!;
    if (lower == null && upper == null) return { state: 'missing' };

    let estimate: number | null = null;
    if (lo !== -1 && hi !== -1) {
      // Split the observed span in proportion to the typical times of its segments.
      const toHere = sum(medians, lo, i);
      const total = sum(medians, lo, hi);
      if (toHere != null && total != null && total > 0) estimate = lower! + ((upper! - lower!) * toHere) / total;
    } else if (lo !== -1) {
      const toHere = sum(medians, lo, i);
      if (toHere != null) estimate = lower! + toHere;
    } else {
      const fromHere = sum(medians, i, hi);
      if (fromHere != null) estimate = upper! - fromHere;
    }
    if (estimate == null) return { state: 'interval', lower, upper };

    if (upper != null) estimate = Math.min(estimate, upper);
    if (lower != null) estimate = Math.max(estimate, lower);
    return { state: 'estimated', time: Math.round(estimate), lower, upper };
  });
}

function findIndex(times: (number | null)[], from: number, step: 1 | -1): number {
  for (let j = from + step; j >= 0 && j < times.length; j += step) if (times[j] != null) return j;
  return -1;
}

// Sum of medians for the segments from stop `from` to stop `to`; null if any is unknown.
function sum(medians: (number | null)[], from: number, to: number): number | null {
  let total = 0;
  for (let k = from; k < to; k++) {
    if (medians[k] == null) return null;
    total += medians[k]!;
  }
  return total;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
