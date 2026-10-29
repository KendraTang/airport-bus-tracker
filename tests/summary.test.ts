import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRuns, summarize, type RunRecord } from '../src/export/summary.ts';

function run(overrides: Partial<RunRecord>): RunRecord {
  return {
    source: 'mac-mini',
    serviceDate: '2026-10-30',
    startedAt: '2026-10-30T04:40:00.000+08:00',
    endedAt: '2026-10-30T06:10:00.000+08:00',
    mode: 'daily',
    polls: 90,
    failures: 0,
    stopReason: 'arrived',
    ...overrides,
  };
}

test('no runs yields an empty summary', () => {
  assert.deepEqual(summarize([]), { collectedDates: [], testRuns: 0, lastUpdatedAt: null });
});

test('test runs update the last-updated time but are not collected days', () => {
  const summary = summarize([run({ serviceDate: '2026-10-29', mode: 'once', endedAt: '2026-10-29T23:09:01.357+08:00' })]);
  assert.deepEqual(summary, { collectedDates: [], testRuns: 1, lastUpdatedAt: '2026-10-29T23:09:01.357+08:00' });
});

test('a day collected by two sources counts once, newest date first', () => {
  const summary = summarize([
    run({ serviceDate: '2026-10-30' }),
    run({ serviceDate: '2026-10-31', endedAt: '2026-10-31T06:12:00.000+08:00' }),
    run({ serviceDate: '2026-10-30', source: 'actions', endedAt: '2026-10-30T06:40:00.000+08:00' }),
  ]);
  assert.deepEqual(summary.collectedDates, ['2026-10-31', '2026-10-30']);
  assert.equal(summary.lastUpdatedAt, '2026-10-31T06:12:00.000+08:00');
});

test('last-updated compares instants, not strings', () => {
  const summary = summarize([
    run({ endedAt: '2026-10-30T06:10:00.000+08:00' }),
    run({ endedAt: '2026-10-29T23:00:00.000Z' }), // 2026-10-30T07:00+08:00
  ]);
  assert.equal(summary.lastUpdatedAt, '2026-10-29T23:00:00.000Z');
});

test('readRuns collects runs from every source and date, skipping days without runs', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'summary-'));
  const write = (source: string, date: string, runs: RunRecord[]) => {
    const dir = join(dataDir, 'raw', source, date);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'runs.jsonl'), runs.map((r) => JSON.stringify(r) + '\n').join(''));
  };
  write('mac-mini', '2026-10-30', [run({})]);
  write('actions', '2026-10-30', [run({ source: 'actions' }), run({ source: 'actions', mode: 'once' })]);
  mkdirSync(join(dataDir, 'raw', 'mac-mini', '2026-10-31'), { recursive: true });

  const runs = readRuns(dataDir);
  assert.equal(runs.length, 3);
  assert.deepEqual(new Set(runs.map((r) => r.source)), new Set(['mac-mini', 'actions']));
});

test('readRuns returns nothing when there is no raw data yet', () => {
  assert.deepEqual(readRuns(mkdtempSync(join(tmpdir(), 'summary-'))), []);
});
