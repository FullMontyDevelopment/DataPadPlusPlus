import type { ConnectionProfile, DatastoreTestSuiteDefinition, QueryBuilderState, QueryTabState } from '@datapadplusplus/shared-types'
import { compileQueryBuilderState } from './query-builder-routing'
import { schemas } from './schemas'
import { validateShape } from './schema-validation'
import { prepareCosmosExecution } from './cosmos-execution'
import { buildRedisKeyBrowserQueryText } from './redis-key-browser'

export { compileQueryBuilderState } from './query-builder-routing'

const engines: Record<string, readonly string[]> = {
  'mongo-find': ['mongodb'], 'mongo-aggregation': ['mongodb'],
  'cosmos-sql': ['cosmosdb'], 'dynamodb-key-condition': ['dynamodb'],
  'cql-partition': ['cassandra'], 'search-dsl': ['elasticsearch', 'opensearch'],
  'redis-key-browser': ['redis', 'valkey'],
  'sql-select': ['postgresql', 'mysql', 'mariadb', 'sqlserver', 'sqlite', 'cockroachdb', 'oracle', 'duckdb', 'timescaledb', 'clickhouse', 'snowflake', 'bigquery'],
}

export function compileSavedBuilder(input: { builderState: unknown; connection: ConnectionProfile; tab?: QueryTabState }) {
  const shapeError = validateShape(input.builderState, schemas.QueryBuilderState)
  if (shapeError) return { ok: false, errors: [{ message: shapeError }] }
  const state = input.builderState as QueryBuilderState
  if (!engines[state.kind]?.includes(input.connection.engine)) {
    return { ok: false, errors: [{ message: 'This builder is not executable for the selected datastore.' }] }
  }
  const shape = state as unknown as Record<string, unknown>
  for (const field of ['limit', 'skip', 'offset']) {
    const value = shape[field]
    if (value !== undefined && (!Number.isSafeInteger(value) || Number(value) < 0)) {
      return { ok: false, errors: [{ field, message: 'Enter a non-negative safe integer.' }] }
    }
  }
  if (state.kind === 'redis-key-browser') {
    for (const value of [state.databaseIndex, state.scanCount, state.pageSize]) {
      if (value != null && (!Number.isSafeInteger(value) || value < 0)) return { ok: false, errors: [{ message: 'Key browser database and page sizes must be non-negative safe integers.' }] }
    }
    const queryText = buildRedisKeyBrowserQueryText(state)
    return { ok: true, queryText, errors: [], builderState: { ...state, lastAppliedQueryText: queryText } }
  }
  if (state.kind === 'mongo-find') {
    const groups = state.filterGroups ?? []
    if (new Set(groups.map((group) => group.id)).size !== groups.length
      || state.filters.some((row) => row.groupId && !groups.some((group) => group.id === row.groupId))) {
      return { ok: false, errors: [{ message: 'Filter groups must have unique IDs and every grouped filter must reference an existing group.' }] }
    }
  }
  const compiled = compileQueryBuilderState(state, input.connection, input.tab)
  if (!compiled.ok || !compiled.queryText?.trim()) return { ok: false, errors: compiled.errors.length ? compiled.errors : [{ message: 'The builder did not produce an executable query.' }] }
  return { ...compiled, builderState: { ...state, lastAppliedQueryText: compiled.queryText } }
}

export function validateSuiteShape(suite: unknown) {
  const error = validateShape(suite, schemas.DatastoreTestSuiteDefinition)
  if (error) return { ok: false, errors: [{ message: error }] }
  const definition = suite as DatastoreTestSuiteDefinition
  const errors: Array<{ caseId?: string; stepId?: string; message: string }> = []
  const identifiers = new Set<string>()
  const unique = (id: string) => {
    if (!id.trim() || identifiers.has(id)) return false
    identifiers.add(id)
    return true
  }
  for (const testCase of definition.cases) {
    if (!unique(testCase.id) || !testCase.name.trim()) errors.push({ caseId: testCase.id, message: 'Cases need unique non-empty IDs and names.' })
    const steps = [...testCase.setup, ...testCase.execute, ...testCase.teardown]
    for (const step of steps) {
      if (!unique(step.id)) errors.push({ caseId: testCase.id, stepId: step.id, message: 'Step IDs must be unique and non-empty.' })
      for (const field of ['rowLimit', 'timeoutMs'] as const) {
        if (step[field] !== undefined && (!Number.isSafeInteger(step[field]) || step[field] <= 0)) errors.push({ caseId: testCase.id, stepId: step.id, message: `${field} must be a positive safe integer.` })
      }
    }
    for (const assertion of testCase.assertions) {
      if (!unique(assertion.id)) errors.push({ caseId: testCase.id, message: 'Assertion IDs must be unique and non-empty.' })
      if (assertion.sourceStepId && !steps.some(step => step.id === assertion.sourceStepId)) errors.push({ caseId: testCase.id, message: 'Assertions must reference a step in the same case.' })
    }
    if (testCase.timeoutMs !== undefined && (!Number.isSafeInteger(testCase.timeoutMs) || testCase.timeoutMs <= 0)) errors.push({ caseId: testCase.id, message: 'Case timeout must be a positive safe integer.' })
  }
  return { ok: errors.length === 0, errors }
}

export function prepareSavedExecution(input: { connection: ConnectionProfile; tab: QueryTabState }) {
  const { tab, connection } = input
  const mode = tab.queryViewMode ?? 'raw'
  if (mode === 'builder' && tab.builderState?.kind === 'redis-key-browser') return { ok: false, errors: [{ message: 'This saved item is a key-browser layout, not an executable Redis command. It can be edited through MCP; save a raw Redis/Valkey command to run it.' }] }
  let queryText = mode === 'script' ? tab.scriptText ?? '' : tab.queryText
  if (mode === 'builder') {
    const result = compileSavedBuilder({builderState:tab.builderState,connection,tab})
    if (!result.ok) return result
    queryText = 'queryText' in result ? result.queryText ?? '' : ''
  }
  if (connection.engine === 'cosmosdb') {
    if (!tab.builderState || tab.builderState.kind !== 'cosmos-sql') return {ok:false,errors:[{message:'Cosmos DB query state is unavailable.'}]}
    const error = validateShape(tab.builderState, schemas.QueryBuilderState)
    if (error) return {ok:false,errors:[{message:error}]}
    const result = prepareCosmosExecution({tab,builderState:tab.builderState,editorState:tab.builderState.editorState,mode})
    if (result.errors?.length) return {ok:false,errors:result.errors.map(message => ({message}))}
    return {ok:true,queryText:result.queryText,datastoreExecutionInput:result.datastoreExecutionInput}
  }
  return {ok:true,queryText}
}
