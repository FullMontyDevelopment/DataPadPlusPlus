import type { DatastoreWorkbenchSlice } from '../types'
import { WarehouseObjectViewWorkspace } from '../common/warehouse/WarehouseObjectViewWorkspace'
import { ClickHouseObjectViewInsights } from './ClickHouseObjectViewInsights'

export const clickhouseWorkbenchSlice = {
  engine: 'clickhouse',
  objectViewWorkspace: WarehouseObjectViewWorkspace,
  warehouseInsights: ClickHouseObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
