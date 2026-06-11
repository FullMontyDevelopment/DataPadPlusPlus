import type { DatastoreWorkbenchSlice } from '../types'
import { CassandraObjectViewWorkspace } from './CassandraObjectViewWorkspace'

export const cassandraWorkbenchSlice = {
  engine: 'cassandra',
  objectViewWorkspace: CassandraObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
