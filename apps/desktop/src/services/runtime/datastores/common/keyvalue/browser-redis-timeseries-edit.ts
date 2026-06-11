import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

export function redisTimeSeriesEditRequest(request: DataEditPlanRequest) {
  const key = request.target.key ?? '<key>'

  if (request.editKind === 'timeseries-add-sample') {
    return `TS.ADD ${key} ${timeSeriesSampleTimestamp(request)} ${timeSeriesSampleValue(request) ?? '<value>'}`
  }

  if (request.editKind === 'timeseries-delete-sample') {
    const [fromTimestamp, toTimestamp] = timeSeriesDeleteRange(request)
    return `TS.DEL ${key} ${fromTimestamp} ${toTimestamp}`
  }

  return undefined
}

function timeSeriesSampleTimestamp(request: DataEditPlanRequest) {
  return commandArg(
    request.target.documentId ??
      request.changes[0]?.field ??
      request.changes[0]?.path?.[0] ??
      request.changes[0]?.newName ??
      '*',
  )
}

function timeSeriesSampleValue(request: DataEditPlanRequest) {
  const value = request.changes[0]?.value
  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
    return commandArg((value as Record<string, unknown>).value)
  }

  return value === undefined ? undefined : commandArg(value)
}

function timeSeriesDeleteRange(request: DataEditPlanRequest) {
  const valueRange = timeSeriesRangeFromValue(request.changes[0]?.value)
  if (valueRange) {
    return valueRange
  }

  const fromTimestamp = commandArg(
    request.target.documentId ??
      request.changes[0]?.field ??
      request.changes[0]?.path?.[0] ??
      '<from-timestamp>',
  )
  const toTimestamp = request.changes[0]?.newName ?? request.changes[0]?.path?.[1] ?? fromTimestamp

  return [fromTimestamp, toTimestamp]
}

function timeSeriesRangeFromValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  const from = record.from ?? record.start ?? record.timestamp
  if (from === undefined) {
    return undefined
  }

  return [commandArg(from), commandArg(record.to ?? record.end ?? from)]
}

function commandArg(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
