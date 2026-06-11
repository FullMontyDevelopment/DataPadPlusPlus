import type { ConnectionProfile, DataEditPlanRequest } from '@datapadplusplus/shared-types'
import { sqlDataEditRequest } from './datastores/common/sql/browser-sql-data-edit-request'
import { runtimeSliceForEngine } from './datastores/registry'

export function browserDataEditWarnings(
  connection: ConnectionProfile,
  request: DataEditPlanRequest,
) {
  const warnings: string[] = []
  const target = request.target
  const sliceWarnings =
    runtimeSliceForEngine(connection.engine)?.dataEdit?.warnings?.(connection, request) ?? []

  if (isSqlRowEditConnection(connection) && !target.table) {
    warnings.push('SQL data edits need a target table.')
  }

  if (connection.engine === 'timescaledb') {
    warnings.push(...sliceWarnings)
  }

  if (
    isSqlRowEditConnection(connection) &&
    ['update-row', 'delete-row'].includes(request.editKind) &&
    isEmptyRecord(target.primaryKey)
  ) {
    warnings.push('SQL update/delete edits require a complete primary key predicate.')
  }

  if (connection.family === 'document') {
    if (!target.collection) {
      warnings.push('Document edits need a target collection.')
    }
    if (request.editKind !== 'insert-document' && target.documentId === undefined) {
      warnings.push('Document edits require a stable document id.')
    }
  }

  if (connection.family === 'keyvalue' && !target.key) {
    warnings.push('Key/value edits need a single concrete key.')
  }

  if (
    connection.family === 'keyvalue' &&
    request.editKind === 'stream-delete-entry' &&
    target.documentId === undefined &&
    request.changes.every((change) => !(change.field?.trim() || change.path?.[0]?.trim()))
  ) {
    warnings.push('Stream entry deletes need a concrete entry id.')
  }

  if (
    connection.family === 'keyvalue' &&
    request.editKind === 'timeseries-delete-sample' &&
    target.documentId === undefined &&
    request.changes.every((change) => !(change.field?.trim() || change.path?.[0]?.trim() || change.value !== undefined))
  ) {
    warnings.push('TimeSeries sample deletes need a concrete timestamp or range.')
  }

  if (
    connection.family === 'keyvalue' &&
    request.editKind === 'vector-remove-member' &&
    target.documentId === undefined &&
    request.changes.every((change) => !(change.field?.trim() || change.path?.[0]?.trim()))
  ) {
    warnings.push('Vector member removal needs a concrete element name.')
  }

  if (connection.family === 'widecolumn' && isEmptyRecord(target.primaryKey ?? target.itemKey)) {
    warnings.push('Wide-column edits require complete key conditions.')
  }

  if (connection.engine === 'dynamodb') {
    warnings.push(...sliceWarnings)
  }

  if (
    request.changes.length === 0 &&
    !['delete-row', 'delete-key', 'stream-delete-entry', 'timeseries-delete-sample', 'vector-remove-member', 'delete-item', 'delete-document', 'persist-ttl'].includes(request.editKind)
  ) {
    warnings.push('Data edits need at least one change.')
  }

  return warnings
}

export function browserDataEditPermission(
  connection: ConnectionProfile,
  request: DataEditPlanRequest,
) {
  const slicePermission = runtimeSliceForEngine(connection.engine)?.dataEdit?.permission
  if (slicePermission) {
    return slicePermission(connection, request)
  }

  if (isSqlRowEditConnection(connection)) {
    return `${request.editKind} on table`
  }

  if (connection.family === 'document') {
    return request.editKind === 'insert-document'
      ? 'insert collection document'
      : request.editKind === 'delete-document'
        ? 'delete collection document'
      : 'update collection document'
  }

  if (connection.family === 'keyvalue') {
    return 'write concrete key'
  }

  if (connection.family === 'widecolumn') {
    return 'write item/row with complete key'
  }

  return 'adapter-specific write permission'
}

export function browserDataEditRequest(
  connection: ConnectionProfile,
  request: DataEditPlanRequest,
) {
  return runtimeSliceForEngine(connection.engine)?.dataEdit?.buildRequest?.(connection, request) ??
    sqlDataEditRequest(connection, request)
}

function isSqlRowEditConnection(connection: ConnectionProfile) {
  return connection.family === 'sql' || connection.family === 'embedded-olap' || connection.engine === 'timescaledb'
}

function isEmptyRecord(value?: Record<string, unknown>) {
  return !value || Object.keys(value).length === 0
}
