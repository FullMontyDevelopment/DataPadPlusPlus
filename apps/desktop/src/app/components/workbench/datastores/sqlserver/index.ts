import type { DatastoreWorkbenchSlice } from '../types'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import { SqlServerObjectViewInsights } from './SqlServerObjectViewInsights'
import { getSqlServerObjectViewDescriptor } from './SqlServerObjectViewDescriptors'

export const sqlserverWorkbenchSlice = {
  engine: 'sqlserver',
  objectViewWorkspace: RelationalObjectViewWorkspace,
  relationalDescriptor: getSqlServerObjectViewDescriptor,
  relationalInsights: SqlServerObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
