import type { DatastoreWorkbenchSlice } from '../types'
import { RedisObjectViewWorkspace } from '../common/keyvalue/RedisObjectViewWorkspace'

export const valkeyWorkbenchSlice = {
  engine: 'valkey',
  objectViewWorkspace: RedisObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
