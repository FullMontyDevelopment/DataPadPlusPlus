import { prepareCosmosExecution } from '../../query-builder/cosmos-execution'
import type { DatastoreWorkbenchSlice } from '../types'
import { CosmosObjectViewWorkspace } from './CosmosObjectViewWorkspace'
import { CosmosSqlEditorWorkspace } from './CosmosSqlEditorWorkspace'
import {
  cosmosSqlEditorStateFromBuilder,
  createCosmosSqlQueryEditorState,
  isCosmosSqlBuilderState,
} from '../../query-builder/cosmos-sql'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  DOCUMENT_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const cosmosdbWorkbenchSlice = {
  engine: 'cosmosdb',
  query: {
    modeLabels: {
      builder: 'Query Builder',
      raw: 'Query Editor',
    },
    requiresStructureRefresh: () => true,
    Editor: CosmosSqlEditorWorkspace,
    resolveEditorState(tab, builderState) {
      if (!isCosmosSqlBuilderState(builderState)) return undefined
      if (tab.queryEditorState?.kind === 'cosmos-sql') return tab.queryEditorState
      return createCosmosSqlQueryEditorState(tab.queryText, builderState)
    },
    applyEditorState(builderState, editorState) {
      return isCosmosSqlBuilderState(builderState) && editorState.kind === 'cosmos-sql'
        ? { ...builderState, editorState }
        : builderState
    },
    editorStateFromBuilder(builderState) {
      return isCosmosSqlBuilderState(builderState)
        ? cosmosSqlEditorStateFromBuilder(builderState)
        : undefined
    },
    editorText(editorState) {
      return editorState.kind === 'cosmos-sql' ? editorState.sql : ''
    },
    prepareExecution: prepareCosmosExecution,
  },
  explorer: createDatastoreExplorerProvider({
    engine: 'cosmosdb',
    family: 'document',
    label: 'Cosmos DB',
    inspectionKinds: DOCUMENT_EXPLORER_INSPECTION_KINDS,
    launchKinds: ['items'],
  }),
  objectView: createDatastoreObjectViewProvider('cosmosdb', CosmosObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
