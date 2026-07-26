import type { DatastoreWorkbenchSlice } from '../types'
import { getMysqlObjectViewDescriptor } from '../common/sql/MysqlObjectViewDescriptors'
import { MysqlObjectViewInsights } from '../common/sql/MysqlObjectViewInsights'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  RELATIONAL_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const mysqlWorkbenchSlice = {
  engine: 'mysql',
  explorer: createDatastoreExplorerProvider({
    engine: 'mysql',
    family: 'sql',
    label: 'MySQL',
    inspectionKinds: RELATIONAL_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-databases', 'system-schemas'],
    supportsRelationshipMap: true,
  }),
  objectView: createDatastoreObjectViewProvider('mysql', RelationalObjectViewWorkspace),
  relationalDescriptor: (kind: string) => getMysqlObjectViewDescriptor(kind, 'mysql'),
  relationalInsights: MysqlObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
