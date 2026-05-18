import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  MongoFindBuilderState,
  QueryBuilderState,
  QueryTabState,
  RedisKeyInspectRequest,
  RedisKeyScanRequest,
  RedisKeyScanResponse,
} from '@datapadplusplus/shared-types'
import { useState } from 'react'
import type { DragEvent } from 'react'
import { readFieldDragPayload } from '../results/field-drag'
import { CqlPartitionBuilder } from './CqlPartitionBuilder'
import { isCqlPartitionBuilderState } from './cql-partition'
import { DynamoDbKeyConditionBuilder } from './DynamoDbKeyConditionBuilder'
import { isDynamoDbKeyConditionBuilderState } from './dynamodb-key-condition'
import {
  buildMongoFindQueryText,
  isMongoFindBuilderState,
} from './mongo-find'
import {
  MongoFilterBuilderSection,
  MongoProjectionBuilderSection,
  MongoSortBuilderSection,
} from './MongoFindBuilderSections'
import { mongoFilterRowFromDroppedField } from './mongo-filter-row'
import { isSqlSelectBuilderState } from './sql-select'
import { SqlSelectBuilder } from './SqlSelectBuilder'
import { isSearchDslBuilderState } from './search-dsl'
import { SearchDslBuilder } from './SearchDslBuilder'
import { RedisKeyBrowserPanel } from './RedisKeyBrowserPanel'
import { isRedisKeyBrowserState } from './redis-key-browser'

interface QueryBuilderPanelProps {
  connection?: ConnectionProfile
  tab: QueryTabState
  builderState?: QueryBuilderState
  collectionOptions?: string[]
  tableOptions?: string[]
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
  onInspectRedisKey?(request: RedisKeyInspectRequest): Promise<void>
  onScanRedisKeys?(request: RedisKeyScanRequest): Promise<RedisKeyScanResponse | undefined>
}

export function QueryBuilderPanel({
  builderState,
  collectionOptions = [],
  connection,
  tab,
  tableOptions = [],
  onBuilderStateChange,
  onExecuteDataEdit,
  onInspectRedisKey,
  onScanRedisKeys,
}: QueryBuilderPanelProps) {
  const resolvedBuilderState = builderState ?? tab.builderState

  if (isMongoFindBuilderState(resolvedBuilderState)) {
    return (
      <MongoFindBuilder
        key={tab.id}
        tab={tab}
        builderState={resolvedBuilderState}
        collectionOptions={collectionOptions}
        onBuilderStateChange={onBuilderStateChange}
      />
    )
  }

  if (connection && isSqlSelectBuilderState(resolvedBuilderState)) {
    return (
      <SqlSelectBuilder
        key={tab.id}
        connection={connection}
        tab={tab}
        builderState={resolvedBuilderState}
        tableOptions={tableOptions}
        onBuilderStateChange={onBuilderStateChange}
      />
    )
  }

  if (isDynamoDbKeyConditionBuilderState(resolvedBuilderState)) {
    return (
      <DynamoDbKeyConditionBuilder
        key={tab.id}
        tab={tab}
        builderState={resolvedBuilderState}
        tableOptions={tableOptions}
        onBuilderStateChange={onBuilderStateChange}
      />
    )
  }

  if (isCqlPartitionBuilderState(resolvedBuilderState)) {
    return (
      <CqlPartitionBuilder
        key={tab.id}
        tab={tab}
        builderState={resolvedBuilderState}
        tableOptions={tableOptions}
        onBuilderStateChange={onBuilderStateChange}
      />
    )
  }

  if (isSearchDslBuilderState(resolvedBuilderState)) {
    return (
      <SearchDslBuilder
        key={tab.id}
        tab={tab}
        builderState={resolvedBuilderState}
        indexOptions={tableOptions}
        onBuilderStateChange={onBuilderStateChange}
      />
    )
  }

  if (isRedisKeyBrowserState(resolvedBuilderState)) {
    return (
      <RedisKeyBrowserPanel
        key={tab.id}
        tab={tab}
        builderState={resolvedBuilderState}
        onBuilderStateChange={onBuilderStateChange}
        onExecuteDataEdit={onExecuteDataEdit}
        onInspectRedisKey={onInspectRedisKey}
        onScanRedisKeys={onScanRedisKeys}
      />
    )
  }

  return null
}

function MongoFindBuilder({
  tab,
  builderState,
  collectionOptions,
  onBuilderStateChange,
}: {
  tab: QueryTabState
  builderState: MongoFindBuilderState
  collectionOptions: string[]
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
}) {
  const draft = builderState
  const filterGroups = draft.filterGroups ?? []
  const [builderDragActive, setBuilderDragActive] = useState(false)
  const resolvedCollectionOptions = uniqueValues([
    draft.collection,
    ...collectionOptions,
  ]).filter(Boolean)

  const updateDraft = (patch: Partial<MongoFindBuilderState>) => {
    const nextDraft = { ...draft, ...patch }
    const next = {
      ...nextDraft,
      lastAppliedQueryText: buildMongoFindQueryText(nextDraft),
    }

    if (onBuilderStateChange) {
      onBuilderStateChange(tab.id, next)
    }
  }

  const handleBuilderDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setBuilderDragActive((current) => current || true)
  }

  const handleBuilderDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return
    }

    setBuilderDragActive(false)
  }

  const handleBuilderDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setBuilderDragActive(false)

    const payload = readFieldDragPayload(event)

    if (!payload?.fieldPath) {
      return
    }

    updateDraft({
      filterGroups,
      filters: [
        ...draft.filters,
        mongoFilterRowFromDroppedField(filterGroups[0]?.id, payload.fieldPath, payload),
      ],
    })
  }

  return (
    <section
      className={`query-builder-panel${builderDragActive ? ' is-drag-over' : ''}`}
      aria-label="MongoDB query builder"
      onDragEnterCapture={handleBuilderDragOver}
      onDragOverCapture={handleBuilderDragOver}
      onDragLeave={handleBuilderDragLeave}
      onDrop={handleBuilderDrop}
    >
      <div className="query-builder-grid">
        <label className="query-builder-field">
          <span>Collection</span>
          <select
            aria-label="Collection"
            value={draft.collection}
            onChange={(event) => updateDraft({ collection: event.target.value })}
          >
            {resolvedCollectionOptions.length === 0 ? (
              <option value="">Select collection</option>
            ) : null}
            {resolvedCollectionOptions.map((collection) => (
              <option key={collection} value={collection}>
                {collection}
              </option>
            ))}
          </select>
        </label>
        <label className="query-builder-field query-builder-field--number">
          <span>Fetch size</span>
          <input
            aria-label="Fetch size"
            min={1}
            type="number"
            value={draft.limit ?? 20}
            onChange={(event) => updateDraft({ limit: positiveInteger(event.target.value, 20) })}
          />
        </label>
      </div>

      <MongoFilterBuilderSection
        draft={draft}
        filterGroups={filterGroups}
        updateDraft={updateDraft}
      />
      <MongoProjectionBuilderSection
        draft={draft}
        filterGroups={filterGroups}
        updateDraft={updateDraft}
      />
      <MongoSortBuilderSection
        draft={draft}
        filterGroups={filterGroups}
        updateDraft={updateDraft}
      />
    </section>
  )
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}
