import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { assertWithinBudget, BudgetExceededError, monthPoints, pointsFor, recordUsage } from '../src/tdx/usage.ts';

const dataDir = mkdtempSync(join(tmpdir(), 'usage-test-'));
after(() => rmSync(dataDir, { recursive: true, force: true }));

const entry = (source: string, service: 'auth' | 'basic' | 'historical', bytes: number) => ({
  at: '2026-10-30T04:40:00+08:00',
  source,
  service,
  path: '/x',
  status: 200,
  bytes,
});

test('points per call follow the TDX rates', () => {
  assert.equal(pointsFor({ service: 'auth', bytes: 0 }), 0);
  assert.ok(Math.abs(pointsFor({ service: 'basic', bytes: 0 }) - 1 / 1500) < 1e-12);
  assert.ok(Math.abs(pointsFor({ service: 'historical', bytes: 2_000_000 }) - 0.2) < 1e-12);
});

test('monthly total adds up every source and ignores other months', () => {
  recordUsage(dataDir, '2026-10', entry('mac-mini', 'basic', 0));
  recordUsage(dataDir, '2026-10', entry('actions', 'basic', 0));
  recordUsage(dataDir, '2026-10', entry('dev', 'historical', 0));
  recordUsage(dataDir, '2026-11', entry('mac-mini', 'historical', 0));
  assert.ok(Math.abs(monthPoints(dataDir, '2026-10') - (2 / 1500 + 0.1)) < 1e-12);
});

test('refuses a call that would go past the cap', () => {
  const limits = { monthlyPoints: 0.3, reservePoints: 0.1 };
  assert.doesNotThrow(() => assertWithinBudget(dataDir, '2026-10', { service: 'basic', bytes: 0 }, limits));
  assert.throws(() => assertWithinBudget(dataDir, '2026-10', { service: 'historical', bytes: 0 }, limits), BudgetExceededError);
});
