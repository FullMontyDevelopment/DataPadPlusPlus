import type { DatastoreRuntimeSlice } from '../types'
import {
  cosmosInspectPayload,
  cosmosInspectQueryTemplate,
  createCosmosExplorerNodes,
} from './browser-cosmos-explorer'
import { cosmosOperationRequest } from './browser-cosmos-operations'
import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

export const cosmosdbRuntimeSlice = {
  engine: 'cosmosdb',
  explorer: {
    createNodes: createCosmosExplorerNodes,
    inspectQueryTemplate: (_connection, nodeId) => cosmosInspectQueryTemplate(nodeId),
    inspectPayload: cosmosInspectPayload,
  },
  operation: {
    buildRequest: (_connection, request) => cosmosOperationRequest(request),
  },
  dataEdit: {
    buildRequest: (_connection, request) => cosmosDocumentEditRequest(request),
    permission: () => 'conditional replace/delete document with partition key and If-Match',
  },
} satisfies DatastoreRuntimeSlice

function cosmosDocumentEditRequest(request: DataEditPlanRequest) {
  const database = request.target.database ?? '<database>'
  const container = request.target.collection ?? '<container>'
  const id = request.target.documentId ?? '<id>'
  return JSON.stringify({
    method: request.editKind === 'delete-document' ? 'DELETE' : 'PUT',
    path: `/dbs/${database}/colls/${container}/docs/${String(id)}`,
    headers: {
      'x-ms-documentdb-partitionkey': request.target.partitionKey ?? '<partition-key>',
      'If-Match': request.target.concurrencyToken ?? '<etag>',
    },
    body: request.editKind === 'delete-document' ? undefined : request.changes[0]?.value,
    retryPolicy: 'do-not-retry-ambiguous-writes',
  }, null, 2)
}
