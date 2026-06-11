import type { DatastoreWorkbenchSlice } from '../types'
import { SearchObjectViewWorkspace } from '../common/search/SearchObjectViewWorkspace'

export const opensearchWorkbenchSlice = {
  engine: 'opensearch',
  objectViewWorkspace: SearchObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
