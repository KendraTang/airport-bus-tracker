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

export type TargetTrip = { plate: string; tripStartTime: string };

export type TrackerState = {
  serviceDate: string;
  target: TargetTrip | null;
  done: null | {
    reason: 'arrived' | 'trip-ended-without-arrival-event';
    gpsTime: string;
    eventType: number | null;
  };
};

export type TrackerOptions = {
  direction: number;
  destinationStopUID: string;
  earliestTripStart: string;
};

// A trip whose TripStartTime moved by less than this is treated as the same trip,
// because TDX may revise an estimated start time.
const SAME_TRIP_TOLERANCE_MS = 10 * 60_000;

export function newTracker(serviceDate: string): TrackerState {
  return { serviceDate, target: null, done: null };
}

function isSameTrip(r: A2Record, target: TargetTrip): boolean {
  if (r.PlateNumb !== target.plate || !r.TripStartTime) return false;
  return Math.abs(Date.parse(r.TripStartTime) - Date.parse(target.tripStartTime)) < SAME_TRIP_TOLERANCE_MS;
}

function isCandidate(r: A2Record, state: TrackerState, opts: TrackerOptions): boolean {
  if (r.Direction !== opts.direction || !r.TripStartTime) return false;
  const start = taipeiParts(new Date(r.TripStartTime));
  return start.date === state.serviceDate && start.hhmm >= opts.earliestTripStart;
}

export function updateTracker(state: TrackerState, records: A2Record[], opts: TrackerOptions): TrackerState {
  if (state.done) return state;

  let target = state.target;
  for (const r of records) {
    if (!isCandidate(r, state, opts)) continue;
    if (!target || Date.parse(r.TripStartTime!) < Date.parse(target.tripStartTime)) {
      target = { plate: r.PlateNumb, tripStartTime: r.TripStartTime! };
    }
  }
  if (!target) return state;

  for (const r of records) {
    if (r.PlateNumb !== target.plate) continue;
    if (r.Direction === opts.direction && isSameTrip(r, target)) {
      if (r.StopUID === opts.destinationStopUID) {
        return { ...state, target, done: { reason: 'arrived', gpsTime: r.GPSTime, eventType: r.A2EventType ?? null } };
      }
    } else if (r.Direction !== opts.direction || (r.TripStartTime && Date.parse(r.TripStartTime) > Date.parse(target.tripStartTime))) {
      // The target vehicle is already on another trip, so its arrival event was missed.
      return {
        ...state,
        target,
        done: { reason: 'trip-ended-without-arrival-event', gpsTime: r.GPSTime, eventType: r.A2EventType ?? null },
      };
    }
  }
  return { ...state, target };
}
