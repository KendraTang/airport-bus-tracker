// Export the JSON the site reads, derived from the raw data in the repo.
//
//   npm run export

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../config.ts';
import { readRuns, summarize } from '../export/summary.ts';

const summary = summarize(readRuns(PATHS.dataDir));
mkdirSync(PATHS.siteDataDir, { recursive: true });
writeFileSync(join(PATHS.siteDataDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`exported summary: ${summary.collectedDates.length} collected days, ${summary.testRuns} test runs, last updated ${summary.lastUpdatedAt ?? 'never'}`);
