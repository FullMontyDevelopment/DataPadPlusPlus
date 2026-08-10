import type {
  ConnectionProfile,
  DataEditChange,
  DataEditExecutionRequest,
  DataEditKind,
  DataEditTarget,
  DocumentEditMetadata,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from './document-edit-context'
import type { DocumentGridRow } from './document-grid-model'
import { valueAtPath } from './document-path-edits'

export interface DocumentEditTargetResolution {
  target?: DataEditTarget
  unavailableReason?: string
}

export function buildDocumentEditRequest(
  connection: ConnectionProfile,
  editContext: DocumentEditContext,
  documents: Array<Record<string, unknown>>,
  row: DocumentGridRow,
  editKind: DataEditKind,
  changes: DataEditChange[],
  editMetadata?: DocumentEditMetadata,
  nextDocuments?: Array<Record<string, unknown>>,
): DataEditExecutionRequest | undefined {
  const resolution = resolveDocumentEditTarget(
    connection,
    editContext,
    documents,
    row,
    editMetadata,
  )
  if (!resolution.target) {
    return undefined
  }

  const replacementDocument = nextDocuments?.[row.documentIndex]
  const executionChanges =
    connection.engine !== 'mongodb' &&
    editKind !== 'delete-document' &&
    editKind !== 'insert-document' &&
    replacementDocument
      ? [{ path: pathSegments(row.path), value: replacementDocument, valueType: 'object' }]
      : changes

  return {
    connectionId: editContext.connectionId,
    environmentId: editContext.environmentId,
    editKind,
    ...(editKind === 'delete-document'
      ? { confirmationText: documentConfirmationText(connection, editKind) }
      : {}),
    target: resolution.target,
    changes: executionChanges,
  }
}

export function resolveDocumentEditTarget(
  connection: ConnectionProfile,
  editContext: DocumentEditContext,
  documents: Array<Record<string, unknown>>,
  row: DocumentGridRow,
  editMetadata?: DocumentEditMetadata,
): DocumentEditTargetResolution {
  const document = documents[row.documentIndex]
  if (!document) {
    return { unavailableReason: 'The selected document is no longer present in this result.' }
  }

  if (editMetadata?.unavailableReason) {
    return { unavailableReason: editMetadata.unavailableReason }
  }

  const database = editContext.database || databaseFromQueryText(editContext.queryText)
  const requestedCollection = editContext.collection || collectionFromQueryText(editContext.queryText)
  const common = {
    objectKind: 'document',
    path: pathSegments(row.path),
    ...(database ? { database } : {}),
  }

  if (connection.engine === 'mongodb' || connection.engine === 'litedb') {
    if (!requestedCollection) {
      return { unavailableReason: 'Collection scope is missing from this result.' }
    }
    if (document._id === undefined) {
      return { unavailableReason: 'A stable _id is required to edit this document.' }
    }
    return {
      target: {
        ...common,
        collection: requestedCollection,
        documentId: document._id,
        expectedDocument: document,
      },
    }
  }

  if (connection.engine === 'cosmosdb') {
    if (!database || !requestedCollection) {
      return { unavailableReason: 'Cosmos DB database and container scope are required.' }
    }
    if (typeof document.id !== 'string' || !document.id) {
      return { unavailableReason: 'Cosmos DB editing requires a non-empty string id.' }
    }
    if (typeof document._etag !== 'string' || !document._etag) {
      return { unavailableReason: 'The projection omitted _etag, so concurrency cannot be guarded.' }
    }

    const partitionKeyPaths = editMetadata?.partitionKeyPaths
    if (!partitionKeyPaths?.length) {
      return { unavailableReason: 'Partition-key metadata is unavailable for this Cosmos DB result.' }
    }
    const values = partitionKeyPaths.map((path) => valueAtPath(document, path))
    if (values.some((value) => value === undefined)) {
      return { unavailableReason: 'The projection omitted one or more partition-key values.' }
    }

    return {
      target: {
        ...common,
        collection: requestedCollection,
        documentId: document.id,
        partitionKey: values.length === 1 ? values[0] : values,
        concurrencyToken: document._etag,
      },
    }
  }

  if (connection.engine === 'arango') {
    const id = typeof document._id === 'string' ? document._id : ''
    const separator = id.indexOf('/')
    const collection = separator > 0 ? id.slice(0, separator) : undefined
    const key = separator > 0 ? id.slice(separator + 1) : undefined
    if (!collection || !key || typeof document._key !== 'string') {
      return { unavailableReason: 'ArangoDB editing requires _id and _key identity fields.' }
    }
    if (document._key !== key || (requestedCollection && requestedCollection !== collection)) {
      return { unavailableReason: 'ArangoDB _id, _key, and collection identity do not agree.' }
    }
    if (typeof document._rev !== 'string' || !document._rev) {
      return { unavailableReason: 'The projection omitted _rev, so revision checks cannot be applied.' }
    }

    return {
      target: {
        ...common,
        collection,
        documentId: key,
        concurrencyToken: document._rev,
      },
    }
  }

  return { unavailableReason: `${connection.name} does not support guarded document editing.` }
}

export function buildDocumentDeleteRequest(
  connection: ConnectionProfile,
  editContext: DocumentEditContext,
  documents: Array<Record<string, unknown>>,
  row: DocumentGridRow,
  editMetadata?: DocumentEditMetadata,
) {
  if (row.path.length > 0) {
    return undefined
  }

  return buildDocumentEditRequest(
    connection,
    editContext,
    documents,
    row,
    'delete-document',
    [],
    editMetadata,
  )
}

export function documentEditUnavailableReason(
  connection: ConnectionProfile | undefined,
  editContext: DocumentEditContext | undefined,
  documents: Array<Record<string, unknown>>,
  row: DocumentGridRow,
  editMetadata?: DocumentEditMetadata,
) {
  if (!connection) return 'Connection details are unavailable.'
  if (connection.readOnly) return 'This connection is read-only.'
  if (!editContext) return 'This result is missing its execution scope.'
  return resolveDocumentEditTarget(connection, editContext, documents, row, editMetadata).unavailableReason
}

export function pathSegments(path: Array<string | number>) {
  return path.map((item) => String(item))
}

export function valueTypeName(value: unknown) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function parsedQueryText(queryText: string) {
  try {
    return JSON.parse(queryText) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function collectionFromQueryText(queryText: string) {
  const parsed = parsedQueryText(queryText)
  const value = parsed?.collection ?? parsed?.container
  return typeof value === 'string' && value.trim() ? value : undefined
}

function databaseFromQueryText(queryText: string) {
  const value = parsedQueryText(queryText)?.database
  return typeof value === 'string' && value.trim() ? value : undefined
}

function documentConfirmationText(
  connection: ConnectionProfile,
  editKind: Extract<DataEditKind, 'delete-document'>,
) {
  return `CONFIRM ${connection.engine.toUpperCase()} ${editKind.toUpperCase()}`
}
