import type {
  ConnectionProfile,
  DataEditChange,
  DataEditExecutionRequest,
  DataEditKind,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from './document-edit-context'
import type { DocumentGridRow } from './document-grid-model'

export function buildDocumentEditRequest(
  connection: ConnectionProfile,
  editContext: DocumentEditContext,
  documents: Array<Record<string, unknown>>,
  row: DocumentGridRow,
  editKind: DataEditKind,
  changes: DataEditChange[],
): DataEditExecutionRequest | undefined {
  if (connection.engine !== 'mongodb' && connection.engine !== 'cosmosdb') {
    return undefined
  }

  const collection = editContext.collection || collectionFromQueryText(editContext.queryText)
  const database = editContext.database || databaseFromQueryText(editContext.queryText)
  const documentId = documents[row.documentIndex]?._id

  if (!collection || documentId === undefined) {
    return undefined
  }

  return {
    connectionId: editContext.connectionId,
    environmentId: editContext.environmentId,
    editKind,
    target: {
      objectKind: 'document',
      path: pathSegments(row.path),
      ...(database ? { database } : {}),
      collection,
      documentId,
    },
    changes,
  }
}

export function pathSegments(path: Array<string | number>) {
  return path.map((item) => String(item))
}

export function valueTypeName(value: unknown) {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  return typeof value
}

function collectionFromQueryText(queryText: string) {
  try {
    const parsed = JSON.parse(queryText) as { collection?: unknown }
    return typeof parsed.collection === 'string' && parsed.collection.trim()
      ? parsed.collection
      : undefined
  } catch {
    return undefined
  }
}

function databaseFromQueryText(queryText: string) {
  try {
    const parsed = JSON.parse(queryText) as { database?: unknown }
    return typeof parsed.database === 'string' && parsed.database.trim()
      ? parsed.database
      : undefined
  } catch {
    return undefined
  }
}
