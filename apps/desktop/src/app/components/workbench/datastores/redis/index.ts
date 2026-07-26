import type { DatastoreWorkbenchSlice } from '../types'
import { RedisObjectViewWorkspace } from '../common/keyvalue/RedisObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  KEY_VALUE_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const redisWorkbenchSlice = {
  engine: 'redis',
  explorer: createDatastoreExplorerProvider({
    engine: 'redis',
    family: 'keyvalue',
    label: 'Redis',
    inspectionKinds: KEY_VALUE_EXPLORER_INSPECTION_KINDS,
    launchKinds: ['keys'],
  }),
  objectView: createDatastoreObjectViewProvider('redis', RedisObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
