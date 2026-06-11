import type { DatastoreWorkbenchSlice } from '../types'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import { SqliteObjectViewInsights } from './SqliteObjectViewInsights'
import { getSqliteObjectViewDescriptor } from './SqliteObjectViewDescriptors'

export const sqliteWorkbenchSlice = {
  engine: 'sqlite',
  objectViewWorkspace: RelationalObjectViewWorkspace,
  relationalDescriptor: getSqliteObjectViewDescriptor,
  relationalInsights: SqliteObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
