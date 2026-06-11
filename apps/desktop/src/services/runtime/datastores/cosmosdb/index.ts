import type { DatastoreRuntimeSlice } from '../types'
import {
  cosmosInspectPayload,
  cosmosInspectQueryTemplate,
  createCosmosExplorerNodes,
} from './browser-cosmos-explorer'
import { cosmosOperationRequest } from './browser-cosmos-operations'

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
} satisfies DatastoreRuntimeSlice
