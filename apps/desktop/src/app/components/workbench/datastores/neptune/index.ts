import type { DatastoreWorkbenchSlice } from '../types'
import { GraphObjectViewWorkspace } from '../common/graph/GraphObjectViewWorkspace'

export const neptuneWorkbenchSlice = {
  engine: 'neptune',
  objectViewWorkspace: GraphObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
