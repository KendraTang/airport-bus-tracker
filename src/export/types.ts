// Shapes of the JSON files exported for the site. Shared with the web app, so no Node imports here.

export interface Summary {
  // Service dates with at least one daily (non-test) run, newest first.
  collectedDates: string[];
  // Number of test runs (--once), which are not counted as collected days.
  testRuns: number;
  // Latest endedAt across all runs, or null when nothing has run yet.
  lastUpdatedAt: string | null;
}
