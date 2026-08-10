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

  if ([
    'add-field',
    'set-field',
    'unset-field',
    'rename-field',
    'change-field-type',
    'update-document',
  ].includes(request.editKind)) {
    return JSON.stringify(
      {
        operation: 'UpdateDocument',
        collection,
        id,
        document: request.changes[0]?.value ?? {},
        previousDocument: request.target.expectedDocument,
        editKind: request.editKind,
        path: request.target.path,
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
        previousDocument: request.target.expectedDocument,
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
        'LiteDB document editing requires a guarded insert, field mutation, replacement, or delete operation.',
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
