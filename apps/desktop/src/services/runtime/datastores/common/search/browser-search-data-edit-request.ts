import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

export function searchDataEditRequest(request: DataEditPlanRequest) {
  const index = request.target.table ?? '<index>'
  const documentId = request.target.documentId ?? '<document-id>'

  if (request.editKind === 'delete-document') {
    return `DELETE /${index}/_doc/${documentId}?refresh=true`
  }

  const document = request.changes[0]?.value ?? Object.fromEntries(
    request.changes.map((change) => [change.field ?? dataEditPath(change.field, change.path), change.value ?? null]),
  )

  if (request.editKind === 'update-document') {
    return JSON.stringify(
      {
        method: 'POST',
        path: `/${index}/_update/${documentId}?refresh=true`,
        body: { doc: document },
      },
      null,
      2,
    )
  }

  return JSON.stringify(
    {
      method: 'PUT',
      path: `/${index}/_doc/${documentId}?refresh=true`,
      body: document,
    },
    null,
    2,
  )
}

function dataEditPath(field?: string, path?: string[]) {
  return path?.length ? path.join('.') : field ?? '<field>'
}
