import type { DatastoreRuntimeSlice } from '../types'
import { sqlDataEditRequest } from '../common/sql/browser-sql-data-edit-request'
import { sqlOperationRequest } from '../common/sql/browser-sql-operations'
import {
  createSqliteExplorerNodes,
  sqliteInspectQueryTemplate,
} from './browser-sqlite-explorer'
import { sqliteInspectPayload } from './browser-sqlite-payloads'

export const sqliteRuntimeSlice = {
  engine: 'sqlite',
  explorer: {
    createNodes: createSqliteExplorerNodes,
    inspectQueryTemplate: (_connection, nodeId) => sqliteInspectQueryTemplate(nodeId),
    inspectPayload: (_connection, nodeId) => sqliteInspectPayload(nodeId),
  },
  operation: {
    buildRequest: sqlOperationRequest,
  },
  dataEdit: {
    buildRequest: sqlDataEditRequest,
  },
} satisfies DatastoreRuntimeSlice
