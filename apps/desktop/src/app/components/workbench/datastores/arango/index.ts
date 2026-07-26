import type { DatastoreWorkbenchSlice } from '../types'
import { GraphObjectViewWorkspace } from '../common/graph/GraphObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  GRAPH_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const arangoWorkbenchSlice = {
  engine: 'arango',
  explorer: createDatastoreExplorerProvider({
    engine: 'arango',
    family: 'graph',
    label: 'ArangoDB',
    inspectionKinds: GRAPH_EXPLORER_INSPECTION_KINDS,
  }),
  objectView: createDatastoreObjectViewProvider('arango', GraphObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
