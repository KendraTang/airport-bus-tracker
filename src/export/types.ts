// Shapes of the JSON files exported for the site. Shared with the web app, so no Node imports here.

export interface Summary {
  // Service dates with at least one daily (non-test) run, newest first.
  collectedDates: string[];
  // Service dates with a full-day run (every trip in both directions), newest first.
  fullDayDates: string[];
  // Number of test runs (--once), which are not counted as collected days.
  testRuns: number;
  // Latest endedAt across all runs, or null when nothing has run yet.
  lastUpdatedAt: string | null;
}

// A stop time as shown on the site. Times are HH:MM in Asia/Taipei.
//   observed   a recorded time
//   estimated  not recorded; estimated from typical times between stops, within the bounds from neighbouring records
//   interval   not recorded; only bounds are known (either may be open)
//   missing    not recorded and nothing to bound it
//   not_arrived_by_cutoff
//              collection stopped (at `cutoff`) before the vehicle was seen here; `lower` is its last record before that
export type StopTime =
  | { state: 'observed'; time: string }
  | { state: 'estimated'; time: string; lower: string | null; upper: string | null }
  | { state: 'interval'; lower: string | null; upper: string | null }
  | { state: 'missing' }
  | { state: 'not_arrived_by_cutoff'; lower: string | null; cutoff: string };

// The first airport-bound trip of each collected day, rebuilt from the A2 records. Described in docs/SITE_DATA.md.
export interface FirstTripLog {
  stops: { seq: number; stopUID: string; name: string }[];
  days: {
    date: string;
    weekday: string;
    // null when no first trip shows up in the day's records.
    plate: string | null;
    // One entry per stop, in stop order. arrival is null at the first stop, departure is null at the last.
    stopTimes: { arrival: StopTime | null; departure: StopTime | null }[];
  }[];
}

// Trip records copied from a third-party app, for days before the collector started.
export interface ExternalLog {
  source: { app: string; package: string; version: string; view: string; retrievedAt: string; method: string };
  notes: string[];
  stops: { seq: number; stopUID: string; name: string }[];
  trips: {
    date: string;
    weekday: string;
    // Position among the day's airport-bound trips in the app's list (1 = first trip).
    rank: number;
    plate: string;
    stopTimes: StopTime[];
  }[];
}
