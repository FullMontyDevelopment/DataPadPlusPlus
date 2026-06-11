import type { DatastoreWorkbenchSlice } from '../types'
import { LiteDbObjectViewWorkspace } from './LiteDbObjectViewWorkspace'

export const litedbWorkbenchSlice = {
  engine: 'litedb',
  objectViewWorkspace: LiteDbObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
