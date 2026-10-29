export const ROUTE = {
  routeName: '1960',
  routeUID: 'THB1960',
  direction: 0,
  destinationStopUID: 'THB295119', // 桃園機場第一航廈
} as const;

export const COLLECT = {
  source: 'mac-mini',
  // Trips that left the first stop before this time are ignored when picking the target trip.
  earliestTripStart: '04:30',
  cutoff: '07:30',
  intervalMs: 60_000,
} as const;

export const BUDGET = {
  monthlyPoints: 3,
  reservePoints: 0.2,
} as const;

export const PATHS = {
  dataDir: 'data',
} as const;
