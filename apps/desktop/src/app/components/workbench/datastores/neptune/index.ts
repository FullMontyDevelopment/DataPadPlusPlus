import type { DatastoreWorkbenchSlice } from '../types'
import { GraphObjectViewWorkspace } from '../common/graph/GraphObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  GRAPH_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const neptuneWorkbenchSlice = {
  engine: 'neptune',
  explorer: createDatastoreExplorerProvider({
    engine: 'neptune',
    family: 'graph',
    label: 'Amazon Neptune',
    inspectionKinds: GRAPH_EXPLORER_INSPECTION_KINDS,
  }),
  objectView: createDatastoreObjectViewProvider('neptune', GraphObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
