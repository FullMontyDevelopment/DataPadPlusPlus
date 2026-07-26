import type { DatastoreWorkbenchSlice } from '../types'
import { WarehouseObjectViewWorkspace } from '../common/warehouse/WarehouseObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  WAREHOUSE_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const bigqueryWorkbenchSlice = {
  engine: 'bigquery',
  explorer: createDatastoreExplorerProvider({
    engine: 'bigquery',
    family: 'warehouse',
    label: 'BigQuery',
    inspectionKinds: WAREHOUSE_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-datasets'],
  }),
  objectView: createDatastoreObjectViewProvider('bigquery', WarehouseObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
