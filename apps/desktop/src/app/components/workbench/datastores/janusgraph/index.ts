import type { DatastoreWorkbenchSlice } from '../types'
import { GraphObjectViewWorkspace } from '../common/graph/GraphObjectViewWorkspace'

export const janusgraphWorkbenchSlice = {
  engine: 'janusgraph',
  objectViewWorkspace: GraphObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
