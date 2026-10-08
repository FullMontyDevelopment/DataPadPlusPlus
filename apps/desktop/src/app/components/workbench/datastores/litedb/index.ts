import type { DatastoreWorkbenchSlice } from '../types'
import { LiteDbObjectViewWorkspace } from './LiteDbObjectViewWorkspace'
import { LiteDbFindBuilder } from './LiteDbFindBuilder'
import { isLiteDbFindBuilderState, parseLiteDbFindQueryText } from './litedb-find'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  DOCUMENT_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const litedbWorkbenchSlice = {
  engine: 'litedb',
  queryBuilder: {
    kind: 'litedb-find',
    Component: LiteDbFindBuilder,
    resolveState: (tab, draft) => isLiteDbFindBuilderState(draft) ? draft
      : isLiteDbFindBuilderState(tab.builderState) ? tab.builderState
      : parseLiteDbFindQueryText(tab.queryText),
  },
  explorer: createDatastoreExplorerProvider({
    engine: 'litedb',
    family: 'document',
    label: 'LiteDB',
    inspectionKinds: DOCUMENT_EXPLORER_INSPECTION_KINDS,
  }),
  objectView: createDatastoreObjectViewProvider('litedb', LiteDbObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
