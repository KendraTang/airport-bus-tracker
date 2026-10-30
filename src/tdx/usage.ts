import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Service = 'auth' | 'basic' | 'historical';

export type UsageEntry = {
  at: string;
  source: string;
  service: Service;
  path: string;
  status: number;
  bytes: number;
};

// TDX bills call count and data volume separately and adds them up (checked against the member centre).
// TDX counts compressed transfer bytes, while entries record decompressed bytes, so this overestimates.
// 1MB is taken as 1,000,000 bytes to stay on the safe side as well.
const RATES: Record<Service, { perCall: number; perByte: number }> = {
  auth: { perCall: 0, perByte: 0 },
  basic: { perCall: 1 / 1500, perByte: 1 / 150_000_000 },
  historical: { perCall: 1 / 10, perByte: 1 / 20_000_000 },
};

export function pointsFor(entry: Pick<UsageEntry, 'service' | 'bytes'>): number {
  const rate = RATES[entry.service];
  return rate.perCall + entry.bytes * rate.perByte;
}

function usageDir(dataDir: string): string {
  return join(dataDir, 'usage');
}

// Each source writes its own file so that machines pushing to the same repo never touch the same file.
export function recordUsage(dataDir: string, month: string, entry: UsageEntry): void {
  const dir = join(usageDir(dataDir), entry.source);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${month}.jsonl`), JSON.stringify(entry) + '\n');
}

export function readMonthUsage(dataDir: string, month: string): UsageEntry[] {
  const root = usageDir(dataDir);
  if (!existsSync(root)) return [];
  const entries: UsageEntry[] = [];
  for (const source of readdirSync(root)) {
    const file = join(root, source, `${month}.jsonl`);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim()) entries.push(JSON.parse(line));
    }
  }
  return entries;
}

export function monthPoints(dataDir: string, month: string): number {
  return readMonthUsage(dataDir, month).reduce((sum, e) => sum + pointsFor(e), 0);
}

export class BudgetExceededError extends Error {}

export function assertWithinBudget(
  dataDir: string,
  month: string,
  next: Pick<UsageEntry, 'service' | 'bytes'>,
  limits: { monthlyPoints: number; reservePoints: number },
): void {
  const used = monthPoints(dataDir, month);
  const cap = limits.monthlyPoints - limits.reservePoints;
  if (used + pointsFor(next) > cap) {
    throw new BudgetExceededError(`monthly budget reached: ${used.toFixed(3)} of ${cap} points used in ${month}`);
  }
}
