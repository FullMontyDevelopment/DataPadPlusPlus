import type { DatastoreRuntimeSlice } from '../types'
import { createCockroachExplorerNodes } from '../common/sql/browser-postgres-family-explorer'
import { sqlDataEditRequest } from '../common/sql/browser-sql-data-edit-request'
import { sqlOperationRequest } from '../common/sql/browser-sql-operations'
import { cockroachInspectPayload } from './browser-cockroach-payloads'
import { cockroachInspectQueryTemplate } from './browser-cockroach-query-templates'

export const cockroachdbRuntimeSlice = {
  engine: 'cockroachdb',
  explorer: {
    createNodes: createCockroachExplorerNodes,
    inspectQueryTemplate: cockroachInspectQueryTemplate,
    inspectPayload: cockroachInspectPayload,
  },
  operation: {
    buildRequest: sqlOperationRequest,
  },
  dataEdit: {
    buildRequest: sqlDataEditRequest,
  },
} satisfies DatastoreRuntimeSlice
