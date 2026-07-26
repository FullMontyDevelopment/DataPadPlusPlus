import type { DatastoreWorkbenchSlice } from '../types'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import { SqliteObjectViewInsights } from './SqliteObjectViewInsights'
import { getSqliteObjectViewDescriptor } from './SqliteObjectViewDescriptors'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  RELATIONAL_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const sqliteWorkbenchSlice = {
  engine: 'sqlite',
  explorer: createDatastoreExplorerProvider({
    engine: 'sqlite',
    family: 'sql',
    label: 'SQLite',
    inspectionKinds: RELATIONAL_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['sqlite-catalog', 'temporary-schema'],
    supportsRelationshipMap: true,
  }),
  objectView: createDatastoreObjectViewProvider('sqlite', RelationalObjectViewWorkspace),
  relationalDescriptor: getSqliteObjectViewDescriptor,
  relationalInsights: SqliteObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
