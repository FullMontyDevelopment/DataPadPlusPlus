import type { DatastoreWorkbenchSlice } from '../types'
import { MongoExplorerNavigator } from './MongoExplorerNavigator'
import { MongoExplorerWorkspace } from './MongoExplorerWorkspace'
import { MongoObjectViewWorkspace } from './MongoObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  DOCUMENT_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

const mongodbExplorerProvider = {
  ...createDatastoreExplorerProvider({
    engine: 'mongodb',
    family: 'document',
    label: 'MongoDB',
    inspectionKinds: DOCUMENT_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-databases'],
    launchKinds: ['documents', 'aggregations', 'sample-results', 'view-results'],
  }),
  Navigator: MongoExplorerNavigator,
  Workspace: MongoExplorerWorkspace,
}

export const mongodbWorkbenchSlice = {
  engine: 'mongodb',
  explorer: mongodbExplorerProvider,
  objectView: createDatastoreObjectViewProvider('mongodb', MongoObjectViewWorkspace),
  query: {
    supportsScripting: true,
    supportsDocumentEfficiency: true,
    supportsAddDocument: true,
    requiresStructureRefresh: () => true,
  },
} satisfies DatastoreWorkbenchSlice
