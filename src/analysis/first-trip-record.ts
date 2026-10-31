// Rebuild a day's first trip from the A2 records collected that day, with the same rule the collector uses to pick it.
// Times are seconds since midnight (Asia/Taipei) of the service date; null means no record.

import {
  earlierTrip,
  isFirstTripCandidate,
  isSameTrip,
  type A2Record,
  type FirstTripRule,
  type TargetTrip,
} from '../collector/first-trip.ts';
import { resolveStopTimes, segmentMedians, type Resolved } from './gaps.ts';

// The trip's events in travel order: departure from the first stop, arrival and departure at each stop in between,
// and arrival at the last stop. Arrival at the first stop and departure from the last are left out.
export type TripEvents = {
  target: TargetTrip;
  times: (number | null)[];
  // The vehicle's first record after the trip: its departure from the last stop or a record of its next trip.
  // An upper bound for times missing at the end of the trip.
  after: number | null;
};

const ARRIVAL = 1;

// Position of a stop event in TripEvents.times, or null for the events that are left out.
export function eventIndex(seq: number, eventType: number | null | undefined, stopCount: number): number | null {
  const arrival = eventType === ARRIVAL;
  if (seq === 1) return arrival ? null : 0;
  if (seq === stopCount) return arrival ? 2 * stopCount - 3 : null;
  if (seq < 1 || seq > stopCount) return null;
  return arrival ? 2 * seq - 3 : 2 * seq - 2;
}

export function findFirstTrip(records: A2Record[], serviceDate: string, rule: FirstTripRule): TargetTrip | null {
  let target: TargetTrip | null = null;
  for (const r of records) if (isFirstTripCandidate(r, serviceDate, rule)) target = earlierTrip(target, r);
  return target;
}

export function tripEvents(records: A2Record[], target: TargetTrip, serviceDate: string, rule: FirstTripRule, stopCount: number): TripEvents {
  const midnight = Date.parse(`${serviceDate}T00:00:00+08:00`);
  const seconds = (iso: string) => Math.round((Date.parse(iso) - midnight) / 1000);
  const times: (number | null)[] = Array(2 * stopCount - 2).fill(null);
  const later: number[] = [];

  for (const r of records) {
    if (r.PlateNumb !== target.plate) continue;
    if (r.Direction === rule.direction && isSameTrip(r, target)) {
      const i = eventIndex(r.StopSequence, r.A2EventType, stopCount);
      // The same event shows up in many polls; keep the earliest time in case TDX ever revises it.
      if (i !== null) times[i] = times[i] === null ? seconds(r.GPSTime) : Math.min(times[i]!, seconds(r.GPSTime));
      else if (r.StopSequence === stopCount) later.push(seconds(r.GPSTime));
    } else if (r.Direction !== rule.direction || (r.TripStartTime && Date.parse(r.TripStartTime) > Date.parse(target.tripStartTime))) {
      later.push(seconds(r.GPSTime));
    }
  }

  const last = Math.max(-Infinity, ...times.filter((t): t is number => t !== null));
  const after = later.filter((t) => t > last);
  return { target, times, after: after.length ? Math.min(...after) : null };
}

export type StopResult = Resolved | { state: 'not_arrived_by_cutoff'; lower: number | null };

// Per stop, in stop order; arrival is null at the first stop and departure is null at the last.
export type FirstTripStops = { arrival: StopResult | null; departure: StopResult | null }[];

// Typical times between consecutive events, over the first trips of every collected day.
export function eventMedians(days: TripEvents[]): (number | null)[] {
  return segmentMedians(days.map((d) => d.times));
}

// `endedEarly`: collection stopped before the trip was seen to arrive (cutoff, stalled or budget), so times after the
// last record are not known to have happened at all.
export function resolveFirstTrip(events: TripEvents, medians: (number | null)[], endedEarly: boolean): FirstTripStops {
  const resolved: StopResult[] = resolveStopTimes(events.times, medians, events.after).map((r) =>
    endedEarly && r.state !== 'observed' && (r.state === 'missing' || r.upper === null)
      ? { state: 'not_arrived_by_cutoff', lower: r.state === 'missing' ? null : r.lower }
      : r,
  );
  const stopCount = resolved.length / 2 + 1;
  return Array.from({ length: stopCount }, (_, k) => {
    const seq = k + 1;
    const arrival = eventIndex(seq, ARRIVAL, stopCount);
    const departure = eventIndex(seq, 0, stopCount);
    return { arrival: arrival === null ? null : resolved[arrival]!, departure: departure === null ? null : resolved[departure]! };
  });
}
