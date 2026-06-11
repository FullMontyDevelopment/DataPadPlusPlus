import type { DatastoreRuntimeSlice } from '../types'
import { sqlDataEditRequest } from '../common/sql/browser-sql-data-edit-request'
import { sqlOperationRequest } from '../common/sql/browser-sql-operations'
import {
  createSqlServerExplorerNodes,
  sqlServerInspectQueryTemplate,
} from './browser-sqlserver-explorer'
import { sqlServerInspectPayload } from './browser-sqlserver-payloads'

export const sqlserverRuntimeSlice = {
  engine: 'sqlserver',
  explorer: {
    createNodes: createSqlServerExplorerNodes,
    inspectQueryTemplate: sqlServerInspectQueryTemplate,
    inspectPayload: sqlServerInspectPayload,
  },
  operation: {
    buildRequest: sqlOperationRequest,
  },
  dataEdit: {
    buildRequest: sqlDataEditRequest,
  },
} satisfies DatastoreRuntimeSlice
