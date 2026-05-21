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
import type { DragEvent } from 'react'
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
import { DynamoDbKeyConditionBuilder } from './DynamoDbKeyConditionBuilder'
import { isDynamoDbKeyConditionBuilderState } from './dynamodb-key-condition'
import {
  buildMongoFindQueryText,
  isMongoFindBuilderState,
} from './mongo-find'
import { MongoAggregationBuilder } from './MongoAggregationBuilder'
import { isMongoAggregationBuilderState } from './mongo-aggregation'
import {
  MongoFilterBuilderSection,
  MongoProjectionBuilderSection,
  MongoSortBuilderSection,
} from './MongoFindBuilderSections'
import { rowId } from './MongoBuilderSection.types'
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

  if (isMongoAggregationBuilderState(resolvedBuilderState)) {
    return (
      <MongoAggregationBuilder
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
  const filterGroups = useMemo(() => draft.filterGroups ?? [], [draft.filterGroups])
  const rootRef = useRef<HTMLElement>(null)
  const [builderDragActive, setBuilderDragActive] = useState(false)
  const [activeDropZone, setActiveDropZone] = useState<string>()
  const resolvedCollectionOptions = uniqueValues([
    draft.collection,
    ...collectionOptions,
  ]).filter(Boolean)

  const updateDraft = useCallback((patch: Partial<MongoFindBuilderState>) => {
    const nextDraft = { ...draft, ...patch }
    const next = {
      ...nextDraft,
      lastAppliedQueryText: buildMongoFindQueryText(nextDraft),
    }

    if (onBuilderStateChange) {
      onBuilderStateChange(tab.id, next)
    }
  }, [draft, onBuilderStateChange, tab.id])

  const addDroppedFilter = useCallback((payload: FieldDragPayload) => {
    updateDraft({
      filterGroups,
      filters: [
        ...draft.filters,
        mongoFilterRowFromDroppedField(filterGroups[0]?.id, payload.fieldPath, payload),
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
    if (dropZone === 'projection') {
      addDroppedProjection(payload.fieldPath)
    } else if (dropZone === 'sort') {
      addDroppedSort(payload.fieldPath)
    } else {
      addDroppedFilter(payload)
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

function queryBuilderDropZoneFromEvent(event: DragEvent<HTMLElement>) {
  const target = event.target

  if (!(target instanceof Element)) {
    return undefined
  }

  const dropZone = target.closest<HTMLElement>('[data-query-builder-drop-zone]')
  return dropZone?.dataset.queryBuilderDropZone
}

function queryBuilderDropZoneFromPoint(clientX: number, clientY: number) {
  if (typeof document.elementFromPoint !== 'function') {
    return undefined
  }

  const target = document.elementFromPoint(clientX, clientY)

  if (!(target instanceof Element)) {
    return undefined
  }

  return target.closest<HTMLElement>('[data-query-builder-drop-zone]')
    ?.dataset.queryBuilderDropZone
}

function pointInsideElement(element: HTMLElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect()

  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  )
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}
