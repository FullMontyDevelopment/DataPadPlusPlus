import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

export function mongoDataEditRequest(request: DataEditPlanRequest) {
  if (request.editKind === 'insert-document') {
    return JSON.stringify(
      {
        database: request.target.database ?? '<database>',
        collection: request.target.collection ?? '<collection>',
        operation: 'insertOne',
        document: request.changes[0]?.value ?? {},
      },
      null,
      2,
    )
  }

  if (request.editKind === 'delete-document') {
    return JSON.stringify(
      {
        database: request.target.database ?? '<database>',
        collection: request.target.collection ?? '<collection>',
        operation: 'deleteOne',
        filter: mongoDocumentFilter(request),
      },
      null,
      2,
    )
  }

  if (request.editKind === 'update-document') {
    return JSON.stringify(
      {
        database: request.target.database ?? '<database>',
        collection: request.target.collection ?? '<collection>',
        operation: 'replaceOne',
        filter: mongoDocumentFilter(request),
        replacement: request.changes[0]?.value ?? {},
      },
      null,
      2,
    )
  }

  const update =
    request.editKind === 'unset-field'
      ? { $unset: documentPathObject(request, '') }
      : request.editKind === 'rename-field'
        ? { $rename: documentRenameObject(request) }
        : { $set: documentValueObject(request) }

  return JSON.stringify(
    {
      database: request.target.database ?? '<database>',
      collection: request.target.collection ?? '<collection>',
      filter: mongoDocumentFilter(request),
      update,
      multi: false,
    },
    null,
    2,
  )
}

function mongoDocumentFilter(request: DataEditPlanRequest) {
  const filter: Record<string, unknown> = {
    _id: request.target.documentId ?? '<_id>',
  }
  if (request.target.expectedDocument) {
    filter.$expr = {
      $eq: ['$$ROOT', { $literal: request.target.expectedDocument }],
    }
  }
  if (request.editKind === 'add-field') {
    const change = request.changes[0]
    filter[dataEditPath(change?.field, change?.path)] = { $exists: false }
  }
  return filter
}

function documentValueObject(request: DataEditPlanRequest) {
  return Object.fromEntries(
    request.changes.map((change) => [
      dataEditPath(change.field, change.path),
      change.value ?? null,
    ]),
  )
}

function documentPathObject(request: DataEditPlanRequest, value: string) {
  return Object.fromEntries(request.changes.map((change) => [dataEditPath(change.field, change.path), value]))
}

function documentRenameObject(request: DataEditPlanRequest) {
  return Object.fromEntries(
    request.changes.map((change) => {
      const path = dataEditPath(change.field, change.path)
      return [path, change.newName ?? path]
    }),
  )
}

function dataEditPath(field?: string, path?: string[]) {
  return path?.length ? path.join('.') : field ?? '<field>'
}
