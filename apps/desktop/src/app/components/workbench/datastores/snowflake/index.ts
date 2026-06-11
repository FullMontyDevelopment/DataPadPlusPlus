import type { DatastoreWorkbenchSlice } from '../types'
import { WarehouseObjectViewWorkspace } from '../common/warehouse/WarehouseObjectViewWorkspace'

export const snowflakeWorkbenchSlice = {
  engine: 'snowflake',
  objectViewWorkspace: WarehouseObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
