import type { DatastoreWorkbenchSlice } from '../types'
import { WarehouseObjectViewWorkspace } from '../common/warehouse/WarehouseObjectViewWorkspace'

export const bigqueryWorkbenchSlice = {
  engine: 'bigquery',
  objectViewWorkspace: WarehouseObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
