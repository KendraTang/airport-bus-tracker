import { distanceMeters, type LatLon } from '../geo.ts';
import { taipeiParts } from '../time.ts';

export type A2Record = {
  PlateNumb: string;
  Direction: number;
  StopUID?: string | null;
  StopSequence: number;
  A2EventType?: number | null;
  GPSTime: string;
  TripStartTime?: string | null;
};

export type A1Record = {
  PlateNumb: string;
  Direction: number;
  BusPosition?: { PositionLat: number; PositionLon: number } | null;
  GPSTime: string;
};

export type StopPoint = LatLon & { seq: number; stopUID: string };

// One round of requests. a1 is null when that request failed.
export type Poll = { at: string; a2: A2Record[]; a1: A1Record[] | null };

export type TargetTrip = { plate: string; tripStartTime: string };

export type DoneReason = 'arrived' | 'trip-ended-without-arrival-event' | 'reached-by-position' | 'stalled';

export type TrackerState = {
  serviceDate: string;
  target: TargetTrip | null;
  // Highest stop sequence the target trip has an A2 event for.
  seenSeq: number;
  lastEventKey: string | null;
  // Latest A1 position of the target vehicle.
  position: (LatLon & { gpsTime: string }) | null;
  // When the target last got closer to the destination or produced a new A2 event, and its distance at that time.
  progress: { at: string; distance: number | null } | null;
  // GPSTime of the first A1 position within reach of the destination stop.
  nearDestinationAt: string | null;
  done: null | {
    reason: DoneReason;
    gpsTime: string;
    eventType: number | null;
  };
};

export type TrackerOptions = {
  direction: number;
  destinationStopUID: string;
  earliestTripStart: string;
  stops: readonly StopPoint[];
  maxSpeedKmh: number;
  stallMs: number;
  progressMeters: number;
  nearDestinationMeters: number;
  nearDestinationGraceMs: number;
};

// A trip whose TripStartTime moved by less than this is treated as the same trip,
// because TDX may revise an estimated start time.
const SAME_TRIP_TOLERANCE_MS = 10 * 60_000;

export function newTracker(serviceDate: string): TrackerState {
  return { serviceDate, target: null, seenSeq: 0, lastEventKey: null, position: null, progress: null, nearDestinationAt: null, done: null };
}

export function isSameTrip(r: A2Record, target: TargetTrip): boolean {
  if (r.PlateNumb !== target.plate || !r.TripStartTime) return false;
  return Math.abs(Date.parse(r.TripStartTime) - Date.parse(target.tripStartTime)) < SAME_TRIP_TOLERANCE_MS;
}

// The rule for which trip is the first trip of a service date, shared by the collector and the site export.
export type FirstTripRule = Pick<TrackerOptions, 'direction' | 'earliestTripStart'>;

export function isFirstTripCandidate(r: A2Record, serviceDate: string, rule: FirstTripRule): boolean {
  if (r.Direction !== rule.direction || !r.TripStartTime) return false;
  const start = taipeiParts(new Date(r.TripStartTime));
  return start.date === serviceDate && start.hhmm >= rule.earliestTripStart;
}

// The earlier of the current pick and a candidate record.
export function earlierTrip(target: TargetTrip | null, r: A2Record): TargetTrip {
  if (target && Date.parse(r.TripStartTime!) >= Date.parse(target.tripStartTime)) return target;
  return { plate: r.PlateNumb, tripStartTime: r.TripStartTime! };
}

function destination(opts: TrackerOptions): StopPoint {
  const stop = opts.stops.find((s) => s.stopUID === opts.destinationStopUID);
  if (!stop) throw new Error(`destination ${opts.destinationStopUID} is not in the stop list`);
  return stop;
}

// Missing data only ever keeps the tracker running: the position-based rules need an A1 record of the target to act.
export function updateTracker(state: TrackerState, poll: Poll, opts: TrackerOptions): TrackerState {
  if (state.done) return state;

  let target = state.target;
  for (const r of poll.a2) {
    if (isFirstTripCandidate(r, state.serviceDate, opts)) target = earlierTrip(target, r);
  }
  if (!target) return state;

  const next: TrackerState = { ...state, target };
  let newEvent = false;
  for (const r of poll.a2) {
    if (r.PlateNumb !== target.plate) continue;
    if (r.Direction === opts.direction && isSameTrip(r, target)) {
      if (r.StopUID === opts.destinationStopUID) {
        return { ...next, done: { reason: 'arrived', gpsTime: r.GPSTime, eventType: r.A2EventType ?? null } };
      }
      next.seenSeq = Math.max(next.seenSeq, r.StopSequence);
      const key = `${r.StopSequence}/${r.A2EventType ?? ''}/${r.GPSTime}`;
      if (key !== state.lastEventKey) {
        next.lastEventKey = key;
        newEvent = true;
      }
    } else if (r.Direction !== opts.direction || (r.TripStartTime && Date.parse(r.TripStartTime) > Date.parse(target.tripStartTime))) {
      // The target vehicle is already on another trip, so its arrival event was missed.
      return { ...next, done: { reason: 'trip-ended-without-arrival-event', gpsTime: r.GPSTime, eventType: r.A2EventType ?? null } };
    }
  }

  const a1 = poll.a1?.find((r) => r.PlateNumb === target.plate && r.Direction === opts.direction && r.BusPosition);
  let distance: number | null = null;
  if (a1) {
    next.position = { lat: a1.BusPosition!.PositionLat, lon: a1.BusPosition!.PositionLon, gpsTime: a1.GPSTime };
    distance = distanceMeters(next.position, destination(opts));
    if (distance <= opts.nearDestinationMeters && !next.nearDestinationAt) next.nearDestinationAt = a1.GPSTime;
  }

  const prev = state.progress;
  const closer = distance !== null && (prev?.distance == null || distance <= prev.distance - opts.progressMeters);
  if (!prev || newEvent || closer) {
    next.progress = { at: poll.at, distance: distance ?? prev?.distance ?? null };
  }

  // Wait a little after reaching the destination by position, in case the A2 event shows up late.
  if (next.nearDestinationAt && Date.parse(poll.at) - Date.parse(next.nearDestinationAt) >= opts.nearDestinationGraceMs) {
    return { ...next, done: { reason: 'reached-by-position', gpsTime: next.nearDestinationAt, eventType: null } };
  }
  if (a1 && Date.parse(poll.at) - Date.parse(next.progress!.at) >= opts.stallMs) {
    return { ...next, done: { reason: 'stalled', gpsTime: a1.GPSTime, eventType: null } };
  }
  return next;
}

// How long to wait before the next poll. A2 departure events stay visible until the next arrival, so polling can pause
// while the target is far from every stop it has not been seen at. Polling resumes one interval before the earliest
// time the vehicle could reach any of them, assuming it travels in a straight line at the maximum speed.
export function nextPollDelay(state: TrackerState, opts: TrackerOptions, now: Date, intervalMs: number): number {
  if (state.done || !state.target || !state.position) return intervalMs;
  const ahead = opts.stops.filter((s) => s.seq > state.seenSeq);
  if (ahead.length === 0) return intervalMs;

  const nearest = Math.min(...ahead.map((s) => distanceMeters(state.position!, s)));
  const earliestArrival = Date.parse(state.position.gpsTime) + (nearest / (opts.maxSpeedKmh / 3.6)) * 1000;
  const wait = earliestArrival - intervalMs - now.getTime();
  return Math.max(intervalMs, Math.floor(wait / intervalMs) * intervalMs);
}
