import type { ConnectionProfile, QueryBuilderState, QueryTabState } from '@datapadplusplus/shared-types'
import { QueryLimitInput } from './QueryLimitInput'
import { queryLimitValue } from '../../../../../../../packages/query-compiler/src/query-limit-settings'
import {
  builderStateWithCompiledQueryText,
  compileQueryBuilderState,
  queryScopeForBuilderState,
} from '../../../controllers/query-builder-routing'
import { QueryBuilderCountButton } from './QueryBuilderCountFooter'
import { queryBuilderStateWithDatabase } from './query-builder-count'

interface QueryBuilderExecutionControlsProps {
  connection?: ConnectionProfile
  tab: QueryTabState
  builderState: QueryBuilderState
  executionLocked?: boolean
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
  onCount?(tabId: string, builderState: QueryBuilderState): Promise<void>
}

/** Shared toolbar controls; native query text and Redis scan settings are not rewritten. */
export function QueryBuilderExecutionControls({
  connection,
  tab,
  builderState,
  executionLocked = false,
  onBuilderStateChange,
  onCount,
}: QueryBuilderExecutionControlsProps) {
  const locked = executionLocked || Boolean(tab.activeExecution) || tab.status === 'queued' || tab.status === 'running'
  const invalid = !compileQueryBuilderState(builderState, connection, tab).ok
  const size = queryLimitValue(builderState)
  const minimum = builderState.kind === 'search-dsl' ? 0 : 1
  const sizeHelp = builderState.kind === 'dynamodb-key-condition'
    ? 'Maximum items evaluated per request, before DynamoDB filters are applied.'
    : builderState.kind === 'search-dsl'
      ? 'Maximum search hits to return. Use 0 to return aggregations without hits.'
      : 'Maximum records returned by this builder query. Count ignores this limit.'

  const updateSize = (value: number | null) => {
    if (locked || !onBuilderStateChange || builderState.kind === 'redis-key-browser') return
    const next = builderState.kind === 'search-dsl'
      ? { ...builderState, size: value ?? 20 }
      : { ...builderState, limit: value }
    const scoped = queryBuilderStateWithDatabase(
      next,
      queryScopeForBuilderState(next, connection, tab)?.database,
    )
    onBuilderStateChange(tab.id, builderStateWithCompiledQueryText(scoped, connection, tab))
  }

  return (
    <div className="toolbar-group toolbar-group--query-results" role="group" aria-label="Query result controls">
      {size !== undefined ? (
        <QueryLimitInput
          key={`${tab.id}:${builderState.kind}`}
          value={size}
          minimum={minimum}
          disabled={locked || !onBuilderStateChange}
          title={sizeHelp}
          label={builderState.kind === 'dynamodb-key-condition' ? 'Items evaluated' : builderState.kind === 'search-dsl' ? 'Hit limit' : 'Query limit'}
          onChange={updateSize}
        />
      ) : null}
      <QueryBuilderCountButton
        activeExecution={locked || invalid}
        builderState={builderState}
        onCount={onCount}
        tabId={tab.id}
        appearance="toolbar"
      />
    </div>
  )
}
