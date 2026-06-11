import type { DatastoreRuntimeSlice } from '../types'
import {
  createWarehouseExplorerNodes,
  warehouseInspectPayload,
  warehouseInspectQueryTemplate,
} from '../common/warehouse/browser-warehouse-explorer'
import { warehouseOperationRequest } from '../common/warehouse/browser-warehouse-operations'

export const snowflakeRuntimeSlice = {
  engine: 'snowflake',
  explorer: {
    createNodes: createWarehouseExplorerNodes,
    inspectQueryTemplate: warehouseInspectQueryTemplate,
    inspectPayload: warehouseInspectPayload,
  },
  operation: {
    buildRequest: warehouseOperationRequest,
  },
} satisfies DatastoreRuntimeSlice
