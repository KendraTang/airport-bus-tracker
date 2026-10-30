// Full-day collection: on some days, after the first trip is done, keep polling A2 for every trip in both directions
// until service ends. It runs only every few days, because polling all day costs several times the daily budget.

import type { A2Record } from './first-trip.ts';

export type FullDayOptions = {
  // Full-day dates are this date and every `everyDays` days after it, so the weekday rotates when everyDays is 6.
  epoch: string;
  everyDays: number;
  intervalMs: number;
  // Stop the next morning at this time at the latest.
  endBy: string;
  // After this time, stop once no new A2 event has appeared for quietMs.
  quietAfter: string;
  quietMs: number;
  maxPolls: number;
  // Budget check before starting: points for this day's full-day run, and for a first-trip run on each remaining day.
  estimatedPoints: number;
  firstTripDailyPoints: number;
};

const DAY_MS = 86_400_000;
const midnight = (date: string) => Date.parse(`${date}T00:00:00+08:00`);

export function isFullDayDate(date: string, opts: FullDayOptions): boolean {
  const days = Math.round((midnight(date) - midnight(opts.epoch)) / DAY_MS);
  return days >= 0 && days % opts.everyDays === 0;
}

// The first-trip runs for the rest of the month keep priority over a full-day run.
export function fullDayAffordable(date: string, usedPoints: number, capPoints: number, opts: FullDayOptions): boolean {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const remainingDays = daysInMonth - d;
  return usedPoints + opts.estimatedPoints + remainingDays * opts.firstTripDailyPoints <= capPoints;
}

export type DayLog = { serviceDate: string; seen: Set<string>; lastNewEventAt: number; polls: number };

export function newDayLog(serviceDate: string, startedAt: Date): DayLog {
  return { serviceDate, seen: new Set(), lastNewEventAt: startedAt.getTime(), polls: 0 };
}

// Returns how many events this poll added. Records persist after a vehicle stops, so only new keys count.
export function recordDayPoll(log: DayLog, records: A2Record[], at: Date): number {
  log.polls++;
  let added = 0;
  for (const r of records) {
    const key = `${r.PlateNumb}/${r.Direction}/${r.StopSequence}/${r.A2EventType ?? ''}/${r.GPSTime}`;
    if (log.seen.has(key)) continue;
    log.seen.add(key);
    added++;
  }
  if (added > 0) log.lastNewEventAt = at.getTime();
  return added;
}

export type DayStopReason = 'end-of-window' | 'service-ended' | 'poll-cap';

export function dayStopReason(log: DayLog, now: Date, opts: FullDayOptions): DayStopReason | null {
  const t = now.getTime();
  const nextDay = new Date(midnight(log.serviceDate) + DAY_MS + 12 * 3600_000).toISOString().slice(0, 10);
  if (t >= Date.parse(`${nextDay}T${opts.endBy}:00+08:00`)) return 'end-of-window';
  if (log.polls >= opts.maxPolls) return 'poll-cap';
  const quietFrom = Date.parse(`${log.serviceDate}T${opts.quietAfter}:00+08:00`);
  if (t >= quietFrom && t - log.lastNewEventAt >= opts.quietMs) return 'service-ended';
  return null;
}
