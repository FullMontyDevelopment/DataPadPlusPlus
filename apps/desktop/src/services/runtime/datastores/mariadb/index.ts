import type { DatastoreRuntimeSlice } from '../types'
import {
  createMysqlExplorerNodes,
  mysqlInspectQueryTemplate,
} from '../common/sql/browser-mysql-explorer'
import { mysqlInspectPayload } from '../common/sql/browser-mysql-payloads'
import { sqlDataEditRequest } from '../common/sql/browser-sql-data-edit-request'
import { sqlOperationRequest } from '../common/sql/browser-sql-operations'

export const mariadbRuntimeSlice = {
  engine: 'mariadb',
  explorer: {
    createNodes: createMysqlExplorerNodes,
    inspectQueryTemplate: mysqlInspectQueryTemplate,
    inspectPayload: mysqlInspectPayload,
  },
  operation: {
    buildRequest: sqlOperationRequest,
  },
  dataEdit: {
    buildRequest: sqlDataEditRequest,
  },
} satisfies DatastoreRuntimeSlice
