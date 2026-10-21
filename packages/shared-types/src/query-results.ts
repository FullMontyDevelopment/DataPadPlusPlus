/** Workspace defaults. A null cumulative limit means no application-imposed cap. */
export interface QueryResultPreferences {
  fetchBatchSize: number
  maximumLoadedRows: number | null
  maximumExportedRows: number | null
}

export const DEFAULT_QUERY_RESULT_PREFERENCES: Readonly<QueryResultPreferences> = {
  fetchBatchSize: 500,
  maximumLoadedRows: null,
  maximumExportedRows: null,
}

export const MAX_QUERY_FETCH_BATCH_SIZE = 5_000

export function validateQueryResultPreferences(value: QueryResultPreferences): void {
  if (!Number.isInteger(value.fetchBatchSize) || value.fetchBatchSize < 1 ||
      value.fetchBatchSize > MAX_QUERY_FETCH_BATCH_SIZE) {
    throw new Error('Fetch batch size must be a whole number from 1 to 5,000.')
  }
  for (const [label, limit] of [
    ['Maximum loaded rows', value.maximumLoadedRows],
    ['Maximum exported rows', value.maximumExportedRows],
  ] as const) {
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 4_294_967_295)) {
      throw new Error(`${label} must be a positive whole number up to 4,294,967,295, or No limit.`)
    }
  }
}

export function effectiveQueryBatchSize(preferences?: QueryResultPreferences, override?: number): number {
  const settings = preferences ?? DEFAULT_QUERY_RESULT_PREFERENCES
  const batch = override ?? settings.fetchBatchSize
  return Math.min(batch, settings.maximumLoadedRows ?? batch)
}
