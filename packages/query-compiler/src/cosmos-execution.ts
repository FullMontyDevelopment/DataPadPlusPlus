import type { DatastoreQueryEditorState, QueryBuilderState } from '@datapadplusplus/shared-types'
import { buildCosmosSqlRequest, createCosmosSqlQueryEditorState, isCosmosSqlBuilderState, validateCosmosSqlEditorState } from './cosmos-sql'

export function prepareCosmosExecution(input: { tab: { queryText: string }; builderState?: QueryBuilderState; editorState?: DatastoreQueryEditorState; mode: string; selectedText?: string }) {
  const { tab, builderState, editorState, mode, selectedText } = input
  if (!isCosmosSqlBuilderState(builderState)) return { queryText: tab.queryText, errors: ['Cosmos DB query state is unavailable.'] }
  if (mode === 'builder') {
    const request = buildCosmosSqlRequest(builderState)
    return { queryText: request.query, builderState, datastoreExecutionInput: {
      kind: 'cosmos-sql' as const, database: request.database, container: request.container,
      sql: request.query, parameters: request.parameters,
      ...(Object.prototype.hasOwnProperty.call(request, 'partitionKey') ? { partitionKey: request.partitionKey } : {}),
      enableCrossPartitionQueries: request.enableCrossPartitionQueries,
    } }
  }
  const state = editorState?.kind === 'cosmos-sql' ? editorState : createCosmosSqlQueryEditorState(tab.queryText, builderState)
  const validation = validateCosmosSqlEditorState(state, {database:builderState.database,container:builderState.container}, selectedText)
  return { queryText:selectedText?.trim() || state.sql, builderState, datastoreExecutionInput:validation.input, errors:validation.errors, warnings:validation.warnings }
}
