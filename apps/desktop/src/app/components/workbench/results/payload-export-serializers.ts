import type {
  ExecutionResultEnvelope,
  ExportResultFileRequest,
  ResultPayload,
  SingleResultPayload,
} from '@datapadplusplus/shared-types'
import {
  sanitizeExportText,
  sanitizePayloadForExport,
} from './payload-export-sanitizers'
import { formatResultCellValue } from './result-cell-format'

export type ResultExportFormat = 'csv' | 'json' | 'ndjson' | 'txt'

export interface ResultExportOption {
  format: ResultExportFormat
  label: string
  extension: string
  mimeType: string
  description: string
}

export function payloadToText(payload: ResultPayload) {
  return serializePayloadForExport(payload, defaultExportOptionForPayload(payload).format)
}

export function exportOptionsForPayload(payload: ResultPayload): ResultExportOption[] {
  if (payload.renderer === 'batch') {
    const rowLikeSections = payload.sections.filter((section) =>
      section.payloads.some((sectionPayload) => rowLikeRecordsForPayload(sectionPayload).length > 0),
    )

    return rowLikeSections.length > 0
      ? [EXPORT_FORMATS.json, EXPORT_FORMATS.txt, EXPORT_FORMATS.ndjson]
      : [EXPORT_FORMATS.json, EXPORT_FORMATS.txt]
  }

  if (payload.renderer === 'raw' || payload.renderer === 'resp') {
    return [EXPORT_FORMATS.txt]
  }

  if (payload.renderer === 'document') {
    return [EXPORT_FORMATS.json, EXPORT_FORMATS.ndjson, EXPORT_FORMATS.csv]
  }

  if (payload.renderer === 'table') {
    return [EXPORT_FORMATS.csv, EXPORT_FORMATS.json, EXPORT_FORMATS.ndjson]
  }

  if (payload.renderer === 'keyvalue') {
    return hasPlainTextKeyValue(payload)
      ? [EXPORT_FORMATS.json, EXPORT_FORMATS.txt]
      : [EXPORT_FORMATS.json]
  }

  if (rowLikeRecordsForPayload(payload).length > 0) {
    return [EXPORT_FORMATS.csv, EXPORT_FORMATS.json, EXPORT_FORMATS.ndjson]
  }

  return [EXPORT_FORMATS.json]
}

export function defaultExportOptionForPayload(payload: ResultPayload) {
  return exportOptionsForPayload(payload)[0] ?? EXPORT_FORMATS.json
}

export function createResultExportFile(
  payload: ResultPayload,
  result: ExecutionResultEnvelope | undefined,
  option: ResultExportOption,
): ExportResultFileRequest & { contents: string } {
  return {
    ...createResultExportFileMetadata(payload, result, option),
    contents: serializePayloadForExport(payload, option.format),
  }
}

export function createResultExportFileMetadata(
  payload: ResultPayload,
  result: ExecutionResultEnvelope | undefined,
  option: ResultExportOption,
): Omit<ExportResultFileRequest, 'contents'> {
  return {
    suggestedFileName: sanitizeFilename(
      `${result?.engine ?? 'datapadplusplus'}-${payload.renderer}-${result?.executedAt ?? 'result'}`,
    ),
    extension: option.extension,
    mimeType: option.mimeType,
  }
}

export function createResultExportFileReference(
  payload: ResultPayload,
  result: ExecutionResultEnvelope,
  tabId: string,
  option: ResultExportOption & { format: 'json' | 'ndjson' },
): ExportResultFileRequest {
  return {
    ...createResultExportFileMetadata(payload, result, option),
    resultReference: {
      tabId,
      resultId: result.id,
      renderer: payload.renderer,
      format: option.format,
    },
  }
}

export function serializePayloadForExport(
  payload: ResultPayload,
  format: ResultExportFormat,
) {
  const safePayload = sanitizePayloadForExport(payload)

  if (format === 'csv') {
    return sanitizeExportText(payloadToCsv(safePayload))
  }

  if (format === 'ndjson') {
    return sanitizeExportText(payloadToNdjson(safePayload))
  }

  if (format === 'txt') {
    return sanitizeExportText(payloadToPlainText(safePayload))
  }

  return sanitizeExportText(JSON.stringify(payloadToJsonValue(safePayload), null, 2))
}

function payloadToJsonValue(payload: ResultPayload): unknown {
  if (payload.renderer === 'batch') {
    return payload.sections.map((section) => ({
      id: section.id,
      label: section.label,
      statement: section.statement,
      status: section.status,
      durationMs: section.durationMs,
      rowCount: section.rowCount,
      notices: section.notices,
      result: payloadToJsonValue(sectionPrimaryPayload(section)),
    }))
  }

  if (payload.renderer === 'table') {
    return tableRowsToObjects(payload.columns, payload.rows)
  }

  if (payload.renderer === 'document') {
    return payload.documents
  }

  if (payload.renderer === 'json') {
    return payload.value
  }

  if (payload.renderer === 'keyvalue') {
    return {
      key: payload.key,
      type: payload.redisType,
      value: payload.value,
      entries: payload.entries,
      members: payload.members,
      ttl: payload.ttl,
      memoryUsage: payload.memoryUsage,
      metadata: payload.metadata,
      moduleMetadata: payload.moduleMetadata,
      disabledActions: payload.disabledActions,
    }
  }

  if (payload.renderer === 'schema') {
    return payload.items
  }

  if (payload.renderer === 'raw' || payload.renderer === 'resp') {
    return payload.text
  }

  const rowRecords = rowLikeRecordsForPayload(payload)
  return rowRecords.length > 0 ? rowRecords : payload
}

function payloadToCsv(payload: ResultPayload): string {
  if (payload.renderer === 'table') {
    return recordsToCsv(tableRowsToObjects(payload.columns, payload.rows))
  }

  if (payload.renderer === 'batch') {
    return recordsToCsv(batchRowRecords(payload))
  }

  return recordsToCsv(rowLikeRecordsForPayload(payload))
}

function payloadToNdjson(payload: ResultPayload): string {
  if (payload.renderer === 'batch') {
    return batchRowRecords(payload).map((record) => JSON.stringify(record)).join('\n')
  }

  const records = rowLikeRecordsForPayload(payload)

  if (records.length > 0) {
    return records.map((record) => JSON.stringify(record)).join('\n')
  }

  return JSON.stringify(payloadToJsonValue(payload))
}

function payloadToPlainText(payload: ResultPayload): string {
  if (payload.renderer === 'batch') {
    return payload.sections
      .map((section, index) => {
        const payloadText = payloadToPlainText(sectionPrimaryPayload(section))
        const title = `${section.label || `Result ${index + 1}`} (${section.status})`
        const statement = section.statement ? `\n${section.statement}` : ''

        return `${title}${statement}\n${payloadText}`
      })
      .join('\n\n')
  }

  if (payload.renderer === 'raw' || payload.renderer === 'resp') {
    return payload.text
  }

  if (payload.renderer === 'keyvalue') {
    if (isScalarExportValue(payload.value)) {
      return String(payload.value ?? '')
    }

    return Object.entries(payload.entries ?? {})
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')
  }

  return JSON.stringify(payloadToJsonValue(payload), null, 2)
}

function tableRowsToObjects(columns: string[], rows: string[][]) {
  return rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ''])),
  )
}

function rowLikeRecordsForPayload(payload: ResultPayload): Record<string, unknown>[] {
  if (payload.renderer === 'batch') {
    return batchRowRecords(payload)
  }

  if (payload.renderer === 'table') {
    return tableRowsToObjects(payload.columns, payload.rows)
  }

  if (payload.renderer === 'document') {
    return payload.documents
  }

  if (payload.renderer === 'schema') {
    return payload.items
  }

  const record = payload as unknown as Record<string, unknown>

  for (const key of ROW_LIKE_KEYS) {
    const value = record[key]

    if (Array.isArray(value) && value.every((item) => item && typeof item === 'object')) {
      return value as Record<string, unknown>[]
    }
  }

  return []
}

function batchRowRecords(payload: Extract<ResultPayload, { renderer: 'batch' }>) {
  return payload.sections.flatMap((section, sectionIndex) =>
    rowLikeRecordsForPayload(sectionPrimaryPayload(section)).map((record) => ({
      result: section.label || `Result ${sectionIndex + 1}`,
      status: section.status,
      ...record,
    })),
  )
}

function sectionPrimaryPayload(
  section: Extract<ResultPayload, { renderer: 'batch' }>['sections'][number],
): SingleResultPayload {
  return (
    section.payloads.find((payload) => payload.renderer === section.defaultRenderer) ??
    section.payloads[0] ?? {
      renderer: 'raw',
      text: '',
    }
  )
}

function recordsToCsv(records: Record<string, unknown>[]) {
  if (records.length === 0) {
    return ''
  }

  const flattenedRows = records.map((record) => flattenExportRecord(record))
  const columns = Array.from(
    flattenedRows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key))
      return keys
    }, new Set<string>()),
  )

  return [columns, ...flattenedRows.map((row) => columns.map((column) => row[column] ?? ''))]
    .map((row) => row.map((cell) => csvEscape(cell)).join(','))
    .join('\n')
}

function flattenExportRecord(
  value: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const next: Record<string, string> = {}

  for (const [key, entryValue] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (
      entryValue &&
      typeof entryValue === 'object' &&
      !Array.isArray(entryValue) &&
      shouldFlattenObject(entryValue)
    ) {
      Object.assign(
        next,
        flattenExportRecord(entryValue as Record<string, unknown>, path),
      )
      continue
    }

    next[path] = stringifyExportCell(entryValue)
  }

  return next
}

function shouldFlattenObject(value: object) {
  return Object.values(value).every(
    (entry) => entry === null || !Array.isArray(entry),
  )
}

function stringifyExportCell(value: unknown) {
  return formatResultCellValue(value)
}

function hasPlainTextKeyValue(payload: Extract<ResultPayload, { renderer: 'keyvalue' }>) {
  return isScalarExportValue(payload.value) || Object.keys(payload.entries ?? {}).length > 0
}

function isScalarExportValue(value: unknown) {
  return value === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof value)
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }

  return value
}

function sanitizeFilename(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

const EXPORT_FORMATS: Record<ResultExportFormat, ResultExportOption> = {
  csv: {
    format: 'csv',
    label: 'CSV',
    extension: 'csv',
    mimeType: 'text/csv;charset=utf-8',
    description: 'Rows or documents flattened for spreadsheets.',
  },
  json: {
    format: 'json',
    label: 'JSON',
    extension: 'json',
    mimeType: 'application/json;charset=utf-8',
    description: 'Formatted JSON with full result structure.',
  },
  ndjson: {
    format: 'ndjson',
    label: 'NDJSON',
    extension: 'ndjson',
    mimeType: 'application/x-ndjson;charset=utf-8',
    description: 'One row or document per line.',
  },
  txt: {
    format: 'txt',
    label: 'Text',
    extension: 'txt',
    mimeType: 'text/plain;charset=utf-8',
    description: 'Plain text output.',
  },
}

const ROW_LIKE_KEYS = [
  'rows',
  'documents',
  'items',
  'metrics',
  'series',
  'hits',
  'stages',
  'entries',
  'values',
  'records',
]
