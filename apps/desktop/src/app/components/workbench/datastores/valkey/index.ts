import type { DatastoreWorkbenchSlice } from '../types'
import { RedisObjectViewWorkspace } from '../common/keyvalue/RedisObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  KEY_VALUE_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const valkeyWorkbenchSlice = {
  engine: 'valkey',
  explorer: createDatastoreExplorerProvider({
    engine: 'valkey',
    family: 'keyvalue',
    label: 'Valkey',
    inspectionKinds: KEY_VALUE_EXPLORER_INSPECTION_KINDS,
    launchKinds: ['keys'],
  }),
  objectView: createDatastoreObjectViewProvider('valkey', RedisObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
