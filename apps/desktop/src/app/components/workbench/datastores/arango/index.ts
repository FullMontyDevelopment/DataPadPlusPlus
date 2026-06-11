import type { DatastoreWorkbenchSlice } from '../types'
import { GraphObjectViewWorkspace } from '../common/graph/GraphObjectViewWorkspace'

export const arangoWorkbenchSlice = {
  engine: 'arango',
  objectViewWorkspace: GraphObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
