import type { DatastoreRuntimeSlice } from '../types'
import {
  createGraphExplorerNodes,
  graphInspectPayload,
  graphInspectQueryTemplate,
} from '../common/graph/browser-graph-explorer'
import { graphOperationRequest } from '../common/graph/browser-graph-operations'

export const janusgraphRuntimeSlice = {
  engine: 'janusgraph',
  explorer: {
    createNodes: createGraphExplorerNodes,
    inspectQueryTemplate: graphInspectQueryTemplate,
    inspectPayload: graphInspectPayload,
  },
  operation: {
    buildRequest: graphOperationRequest,
  },
} satisfies DatastoreRuntimeSlice
