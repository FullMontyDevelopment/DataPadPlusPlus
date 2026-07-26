import type { DatastoreWorkbenchSlice } from '../types'
import { WarehouseObjectViewWorkspace } from '../common/warehouse/WarehouseObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  WAREHOUSE_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const snowflakeWorkbenchSlice = {
  engine: 'snowflake',
  explorer: createDatastoreExplorerProvider({
    engine: 'snowflake',
    family: 'warehouse',
    label: 'Snowflake',
    inspectionKinds: WAREHOUSE_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-databases', 'information-schema'],
  }),
  objectView: createDatastoreObjectViewProvider('snowflake', WarehouseObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
