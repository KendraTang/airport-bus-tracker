// Trip records copied from a third-party app (data/external/app-driving-log/), with gaps resolved for the site.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStopTimes, segmentMedians, type Resolved } from '../analysis/gaps.ts';
import type { ExternalLog, StopTime } from './types.ts';

// One file as committed: times are HH:MM or null, keyed by StopUID.
export interface RawExternalLog {
  source: ExternalLog['source'];
  notes: string[];
  stops: ExternalLog['stops'];
  trips: {
    date: string;
    weekday: string;
    rank: number;
    plate: string;
    times: Record<string, string | null>;
    nextEvent?: { label: string; time: string };
  }[];
}

export function buildExternalLog(raw: RawExternalLog): ExternalLog {
  const timesOf = (trip: RawExternalLog['trips'][number]) => raw.stops.map((s) => toMinutes(trip.times[s.stopUID] ?? null));

  // Typical times between stops differ by time of day, so each rank (first trip, second trip) has its own.
  const mediansByRank = new Map<number, (number | null)[]>();
  for (const rank of new Set(raw.trips.map((t) => t.rank))) {
    mediansByRank.set(rank, segmentMedians(raw.trips.filter((t) => t.rank === rank).map(timesOf)));
  }

  const trips = raw.trips
    .map((trip) => ({
      date: trip.date,
      weekday: trip.weekday,
      rank: trip.rank,
      plate: trip.plate,
      stopTimes: resolveStopTimes(timesOf(trip), mediansByRank.get(trip.rank)!, toMinutes(trip.nextEvent?.time ?? null)).map(format),
    }))
    .sort((a, b) => a.rank - b.rank || b.date.localeCompare(a.date));
  return { source: raw.source, notes: raw.notes, stops: raw.stops, trips };
}

export function readExternalLogs(dataDir: string): RawExternalLog[] {
  const dir = join(dataDir, 'external', 'app-driving-log');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RawExternalLog);
}

function toMinutes(hhmm: string | null): number | null {
  if (hhmm == null) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function format(r: Resolved): StopTime {
  const bound = (m: number | null) => (m == null ? null : hhmm(m));
  switch (r.state) {
    case 'observed':
      return { state: 'observed', time: hhmm(r.time) };
    case 'estimated':
      return { state: 'estimated', time: hhmm(r.time), lower: bound(r.lower), upper: bound(r.upper) };
    case 'interval':
      return { state: 'interval', lower: bound(r.lower), upper: bound(r.upper) };
    case 'missing':
      return { state: 'missing' };
  }
}
