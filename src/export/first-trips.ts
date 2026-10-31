// The daily first-trip table for the site, rebuilt from the raw A2 records in the repo.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventMedians, findFirstTrip, resolveFirstTrip, tripEvents, type StopResult } from '../analysis/first-trip-record.ts';
import type { A2Record, FirstTripRule } from '../collector/first-trip.ts';
import type { RunRecord } from './summary.ts';
import type { FirstTripLog, StopTime } from './types.ts';

export interface DayInput {
  date: string;
  // Every A2 record collected for the date, from all sources.
  records: A2Record[];
  // The daily run that collected the first trip, if any.
  run: Pick<RunRecord, 'endedAt' | 'stopReason'> | null;
}

// Stop reasons after which the trip may still have been on its way.
const ENDED_EARLY = new Set(['cutoff', 'stalled', 'budget']);
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function buildFirstTripLog(days: DayInput[], stops: FirstTripLog['stops'], rule: FirstTripRule): FirstTripLog {
  const found = days.map((day) => {
    const target = findFirstTrip(day.records, day.date, rule);
    return { day, events: target ? tripEvents(day.records, target, day.date, rule, stops.length) : null };
  });
  const medians = eventMedians(found.flatMap((f) => (f.events ? [f.events] : [])));

  return {
    stops,
    days: found
      .map(({ day, events }) => {
        const endedEarly = day.run !== null && ENDED_EARLY.has(day.run.stopReason);
        const cutoff = day.run ? hhmm(day.run.endedAt) : '';
        return {
          date: day.date,
          weekday: WEEKDAYS[new Date(`${day.date}T12:00:00Z`).getUTCDay()]!,
          plate: events?.target.plate ?? null,
          stopTimes: events
            ? resolveFirstTrip(events, medians, endedEarly).map((s) => ({
                arrival: s.arrival && format(s.arrival, cutoff),
                departure: s.departure && format(s.departure, cutoff),
              }))
            : stops.map((_, k) => ({
                arrival: k === 0 ? null : ({ state: 'missing' } as const),
                departure: k === stops.length - 1 ? null : ({ state: 'missing' } as const),
              })),
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}

// All A2 records saved for a service date, across sources, in the order they were fetched.
export function readDayRecords(dataDir: string, date: string): A2Record[] {
  const rawDir = join(dataDir, 'raw');
  if (!existsSync(rawDir)) return [];
  const polls: { fetchedAt: string; body: A2Record[] }[] = [];
  for (const source of readdirSync(rawDir)) {
    const file = join(rawDir, source, date, 'a2.jsonl');
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const poll = JSON.parse(line) as { fetchedAt: string; status: number; body?: unknown };
      if (poll.status === 200 && Array.isArray(poll.body)) polls.push({ fetchedAt: poll.fetchedAt, body: poll.body as A2Record[] });
    }
  }
  return polls.sort((a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt)).flatMap((p) => p.body);
}

// Seconds since midnight to HH:MM, dropping the seconds the way a clock shows them.
function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function hhmm(iso: string): string {
  const t = new Date(Date.parse(iso) + 8 * 3600_000);
  return t.toISOString().slice(11, 16);
}

function format(r: StopResult, cutoff: string): StopTime {
  const bound = (s: number | null) => (s == null ? null : clock(s));
  switch (r.state) {
    case 'observed':
      return { state: 'observed', time: clock(r.time) };
    case 'estimated':
      return { state: 'estimated', time: clock(r.time), lower: bound(r.lower), upper: bound(r.upper) };
    case 'interval':
      return { state: 'interval', lower: bound(r.lower), upper: bound(r.upper) };
    case 'missing':
      return { state: 'missing' };
    case 'not_arrived_by_cutoff':
      return { state: 'not_arrived_by_cutoff', lower: bound(r.lower), cutoff };
  }
}
