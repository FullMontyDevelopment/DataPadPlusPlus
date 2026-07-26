import type { DatastoreWorkbenchSlice } from '../types'
import { LiteDbObjectViewWorkspace } from './LiteDbObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  DOCUMENT_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const litedbWorkbenchSlice = {
  engine: 'litedb',
  explorer: createDatastoreExplorerProvider({
    engine: 'litedb',
    family: 'document',
    label: 'LiteDB',
    inspectionKinds: DOCUMENT_EXPLORER_INSPECTION_KINDS,
  }),
  objectView: createDatastoreObjectViewProvider('litedb', LiteDbObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
