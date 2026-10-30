// Full-day collection: on some days, after the first trip is done, keep polling for every trip in both directions
// until service ends. It runs only every few days, because polling all day costs several times the daily budget.
// Each run uses the densest tier the budget allows, so points left near the end of a month are not wasted.

import type { A2Record } from './first-trip.ts';

export type FullDayTier = {
  name: string;
  intervalMs: number;
  // Also poll A1 (GPS positions) on every round.
  withA1: boolean;
  maxPolls: number;
  // Points for the whole day's run, including the first-trip part.
  estimatedPoints: number;
};

export type FullDayOptions = {
  // Full-day dates are this date and every `everyDays` days after it, so the weekday rotates when everyDays is 6.
  epoch: string;
  everyDays: number;
  // Densest first.
  tiers: readonly FullDayTier[];
  // The last trip on the timetable, which departs after midnight. The run ends when it reaches its terminal stop.
  lastTrip: { direction: number; departsNextDay: string; terminalStopUID: string };
  // If that event never shows up: once lastTripMaxMs has passed since its scheduled departure, stop after quietMs
  // without new events, and stop the next morning at endBy in any case.
  lastTripMaxMs: number;
  quietMs: number;
  endBy: string;
  // Reserved for the first-trip run on each remaining day of the month.
  firstTripDailyPoints: number;
};

const DAY_MS = 86_400_000;
const midnight = (date: string) => Date.parse(`${date}T00:00:00+08:00`);

export function isFullDayDate(date: string, opts: FullDayOptions): boolean {
  const days = Math.round((midnight(date) - midnight(opts.epoch)) / DAY_MS);
  return days >= 0 && days % opts.everyDays === 0;
}

// The densest tier that still leaves enough for the first-trip runs on the rest of the month, or null.
export function chooseFullDayTier(date: string, usedPoints: number, capPoints: number, opts: FullDayOptions): FullDayTier | null {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const reserved = (daysInMonth - d) * opts.firstTripDailyPoints;
  return opts.tiers.find((tier) => usedPoints + tier.estimatedPoints + reserved <= capPoints) ?? null;
}

export type DayLog = {
  serviceDate: string;
  seen: Set<string>;
  lastNewEventAt: number;
  polls: number;
  // GPSTime of the last trip's arrival at its terminal stop.
  lastTripEndedAt: string | null;
};

export function newDayLog(serviceDate: string, startedAt: Date): DayLog {
  return { serviceDate, seen: new Set(), lastNewEventAt: startedAt.getTime(), polls: 0, lastTripEndedAt: null };
}

function nextDate(date: string): string {
  return new Date(midnight(date) + DAY_MS + 12 * 3600_000).toISOString().slice(0, 10);
}

function lastTripDeparture(log: DayLog, opts: FullDayOptions): number {
  return Date.parse(`${nextDate(log.serviceDate)}T${opts.lastTrip.departsNextDay}:00+08:00`);
}

// A trip whose start is this close to the scheduled time is taken to be that trip.
const SCHEDULE_TOLERANCE_MS = 30 * 60_000;

// Returns how many events this poll added. Records persist after a vehicle stops, so only new keys count.
export function recordDayPoll(log: DayLog, records: A2Record[], at: Date, opts: FullDayOptions): number {
  log.polls++;
  let added = 0;
  for (const r of records) {
    if (
      !log.lastTripEndedAt &&
      r.Direction === opts.lastTrip.direction &&
      r.StopUID === opts.lastTrip.terminalStopUID &&
      r.TripStartTime &&
      Math.abs(Date.parse(r.TripStartTime) - lastTripDeparture(log, opts)) <= SCHEDULE_TOLERANCE_MS
    ) {
      log.lastTripEndedAt = r.GPSTime;
    }
    const key = `${r.PlateNumb}/${r.Direction}/${r.StopSequence}/${r.A2EventType ?? ''}/${r.GPSTime}`;
    if (log.seen.has(key)) continue;
    log.seen.add(key);
    added++;
  }
  if (added > 0) log.lastNewEventAt = at.getTime();
  return added;
}

export type DayStopReason = 'last-trip-ended' | 'service-ended' | 'end-of-window' | 'poll-cap';

export function dayStopReason(log: DayLog, now: Date, opts: FullDayOptions, tier: FullDayTier): DayStopReason | null {
  const t = now.getTime();
  if (log.lastTripEndedAt) return 'last-trip-ended';
  if (t >= Date.parse(`${nextDate(log.serviceDate)}T${opts.endBy}:00+08:00`)) return 'end-of-window';
  if (log.polls >= tier.maxPolls) return 'poll-cap';
  if (t >= lastTripDeparture(log, opts) + opts.lastTripMaxMs && t - log.lastNewEventAt >= opts.quietMs) return 'service-ended';
  return null;
}
