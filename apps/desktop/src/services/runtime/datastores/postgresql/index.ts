import type { DatastoreRuntimeSlice } from '../types'
import { createPostgresExplorerNodes } from '../common/sql/browser-postgres-family-explorer'
import {
  postgresInspectPayload,
  postgresInspectQueryTemplate,
} from '../common/sql/browser-postgres-family-payloads'
import { sqlDataEditRequest } from '../common/sql/browser-sql-data-edit-request'
import { sqlOperationRequest } from '../common/sql/browser-sql-operations'

export const postgresqlRuntimeSlice = {
  engine: 'postgresql',
  explorer: {
    createNodes: createPostgresExplorerNodes,
    inspectQueryTemplate: postgresInspectQueryTemplate,
    inspectPayload: postgresInspectPayload,
  },
  operation: {
    buildRequest: sqlOperationRequest,
  },
  dataEdit: {
    buildRequest: sqlDataEditRequest,
  },
} satisfies DatastoreRuntimeSlice
