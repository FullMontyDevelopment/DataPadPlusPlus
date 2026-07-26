import type { DatastoreWorkbenchSlice } from '../types'
import { MemcachedObjectViewWorkspace } from './MemcachedObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  KEY_VALUE_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const memcachedWorkbenchSlice = {
  engine: 'memcached',
  explorer: createDatastoreExplorerProvider({
    engine: 'memcached',
    family: 'keyvalue',
    label: 'Memcached',
    inspectionKinds: KEY_VALUE_EXPLORER_INSPECTION_KINDS,
    launchKinds: ['known-key'],
  }),
  objectView: createDatastoreObjectViewProvider('memcached', MemcachedObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
