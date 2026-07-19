import type { DatastoreWorkbenchSlice } from '../types'
import { OracleObjectViewWorkspace } from './OracleObjectViewWorkspace'
import { connectionUsesManagedOracleRuntime } from '../../../../state/oracle-runtime'

export const oracleWorkbenchSlice = {
  engine: 'oracle',
  objectViewWorkspace: OracleObjectViewWorkspace,
  query: {
    requiresStructureRefresh: connectionUsesManagedOracleRuntime,
  },
} satisfies DatastoreWorkbenchSlice
