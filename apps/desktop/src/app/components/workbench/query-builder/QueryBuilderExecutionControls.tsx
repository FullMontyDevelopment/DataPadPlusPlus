import type { ConnectionProfile, QueryBuilderState, QueryTabState } from '@datapadplusplus/shared-types'
import { useState } from 'react'
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
  const locked = executionLocked || Boolean(tab.activeExecution) || tab.status === 'queued'
  const invalid = !compileQueryBuilderState(builderState, connection, tab).ok
  const size = builderState.kind === 'redis-key-browser'
    ? undefined
    : builderState.kind === 'search-dsl'
      ? builderState.size ?? 20
      : builderState.limit ?? (builderState.kind === 'cosmos-sql' ? 50 : 20)
  const minimum = builderState.kind === 'search-dsl' ? 0 : 1
  const sizeHelp = builderState.kind === 'dynamodb-key-condition'
    ? 'Maximum items evaluated per request, before DynamoDB filters are applied.'
    : builderState.kind === 'search-dsl'
      ? 'Maximum search hits to return. Use 0 to return aggregations without hits.'
      : 'Maximum records returned by this builder query. Count ignores this limit.'

  const updateSize = (value: number) => {
    if (locked || !onBuilderStateChange || builderState.kind === 'redis-key-browser') return
    const next = builderState.kind === 'search-dsl'
      ? { ...builderState, size: value }
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
        <FetchSizeInput
          key={`${tab.id}:${builderState.kind}`}
          value={size}
          minimum={minimum}
          disabled={locked || !onBuilderStateChange}
          title={sizeHelp}
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

function FetchSizeInput({ value, minimum, disabled, title, onChange }: {
  value: number
  minimum: number
  disabled: boolean
  title: string
  onChange(value: number): void
}) {
  const [draft, setDraft] = useState({ source: value, text: String(value) })
  const text = draft.source === value ? draft.text : String(value)
  const valid = /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) >= minimum

  return (
    <label className="toolbar-fetch-size" title={title}>
      <span>Fetch size</span>
      <input
        aria-label="Fetch size"
        aria-invalid={text !== '' && !valid}
        type="number"
        min={minimum}
        step={1}
        disabled={disabled}
        value={text}
        onChange={(event) => {
          const text = event.target.value
          setDraft({ source: value, text })
          const next = Number(text)
          if (/^\d+$/.test(text) && Number.isSafeInteger(next) && next >= minimum) onChange(next)
        }}
        onBlur={() => setDraft({ source: value, text: String(value) })}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || (event.key === 'Enter' && !event.ctrlKey && !event.metaKey)) {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}
