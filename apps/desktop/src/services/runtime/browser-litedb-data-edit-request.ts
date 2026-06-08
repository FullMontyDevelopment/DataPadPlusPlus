import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

export function liteDbEditRequest(request: DataEditPlanRequest) {
  const collection = request.target.collection ?? '<collection>'
  const id = request.target.documentId ?? documentIdFromChange(request) ?? '<_id>'

  if (request.editKind === 'insert-document') {
    return JSON.stringify(
      {
        operation: 'InsertDocument',
        collection,
        id,
        document: request.changes[0]?.value ?? {},
        evidenceRequests: {
          before: null,
          after: { operation: 'FindById', collection, id },
        },
      },
      null,
      2,
    )
  }

  if (request.editKind === 'update-document') {
    return JSON.stringify(
      {
        operation: 'UpdateDocument',
        collection,
        id,
        document: request.changes[0]?.value ?? {},
        evidenceRequests: {
          before: { operation: 'FindById', collection, id },
          after: { operation: 'FindById', collection, id },
        },
      },
      null,
      2,
    )
  }

  if (request.editKind === 'delete-document') {
    return JSON.stringify(
      {
        operation: 'DeleteDocument',
        collection,
        id,
        evidenceRequests: {
          before: { operation: 'FindById', collection, id },
          after: { operation: 'FindById', collection, id },
        },
      },
      null,
      2,
    )
  }

  return JSON.stringify(
    {
      operation: 'UnsupportedDocumentEdit',
      collection,
      requestedEditKind: request.editKind,
      disabledReason:
        'LiteDB live document editing is currently scoped to insert-document, update-document, and delete-document.',
    },
    null,
    2,
  )
}

function documentIdFromChange(request: DataEditPlanRequest) {
  const value = request.changes[0]?.value
  return value && typeof value === 'object' && !Array.isArray(value) && '_id' in value
    ? (value as Record<string, unknown>)._id
    : undefined
}
