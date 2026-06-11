import type { DatastoreRuntimeSlice } from '../types'
import { sqlOperationRequest } from '../common/sql/browser-sql-operations'
import {
  createDuckDbExplorerNodes,
  duckDbInspectPayload,
  duckDbInspectQueryTemplate,
} from './browser-duckdb-explorer'

export const duckdbRuntimeSlice = {
  engine: 'duckdb',
  explorer: {
    createNodes: createDuckDbExplorerNodes,
    inspectQueryTemplate: (_connection, nodeId) => duckDbInspectQueryTemplate(nodeId),
    inspectPayload: duckDbInspectPayload,
  },
  operation: {
    buildRequest: sqlOperationRequest,
  },
} satisfies DatastoreRuntimeSlice
