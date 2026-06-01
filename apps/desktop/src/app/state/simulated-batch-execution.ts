import type {
  ConnectionProfile,
  QueryTabState,
  ResultPayload,
  SingleResultPayload,
} from '@datapadplusplus/shared-types'
import { createId } from './query-defaults'

export function previewBatchSections(
  connection: ConnectionProfile,
  tab: QueryTabState,
  payloads: ResultPayload[],
) {
  const statements = previewStatements(connection, tab)
  if (statements.length <= 1) {
    return []
  }

  const primaryPayload = firstSinglePayload(payloads)
  return statements.map((statement, index) => ({
    id: createId('batch-section'),
    label: connection.family === 'keyvalue' ? `Command ${index + 1}` : `Result ${index + 1}`,
    statement,
    status: 'success' as const,
    durationMs: 12 + index * 5,
    rowCount: resultPayloadSize(primaryPayload),
    defaultRenderer: primaryPayload.renderer,
    rendererModes: [primaryPayload.renderer],
    payloads: [primaryPayload],
    notices: [],
  }))
}

function firstSinglePayload(payloads: ResultPayload[]): SingleResultPayload {
  const primary = payloads.find((payload) => payload.renderer !== 'batch')

  return primary ?? { renderer: 'raw', text: 'OK' }
}

function previewStatements(connection: ConnectionProfile, tab: QueryTabState) {
  const text = tab.queryViewMode === 'script'
    ? tab.scriptText || tab.queryText
    : tab.queryText

  if (connection.family === 'keyvalue') {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  }

  if (
    connection.family === 'sql' ||
    connection.family === 'warehouse' ||
    connection.family === 'widecolumn' ||
    tab.queryViewMode === 'script'
  ) {
    return text
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}

function resultPayloadSize(payload: ResultPayload | undefined) {
  if (!payload) {
    return 0
  }

  if (payload.renderer === 'table') {
    return Array.isArray(payload.rows) ? payload.rows.length : 0
  }

  if (payload.renderer === 'document') {
    return Array.isArray(payload.documents) ? payload.documents.length : 0
  }

  if (payload.renderer === 'keyvalue') {
    return payload.entries && typeof payload.entries === 'object' && !Array.isArray(payload.entries)
      ? Object.keys(payload.entries).length
      : 0
  }

  if (payload.renderer === 'schema') {
    return Array.isArray(payload.items) ? payload.items.length : 0
  }

  if (payload.renderer === 'batch') {
    return Array.isArray(payload.sections) ? payload.sections.length : 0
  }

  return 1
}
