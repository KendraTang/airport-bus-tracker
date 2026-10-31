// Export the JSON the site reads, derived from the raw data in the repo.
//
//   npm run export

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLLECT, PATHS, ROUTE } from '../config.ts';
import { buildExternalLog, readExternalLogs } from '../export/external.ts';
import { buildFirstTripLog, readDayRecords } from '../export/first-trips.ts';
import { readRuns, summarize } from '../export/summary.ts';

const runs = readRuns(PATHS.dataDir);
const summary = summarize(runs);
mkdirSync(PATHS.siteDataDir, { recursive: true });
writeFileSync(join(PATHS.siteDataDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`exported summary: ${summary.collectedDates.length} collected days, ${summary.testRuns} test runs, last updated ${summary.lastUpdatedAt ?? 'never'}`);

// If more copies are added later, only the newest is shown.
const external = readExternalLogs(PATHS.dataDir).at(-1);
const appLog = external ? buildExternalLog(external) : null;
writeFileSync(join(PATHS.siteDataDir, 'app-driving-log.json'), JSON.stringify(appLog, null, 2) + '\n');
console.log(`exported app driving log: ${appLog ? appLog.trips.length : 0} trips`);

const firstTrips = buildFirstTripLog(
  summary.collectedDates.map((date) => ({
    date,
    records: readDayRecords(PATHS.dataDir, date),
    run: runs.filter((r) => r.mode === 'daily' && r.serviceDate === date).sort((a, b) => a.endedAt.localeCompare(b.endedAt)).at(-1) ?? null,
  })),
  ROUTE.stops.map(({ seq, stopUID, name }) => ({ seq, stopUID, name })),
  { direction: ROUTE.direction, earliestTripStart: COLLECT.earliestTripStart },
);
writeFileSync(join(PATHS.siteDataDir, 'first-trips.json'), JSON.stringify(firstTrips, null, 2) + '\n');
console.log(`exported first trips: ${firstTrips.days.length} days`);
