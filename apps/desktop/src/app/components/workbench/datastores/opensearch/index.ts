import type { DatastoreWorkbenchSlice } from '../types'
import { SearchObjectViewWorkspace } from '../common/search/SearchObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  SEARCH_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const opensearchWorkbenchSlice = {
  engine: 'opensearch',
  explorer: createDatastoreExplorerProvider({
    engine: 'opensearch',
    family: 'search',
    label: 'OpenSearch',
    inspectionKinds: SEARCH_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-indices'],
  }),
  objectView: createDatastoreObjectViewProvider('opensearch', SearchObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
