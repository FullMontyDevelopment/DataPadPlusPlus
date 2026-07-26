import type { DatastoreWorkbenchSlice } from '../types'
import { GraphObjectViewWorkspace } from '../common/graph/GraphObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  GRAPH_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const neo4jWorkbenchSlice = {
  engine: 'neo4j',
  explorer: createDatastoreExplorerProvider({
    engine: 'neo4j',
    family: 'graph',
    label: 'Neo4j',
    inspectionKinds: GRAPH_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-databases'],
  }),
  objectView: createDatastoreObjectViewProvider('neo4j', GraphObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
