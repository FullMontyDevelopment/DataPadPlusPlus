import type { DatastoreRuntimeSlice } from '../types'
import { sqlOperationRequest } from '../common/sql/browser-sql-operations'
import { oracleDataEditRequest } from './browser-oracle-data-edit-request'
import {
  createOracleExplorerNodes,
  oracleInspectPayload,
  oracleInspectQueryTemplate,
} from './browser-oracle-explorer'

export const oracleRuntimeSlice = {
  engine: 'oracle',
  explorer: {
    createNodes: createOracleExplorerNodes,
    inspectQueryTemplate: (_connection, nodeId) => oracleInspectQueryTemplate(nodeId),
    inspectPayload: oracleInspectPayload,
  },
  operation: {
    buildRequest: sqlOperationRequest,
  },
  dataEdit: {
    buildRequest: (_connection, request) => oracleDataEditRequest(request),
  },
} satisfies DatastoreRuntimeSlice
