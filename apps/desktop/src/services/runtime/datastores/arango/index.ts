import type { DatastoreRuntimeSlice } from '../types'
import {
  createGraphExplorerNodes,
  graphInspectPayload,
  graphInspectQueryTemplate,
} from '../common/graph/browser-graph-explorer'
import { graphOperationRequest } from '../common/graph/browser-graph-operations'
import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

export const arangoRuntimeSlice = {
  engine: 'arango',
  explorer: {
    createNodes: createGraphExplorerNodes,
    inspectQueryTemplate: graphInspectQueryTemplate,
    inspectPayload: graphInspectPayload,
  },
  operation: {
    buildRequest: graphOperationRequest,
  },
  dataEdit: {
    buildRequest: (_connection, request) => arangoDocumentEditRequest(request),
    permission: () => 'conditional replace/delete document with revision If-Match',
  },
} satisfies DatastoreRuntimeSlice

function arangoDocumentEditRequest(request: DataEditPlanRequest) {
  const collection = request.target.collection ?? '<collection>'
  const key = request.target.documentId ?? '<key>'
  return JSON.stringify({
    method: request.editKind === 'delete-document' ? 'DELETE' : 'PUT',
    path: `/_api/document/${collection}/${String(key)}?returnOld=true&returnNew=true`,
    headers: { 'If-Match': request.target.concurrencyToken ?? '<revision>' },
    body: request.editKind === 'delete-document' ? undefined : request.changes[0]?.value,
  }, null, 2)
}
