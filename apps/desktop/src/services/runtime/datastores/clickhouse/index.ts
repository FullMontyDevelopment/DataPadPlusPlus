import type { DatastoreRuntimeSlice } from '../types'
import {
  createWarehouseExplorerNodes,
  warehouseInspectPayload,
  warehouseInspectQueryTemplate,
} from '../common/warehouse/browser-warehouse-explorer'
import { warehouseOperationRequest } from '../common/warehouse/browser-warehouse-operations'
import { clickHouseWarehousePayload } from './browser-clickhouse-payloads'

export const clickhouseRuntimeSlice = {
  engine: 'clickhouse',
  explorer: {
    createNodes: createWarehouseExplorerNodes,
    inspectQueryTemplate: warehouseInspectQueryTemplate,
    inspectPayload: (connection, nodeId) => warehouseInspectPayload(
      connection,
      nodeId,
      clickHouseWarehousePayload(connection),
    ),
  },
  operation: {
    buildRequest: warehouseOperationRequest,
  },
} satisfies DatastoreRuntimeSlice
