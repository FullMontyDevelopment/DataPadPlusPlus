import type { DatastoreWorkbenchSlice } from '../types'
import { GraphObjectViewWorkspace } from '../common/graph/GraphObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  GRAPH_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const janusgraphWorkbenchSlice = {
  engine: 'janusgraph',
  explorer: createDatastoreExplorerProvider({
    engine: 'janusgraph',
    family: 'graph',
    label: 'JanusGraph',
    inspectionKinds: GRAPH_EXPLORER_INSPECTION_KINDS,
  }),
  objectView: createDatastoreObjectViewProvider('janusgraph', GraphObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
