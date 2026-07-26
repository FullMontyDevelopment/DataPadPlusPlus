import type { DatastoreWorkbenchSlice } from '../types'
import { WarehouseObjectViewWorkspace } from '../common/warehouse/WarehouseObjectViewWorkspace'
import { ClickHouseObjectViewInsights } from './ClickHouseObjectViewInsights'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  WAREHOUSE_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const clickhouseWorkbenchSlice = {
  engine: 'clickhouse',
  explorer: createDatastoreExplorerProvider({
    engine: 'clickhouse',
    family: 'warehouse',
    label: 'ClickHouse',
    inspectionKinds: WAREHOUSE_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-databases', 'system-tables'],
  }),
  objectView: createDatastoreObjectViewProvider('clickhouse', WarehouseObjectViewWorkspace),
  warehouseInsights: ClickHouseObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
