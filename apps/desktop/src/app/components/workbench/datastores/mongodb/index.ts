import type { DatastoreWorkbenchSlice } from '../types'
import { MongoObjectViewWorkspace } from './MongoObjectViewWorkspace'

export const mongodbWorkbenchSlice = {
  engine: 'mongodb',
  objectViewWorkspace: MongoObjectViewWorkspace,
  query: {
    supportsScripting: true,
    supportsDocumentEfficiency: true,
    supportsAddDocument: true,
    requiresStructureRefresh: () => true,
  },
} satisfies DatastoreWorkbenchSlice
