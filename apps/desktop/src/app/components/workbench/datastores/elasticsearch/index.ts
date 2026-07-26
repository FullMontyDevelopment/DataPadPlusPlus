import type { DatastoreWorkbenchSlice } from '../types'
import { SearchObjectViewWorkspace } from '../common/search/SearchObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  SEARCH_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const elasticsearchWorkbenchSlice = {
  engine: 'elasticsearch',
  explorer: createDatastoreExplorerProvider({
    engine: 'elasticsearch',
    family: 'search',
    label: 'Elasticsearch',
    inspectionKinds: SEARCH_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-indices'],
  }),
  objectView: createDatastoreObjectViewProvider('elasticsearch', SearchObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
