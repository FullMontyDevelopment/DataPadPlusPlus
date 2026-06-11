import type { DatastoreWorkbenchSlice } from '../types'
import { MemcachedObjectViewWorkspace } from './MemcachedObjectViewWorkspace'

export const memcachedWorkbenchSlice = {
  engine: 'memcached',
  objectViewWorkspace: MemcachedObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
