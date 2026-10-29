// Export the JSON the site reads, derived from the raw data in the repo.
//
//   npm run export

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../config.ts';
import { buildExternalLog, readExternalLogs } from '../export/external.ts';
import { readRuns, summarize } from '../export/summary.ts';

const summary = summarize(readRuns(PATHS.dataDir));
mkdirSync(PATHS.siteDataDir, { recursive: true });
writeFileSync(join(PATHS.siteDataDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`exported summary: ${summary.collectedDates.length} collected days, ${summary.testRuns} test runs, last updated ${summary.lastUpdatedAt ?? 'never'}`);

// If more copies are added later, only the newest is shown.
const external = readExternalLogs(PATHS.dataDir).at(-1);
const appLog = external ? buildExternalLog(external) : null;
writeFileSync(join(PATHS.siteDataDir, 'app-driving-log.json'), JSON.stringify(appLog, null, 2) + '\n');
console.log(`exported app driving log: ${appLog ? appLog.trips.length : 0} trips`);
