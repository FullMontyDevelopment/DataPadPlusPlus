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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import {
  FIELD_POINTER_DRAG_CANCEL_EVENT,
  FIELD_POINTER_DRAG_DROP_EVENT,
  FIELD_POINTER_DRAG_MOVE_EVENT,
  acceptFieldDrag,
  clearFieldDragData,
  type FieldPointerDragDetail,
  readFieldDragPayload,
  type FieldDragPayload,
} from '../results/field-drag'
import { CqlPartitionBuilder } from './CqlPartitionBuilder'
import { isCqlPartitionBuilderState } from './cql-partition'
import { DynamoDbKeyConditionBuilder } from '../datastores/dynamodb/DynamoDbKeyConditionBuilder'
import { isDynamoDbKeyConditionBuilderState } from './dynamodb-key-condition'
import {
  buildMongoFindQueryText,
  isMongoFindBuilderState,
} from './mongo-find'
import { MongoAggregationBuilder } from '../datastores/mongodb/MongoAggregationBuilder'
import { isMongoAggregationBuilderState } from './mongo-aggregation'
import {
  MongoFilterBuilderSection,
  MongoProjectionBuilderSection,
  MongoSortBuilderSection,
} from '../datastores/mongodb/MongoFindBuilderSections'
import { rowId } from '../datastores/mongodb/MongoBuilderSection.types'
import { MongoScopeSummary } from '../datastores/mongodb/MongoScopeSummary'
import { mongoFilterRowFromDroppedField } from './mongo-filter-row'
import { mongoQueryScopeForTab } from './mongo-query-scope'
import { isSqlSelectBuilderState } from './sql-select'
import { SqlSelectBuilder } from './SqlSelectBuilder'
import { isSearchDslBuilderState } from './search-dsl'
import { SearchDslBuilder } from '../datastores/common/search/SearchDslBuilder'
import { RedisKeyBrowserPanel } from '../datastores/common/keyvalue/RedisKeyBrowserPanel'
import { isRedisKeyBrowserState } from './redis-key-browser'
import { QueryBuilderCountFooter } from './QueryBuilderCountFooter'
import {
  filterGroupIdFromDropZone,
  pointInsideElement,
  queryBuilderDropZoneFromEvent,
  queryBuilderDropZoneFromPoint,
} from './query-builder-drag-targets'

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
  onCount?(tabId: string, builderState: QueryBuilderState): Promise<void>
  redisRefreshSignal?: number
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
  onCount,
  redisRefreshSignal = 0,
}: QueryBuilderPanelProps) {
  const resolvedBuilderState = builderState ?? tab.builderState
  let panel: ReactNode = null

  if (isMongoFindBuilderState(resolvedBuilderState)) {
    panel = (
      <MongoFindBuilder
        key={tab.id}
        connection={connection}
        tab={tab}
        builderState={resolvedBuilderState}
        collectionOptions={collectionOptions}
        onBuilderStateChange={onBuilderStateChange}
      />
    )
  }

  if (!panel && isMongoAggregationBuilderState(resolvedBuilderState)) {
    panel = (
      <MongoAggregationBuilder
        key={tab.id}
        connection={connection}
        tab={tab}
        builderState={resolvedBuilderState}
        collectionOptions={collectionOptions}
        onBuilderStateChange={onBuilderStateChange}
      />
    )
  }

  if (!panel && connection && isSqlSelectBuilderState(resolvedBuilderState)) {
    panel = (
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

  if (!panel && isDynamoDbKeyConditionBuilderState(resolvedBuilderState)) {
    panel = (
      <DynamoDbKeyConditionBuilder
        key={tab.id}
        tab={tab}
        builderState={resolvedBuilderState}
        tableOptions={tableOptions}
        onBuilderStateChange={onBuilderStateChange}
      />
    )
  }

  if (!panel && isCqlPartitionBuilderState(resolvedBuilderState)) {
    panel = (
      <CqlPartitionBuilder
        key={tab.id}
        tab={tab}
        builderState={resolvedBuilderState}
        tableOptions={tableOptions}
        onBuilderStateChange={onBuilderStateChange}
      />
    )
  }

  if (!panel && isSearchDslBuilderState(resolvedBuilderState)) {
    panel = (
      <SearchDslBuilder
        key={tab.id}
        tab={tab}
        builderState={resolvedBuilderState}
        indexOptions={tableOptions}
        onBuilderStateChange={onBuilderStateChange}
      />
    )
  }

  if (!panel && isRedisKeyBrowserState(resolvedBuilderState)) {
    panel = (
      <RedisKeyBrowserPanel
        key={tab.id}
        tab={tab}
        builderState={resolvedBuilderState}
        onBuilderStateChange={onBuilderStateChange}
        onExecuteDataEdit={onExecuteDataEdit}
        onInspectRedisKey={onInspectRedisKey}
        onScanRedisKeys={onScanRedisKeys}
        refreshSignal={redisRefreshSignal}
      />
    )
  }

  if (!panel || !resolvedBuilderState) {
    return null
  }

  return (
    <div className="query-builder-workspace">
      {panel}
      <QueryBuilderCountFooter
        activeExecution={Boolean(tab.activeExecution)}
        builderState={resolvedBuilderState}
        onCount={onCount}
        tabId={tab.id}
      />
    </div>
  )
}

function MongoFindBuilder({
  connection,
  tab,
  builderState,
  collectionOptions,
  onBuilderStateChange,
}: {
  connection?: ConnectionProfile
  tab: QueryTabState
  builderState: MongoFindBuilderState
  collectionOptions: string[]
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
}) {
  const draft = builderState
  const filterGroups = useMemo(() => draft.filterGroups ?? [], [draft.filterGroups])
  const rootRef = useRef<HTMLElement>(null)
  const [builderDragActive, setBuilderDragActive] = useState(false)
  const [activeDropZone, setActiveDropZone] = useState<string>()
  const resolvedCollectionOptions = uniqueValues([
    draft.collection,
    ...collectionOptions,
  ]).filter(Boolean)
  const scope = mongoQueryScopeForTab({
    builderState: draft,
    connection,
    tab,
  })
  const scopedDatabase = scope?.database

  const updateDraft = useCallback((patch: Partial<MongoFindBuilderState>) => {
    const nextDraft = {
      ...draft,
      ...(scopedDatabase ? { database: scopedDatabase } : {}),
      ...patch,
    }
    const next = {
      ...nextDraft,
      lastAppliedQueryText: buildMongoFindQueryText(nextDraft, { database: scopedDatabase }),
    }

    if (onBuilderStateChange) {
      onBuilderStateChange(tab.id, next)
    }
  }, [draft, onBuilderStateChange, scopedDatabase, tab.id])

  const addDroppedFilter = useCallback((payload: FieldDragPayload, groupId?: string) => {
    updateDraft({
      filterGroups,
      filters: [
        ...draft.filters,
        mongoFilterRowFromDroppedField(groupId, payload.fieldPath, payload),
      ],
    })
  }, [draft.filters, filterGroups, updateDraft])

  const addDroppedProjection = useCallback((field: string) => {
    updateDraft({
      filterGroups,
      projectionMode: draft.projectionMode === 'all' ? 'include' : draft.projectionMode,
      projectionFields: [...draft.projectionFields, { id: rowId('projection'), field }],
    })
  }, [draft.projectionFields, draft.projectionMode, filterGroups, updateDraft])

  const addDroppedSort = useCallback((field: string) => {
    updateDraft({
      filterGroups,
      sort: [...draft.sort, { id: rowId('sort'), field, direction: 'asc' }],
    })
  }, [draft.sort, filterGroups, updateDraft])

  const addDroppedPayload = useCallback((payload: FieldDragPayload, dropZone: string | undefined) => {
    const filterGroupId = filterGroupIdFromDropZone(dropZone)

    if (dropZone === 'projection') {
      addDroppedProjection(payload.fieldPath)
    } else if (dropZone === 'sort') {
      addDroppedSort(payload.fieldPath)
    } else {
      addDroppedFilter(payload, filterGroupId)
    }
  }, [addDroppedFilter, addDroppedProjection, addDroppedSort])

  useEffect(() => {
    const handlePointerMove = (event: Event) => {
      const detail = (event as CustomEvent<FieldPointerDragDetail>).detail
      const root = rootRef.current

      if (!root || !detail) {
        return
      }

      if (!pointInsideElement(root, detail.clientX, detail.clientY)) {
        setBuilderDragActive(false)
        setActiveDropZone(undefined)
        return
      }

      setBuilderDragActive(true)
      setActiveDropZone(queryBuilderDropZoneFromPoint(detail.clientX, detail.clientY) ?? 'filters')
    }

    const handlePointerDrop = (event: Event) => {
      const detail = (event as CustomEvent<FieldPointerDragDetail>).detail
      const root = rootRef.current

      setBuilderDragActive(false)
      setActiveDropZone(undefined)

      if (!root || !detail || !pointInsideElement(root, detail.clientX, detail.clientY)) {
        return
      }

      addDroppedPayload(
        detail.payload,
        queryBuilderDropZoneFromPoint(detail.clientX, detail.clientY) ?? 'filters',
      )
    }

    const handlePointerCancel = () => {
      setBuilderDragActive(false)
      setActiveDropZone(undefined)
    }

    window.addEventListener(FIELD_POINTER_DRAG_MOVE_EVENT, handlePointerMove)
    window.addEventListener(FIELD_POINTER_DRAG_DROP_EVENT, handlePointerDrop)
    window.addEventListener(FIELD_POINTER_DRAG_CANCEL_EVENT, handlePointerCancel)

    return () => {
      window.removeEventListener(FIELD_POINTER_DRAG_MOVE_EVENT, handlePointerMove)
      window.removeEventListener(FIELD_POINTER_DRAG_DROP_EVENT, handlePointerDrop)
      window.removeEventListener(FIELD_POINTER_DRAG_CANCEL_EVENT, handlePointerCancel)
    }
  }, [addDroppedPayload])

  const handleBuilderDragOver = (event: DragEvent<HTMLElement>) => {
    if (acceptFieldDrag(event)) {
      setBuilderDragActive((current) => current || true)
      setActiveDropZone(queryBuilderDropZoneFromEvent(event) ?? 'filters')
    }
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
    event.stopPropagation()
    setBuilderDragActive(false)

    const payload = readFieldDragPayload(event)

    if (!payload?.fieldPath) {
      clearFieldDragData()
      return
    }

    const dropZone = queryBuilderDropZoneFromEvent(event) ?? 'filters'

    addDroppedPayload(payload, dropZone)

    clearFieldDragData()
  }

  return (
    <section
      ref={rootRef}
      className={`query-builder-panel${builderDragActive ? ' is-drag-over' : ''}`}
      aria-label="MongoDB query builder"
      onDragEnterCapture={handleBuilderDragOver}
      onDragOverCapture={handleBuilderDragOver}
      onDragLeave={handleBuilderDragLeave}
      onDropCapture={handleBuilderDrop}
    >
      <MongoScopeSummary scope={scope} />
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
        activeFilterGroupId={filterGroupIdFromDropZone(activeDropZone)}
        draft={draft}
        dragActive={activeDropZone === 'filters'}
        filterGroups={filterGroups}
        updateDraft={updateDraft}
      />
      <MongoProjectionBuilderSection
        draft={draft}
        dragActive={activeDropZone === 'projection'}
        filterGroups={filterGroups}
        updateDraft={updateDraft}
      />
      <MongoSortBuilderSection
        draft={draft}
        dragActive={activeDropZone === 'sort'}
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
