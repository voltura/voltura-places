/** Protocol capacities shared by validation, browser persistence and the server. */
export const entityLimits = { place: 5_000, route: 5_000, category: 200, visit: 100_000 } as const;
export const syncLimits = {
  pageSize: 250,
  snapshotRecords: 200_000,
  mutationBatch: entityLimits.place + entityLimits.category + entityLimits.visit,
} as const;
