import type { DatastoreWorkbenchSlice } from '../types'
import { GraphObjectViewWorkspace } from '../common/graph/GraphObjectViewWorkspace'

export const neo4jWorkbenchSlice = {
  engine: 'neo4j',
  objectViewWorkspace: GraphObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
