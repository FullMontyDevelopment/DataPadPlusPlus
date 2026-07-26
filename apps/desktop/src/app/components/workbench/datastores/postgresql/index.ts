import type { DatastoreWorkbenchSlice } from '../types'
import { PostgresObjectViewInsights } from './PostgresObjectViewInsights'
import { getPostgresObjectViewDescriptor } from '../common/sql/PostgresObjectViewDescriptors'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  RELATIONAL_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const postgresqlWorkbenchSlice = {
  engine: 'postgresql',
  explorer: createDatastoreExplorerProvider({
    engine: 'postgresql',
    family: 'sql',
    label: 'PostgreSQL',
    inspectionKinds: RELATIONAL_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-schemas'],
    supportsRelationshipMap: true,
  }),
  objectView: createDatastoreObjectViewProvider('postgresql', RelationalObjectViewWorkspace),
  relationalDescriptor: getPostgresObjectViewDescriptor,
  relationalInsights: PostgresObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
