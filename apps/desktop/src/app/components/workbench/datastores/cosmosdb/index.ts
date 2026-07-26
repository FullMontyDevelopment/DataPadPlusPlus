import type { DatastoreWorkbenchSlice } from '../types'
import { CosmosObjectViewWorkspace } from './CosmosObjectViewWorkspace'
import { CosmosSqlEditorWorkspace } from './CosmosSqlEditorWorkspace'
import {
  buildCosmosSqlRequest,
  cosmosSqlEditorStateFromBuilder,
  createCosmosSqlQueryEditorState,
  isCosmosSqlBuilderState,
  validateCosmosSqlEditorState,
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
    prepareExecution({ tab, builderState, editorState, mode, selectedText }) {
      if (!isCosmosSqlBuilderState(builderState)) {
        return { queryText: tab.queryText, errors: ['Cosmos DB query state is unavailable.'] }
      }
      if (mode === 'builder') {
        const request = buildCosmosSqlRequest(builderState)
        return {
          queryText: request.query,
          builderState,
          datastoreExecutionInput: {
            kind: 'cosmos-sql',
            database: request.database,
            container: request.container,
            sql: request.query,
            parameters: request.parameters,
            ...(Object.prototype.hasOwnProperty.call(request, 'partitionKey')
              ? { partitionKey: request.partitionKey }
              : {}),
            enableCrossPartitionQueries: request.enableCrossPartitionQueries,
          },
        }
      }
      const resolvedState = editorState?.kind === 'cosmos-sql'
        ? editorState
        : createCosmosSqlQueryEditorState(tab.queryText, builderState)
      const validation = validateCosmosSqlEditorState(
        resolvedState,
        {
          database: builderState.database,
          container: builderState.container,
        },
        selectedText,
      )
      return {
        queryText: selectedText?.trim() || resolvedState.sql,
        builderState,
        datastoreExecutionInput: validation.input,
        errors: validation.errors,
        warnings: validation.warnings,
      }
    },
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
