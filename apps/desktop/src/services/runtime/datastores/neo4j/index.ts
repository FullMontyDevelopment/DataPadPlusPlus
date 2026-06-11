import type { DatastoreRuntimeSlice } from '../types'
import {
  createGraphExplorerNodes,
  graphInspectPayload,
  graphInspectQueryTemplate,
} from '../common/graph/browser-graph-explorer'
import { graphOperationRequest } from '../common/graph/browser-graph-operations'

export const neo4jRuntimeSlice = {
  engine: 'neo4j',
  explorer: {
    createNodes: createGraphExplorerNodes,
    inspectQueryTemplate: graphInspectQueryTemplate,
    inspectPayload: graphInspectPayload,
  },
  operation: {
    buildRequest: graphOperationRequest,
  },
} satisfies DatastoreRuntimeSlice
