import type { DatastoreWorkbenchSlice } from '../types'
import { OracleObjectViewWorkspace } from './OracleObjectViewWorkspace'

export const oracleWorkbenchSlice = {
  engine: 'oracle',
  objectViewWorkspace: OracleObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
