import type { DatastoreWorkbenchSlice } from '../types'
import { OracleObjectViewWorkspace } from './OracleObjectViewWorkspace'
import { connectionUsesManagedOracleRuntime } from '../../../../state/oracle-runtime'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  RELATIONAL_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const oracleWorkbenchSlice = {
  engine: 'oracle',
  explorer: createDatastoreExplorerProvider({
    engine: 'oracle',
    family: 'sql',
    label: 'Oracle',
    inspectionKinds: RELATIONAL_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-schemas', 'system-tables'],
    supportsRelationshipMap: true,
  }),
  objectView: createDatastoreObjectViewProvider('oracle', OracleObjectViewWorkspace),
  query: {
    requiresStructureRefresh: connectionUsesManagedOracleRuntime,
  },
} satisfies DatastoreWorkbenchSlice
