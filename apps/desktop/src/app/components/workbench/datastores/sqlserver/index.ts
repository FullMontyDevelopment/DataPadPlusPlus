import type { DatastoreWorkbenchSlice } from '../types'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import { SqlServerObjectViewInsights } from './SqlServerObjectViewInsights'
import { getSqlServerObjectViewDescriptor } from './SqlServerObjectViewDescriptors'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  RELATIONAL_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const sqlserverWorkbenchSlice = {
  engine: 'sqlserver',
  explorer: createDatastoreExplorerProvider({
    engine: 'sqlserver',
    family: 'sql',
    label: 'SQL Server',
    inspectionKinds: RELATIONAL_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-databases', 'system-schemas', 'database-snapshots'],
    supportsRelationshipMap: true,
  }),
  objectView: createDatastoreObjectViewProvider('sqlserver', RelationalObjectViewWorkspace),
  relationalDescriptor: getSqlServerObjectViewDescriptor,
  relationalInsights: SqlServerObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
