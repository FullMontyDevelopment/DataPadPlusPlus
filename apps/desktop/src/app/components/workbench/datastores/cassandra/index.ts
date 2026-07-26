import type { DatastoreWorkbenchSlice } from '../types'
import { CassandraObjectViewWorkspace } from './CassandraObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  WIDE_COLUMN_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const cassandraWorkbenchSlice = {
  engine: 'cassandra',
  explorer: createDatastoreExplorerProvider({
    engine: 'cassandra',
    family: 'widecolumn',
    label: 'Cassandra',
    inspectionKinds: WIDE_COLUMN_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-keyspaces'],
  }),
  objectView: createDatastoreObjectViewProvider('cassandra', CassandraObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
