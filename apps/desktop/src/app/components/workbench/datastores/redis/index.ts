import type { DatastoreWorkbenchSlice } from '../types'
import { RedisObjectViewWorkspace } from '../common/keyvalue/RedisObjectViewWorkspace'

export const redisWorkbenchSlice = {
  engine: 'redis',
  objectViewWorkspace: RedisObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
