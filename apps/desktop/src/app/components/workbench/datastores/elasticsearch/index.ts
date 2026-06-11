import type { DatastoreWorkbenchSlice } from '../types'
import { SearchObjectViewWorkspace } from '../common/search/SearchObjectViewWorkspace'

export const elasticsearchWorkbenchSlice = {
  engine: 'elasticsearch',
  objectViewWorkspace: SearchObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
