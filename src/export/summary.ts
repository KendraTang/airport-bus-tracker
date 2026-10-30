// Site summary: which days have been collected and when data was last updated.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Summary } from './types.ts';

// One line of data/raw/{source}/{date}/runs.jsonl, as written by the collector.
export interface RunRecord {
  source: string;
  serviceDate: string;
  startedAt: string;
  endedAt: string;
  mode: 'daily' | 'full-day' | 'once';
  polls: number;
  failures: number;
  stopReason: string;
}

export function summarize(runs: RunRecord[]): Summary {
  const dates = new Set<string>();
  const fullDayDates = new Set<string>();
  let testRuns = 0;
  let lastUpdatedAt: string | null = null;
  for (const run of runs) {
    if (run.mode === 'daily') dates.add(run.serviceDate);
    else if (run.mode === 'full-day') fullDayDates.add(run.serviceDate);
    else testRuns++;
    if (lastUpdatedAt === null || Date.parse(run.endedAt) > Date.parse(lastUpdatedAt)) lastUpdatedAt = run.endedAt;
  }
  return { collectedDates: [...dates].sort().reverse(), fullDayDates: [...fullDayDates].sort().reverse(), testRuns, lastUpdatedAt };
}

export function readRuns(dataDir: string): RunRecord[] {
  const rawDir = join(dataDir, 'raw');
  if (!existsSync(rawDir)) return [];
  const runs: RunRecord[] = [];
  for (const source of subdirs(rawDir)) {
    for (const date of subdirs(join(rawDir, source))) {
      const file = join(rawDir, source, date, 'runs.jsonl');
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.trim()) runs.push(JSON.parse(line) as RunRecord);
      }
    }
  }
  return runs;
}

function subdirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}
