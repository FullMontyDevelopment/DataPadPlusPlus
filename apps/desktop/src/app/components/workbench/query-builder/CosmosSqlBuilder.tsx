import type {
  CosmosSqlBuilderState,
  CosmosSqlBuilderValueType,
  CosmosSqlFilterOperator,
  QueryBuilderState,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FIELD_POINTER_DRAG_CANCEL_EVENT,
  FIELD_POINTER_DRAG_DROP_EVENT,
  FIELD_POINTER_DRAG_MOVE_EVENT,
  type FieldPointerDragDetail,
} from '../results/field-drag'
import { BuilderSection } from './BuilderSection'
import {
  buildCosmosSqlRequest,
  buildCosmosSqlQueryText,
  cosmosSqlBuilderRowId,
} from './cosmos-sql'
import {
  pointInsideElement,
  queryBuilderDropZoneFromPoint,
} from './query-builder-drag-targets'

interface CosmosSqlBuilderProps {
  tab: QueryTabState
  builderState: CosmosSqlBuilderState
  containerOptions?: string[]
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
  onUseInQueryEditor?(builderState: CosmosSqlBuilderState): void
}

const FILTER_OPERATORS: Array<{ value: CosmosSqlFilterOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'ne', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'Contains' },
  { value: 'not-contains', label: 'Not Contains' },
  { value: 'starts-with', label: 'Starts with' },
  { value: 'not-starts-with', label: 'Does not start with' },
  { value: 'ends-with', label: 'Ends with' },
  { value: 'not-ends-with', label: 'Does not end with' },
  { value: 'array-contains', label: 'Array contains' },
  { value: 'in', label: 'In' },
  { value: 'not-in', label: 'Not in' },
  { value: 'is-null', label: 'Is null' },
  { value: 'is-not-null', label: 'Is not null' },
]

const VALUE_TYPES: CosmosSqlBuilderValueType[] = [
  'string',
  'number',
  'boolean',
  'null',
  'json',
]

export function CosmosSqlBuilder({
  tab,
  builderState,
  containerOptions = [],
  onBuilderStateChange,
  onUseInQueryEditor,
}: CosmosSqlBuilderProps) {
  const draft = builderState
  const rootRef = useRef<HTMLElement>(null)
  const [builderDragActive, setBuilderDragActive] = useState(false)
  const [activeDropZone, setActiveDropZone] = useState<CosmosDropZone>()
  const resolvedContainerOptions = uniqueValues([draft.container, ...containerOptions])
  const generatedRequest = buildCosmosSqlRequest(draft)
  const updateDraft = useCallback((patch: Partial<CosmosSqlBuilderState>) => {
    const nextDraft = { ...draft, ...patch }
    const next = {
      ...nextDraft,
      lastAppliedQueryText: buildCosmosSqlQueryText(nextDraft),
    }
    onBuilderStateChange?.(tab.id, next)
  }, [draft, onBuilderStateChange, tab.id])
  const addDroppedField = useCallback((field: string, dropZone: CosmosDropZone) => {
    if (dropZone === 'projection') {
      updateDraft({
        projectionFields: [
          ...draft.projectionFields,
          { id: cosmosSqlBuilderRowId('projection'), field },
        ],
      })
      return
    }

    if (dropZone === 'sort') {
      updateDraft({ sort: [...draft.sort, { ...newSort(), field }] })
      return
    }

    updateDraft({ filters: [...draft.filters, { ...newFilter(), field }] })
  }, [draft.filters, draft.projectionFields, draft.sort, updateDraft])

  useEffect(() => {
    const clearPointerDropState = () => {
      setBuilderDragActive(false)
      setActiveDropZone(undefined)
    }

    const handlePointerMove = (event: Event) => {
      const detail = (event as CustomEvent<FieldPointerDragDetail>).detail
      const root = rootRef.current

      if (!root || !detail || !pointInsideElement(root, detail.clientX, detail.clientY)) {
        clearPointerDropState()
        return
      }

      setBuilderDragActive(true)
      setActiveDropZone(cosmosDropZoneFromPoint(detail.clientX, detail.clientY))
    }

    const handlePointerDrop = (event: Event) => {
      const detail = (event as CustomEvent<FieldPointerDragDetail>).detail
      const root = rootRef.current

      clearPointerDropState()

      if (!root || !detail || !pointInsideElement(root, detail.clientX, detail.clientY)) {
        return
      }

      const field = detail.payload.fieldPath.trim()
      if (field) {
        addDroppedField(field, cosmosDropZoneFromPoint(detail.clientX, detail.clientY))
      }
    }

    window.addEventListener(FIELD_POINTER_DRAG_MOVE_EVENT, handlePointerMove)
    window.addEventListener(FIELD_POINTER_DRAG_DROP_EVENT, handlePointerDrop)
    window.addEventListener(FIELD_POINTER_DRAG_CANCEL_EVENT, clearPointerDropState)

    return () => {
      window.removeEventListener(FIELD_POINTER_DRAG_MOVE_EVENT, handlePointerMove)
      window.removeEventListener(FIELD_POINTER_DRAG_DROP_EVENT, handlePointerDrop)
      window.removeEventListener(FIELD_POINTER_DRAG_CANCEL_EVENT, clearPointerDropState)
    }
  }, [addDroppedField])

  return (
    <section
      ref={rootRef}
      className={`query-builder-panel${builderDragActive ? ' is-drag-over' : ''}`}
      aria-label="Cosmos DB SQL query builder"
    >
      <div className="query-builder-grid query-builder-grid--cosmos-target">
        <label className="query-builder-field">
          <span>Database</span>
          <input
            aria-label="Database"
            value={draft.database ?? ''}
            onChange={(event) => updateDraft({ database: event.target.value })}
          />
        </label>
        <label className="query-builder-field">
          <span>Container</span>
          <input
            aria-label="Container"
            list="cosmos-builder-container-options"
            value={draft.container}
            onChange={(event) => updateDraft({ container: event.target.value })}
          />
          <datalist id="cosmos-builder-container-options">
            {resolvedContainerOptions.map((container) => (
              <option key={container} value={container} />
            ))}
          </datalist>
        </label>
        <label className="query-builder-field query-builder-field--number">
          <span>Offset</span>
          <input
            aria-label="Offset"
            type="number"
            min={0}
            value={draft.offset ?? 0}
            onChange={(event) => updateDraft({ offset: wholeNumber(event.target.value, 0, 0) })}
          />
        </label>
        <label className="query-builder-field query-builder-field--number">
          <span>Limit</span>
          <input
            aria-label="Limit"
            type="number"
            min={1}
            value={draft.limit ?? 50}
            onChange={(event) => updateDraft({ limit: wholeNumber(event.target.value, 50, 1) })}
          />
        </label>
      </div>

      <div className="cosmos-builder-routing" aria-label="Cosmos DB partition routing">
        <label className="query-builder-toggle cosmos-builder-routing__toggle">
          <input
            type="checkbox"
            aria-label="Route to partition key"
            checked={draft.partitionKeyEnabled ?? false}
            onChange={(event) => updateDraft({ partitionKeyEnabled: event.target.checked })}
          />
          Route to partition
        </label>
        <select
          aria-label="Partition key value type"
          disabled={!draft.partitionKeyEnabled}
          value={draft.partitionKeyValueType ?? 'string'}
          onChange={(event) => updateDraft({
            partitionKeyValueType: event.target.value as CosmosSqlBuilderValueType,
          })}
        >
          {VALUE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input
          aria-label="Partition key value"
          disabled={!draft.partitionKeyEnabled || draft.partitionKeyValueType === 'null'}
          value={draft.partitionKeyValue ?? ''}
          placeholder="Partition key value"
          onChange={(event) => updateDraft({ partitionKeyValue: event.target.value })}
        />
        <label className="query-builder-toggle cosmos-builder-routing__toggle">
          <input
            type="checkbox"
            aria-label="Enable cross-partition query"
            disabled={draft.partitionKeyEnabled}
            checked={!draft.partitionKeyEnabled && (draft.enableCrossPartitionQueries ?? true)}
            onChange={(event) => updateDraft({ enableCrossPartitionQueries: event.target.checked })}
          />
          Cross-partition
        </label>
      </div>

      <BuilderSection
        title="Fields"
        actionLabel="Add Field"
        dragActive={activeDropZone === 'projection'}
        dropHint="Drop a field to select it"
        dropZone="projection"
        onAdd={() => updateDraft({
          projectionFields: [
            ...draft.projectionFields,
            { id: cosmosSqlBuilderRowId('projection'), field: '' },
          ],
        })}
        onDropField={(field) => updateDraft({
          projectionFields: [
            ...draft.projectionFields,
            { id: cosmosSqlBuilderRowId('projection'), field },
          ],
        })}
      >
        {draft.projectionFields.length === 0 ? (
          <p className="query-builder-empty">Selecting complete items.</p>
        ) : draft.projectionFields.map((field) => (
          <div key={field.id} className="query-builder-row query-builder-row--simple">
            <input
              aria-label="Projection field"
              value={field.field}
              onChange={(event) => updateDraft({
                projectionFields: draft.projectionFields.map((item) =>
                  item.id === field.id ? { ...item, field: event.target.value } : item,
                ),
              })}
            />
            <RemoveButton
              label={`Remove field ${field.field || 'empty'}`}
              onClick={() => updateDraft({
                projectionFields: draft.projectionFields.filter((item) => item.id !== field.id),
              })}
            />
          </div>
        ))}
      </BuilderSection>

      <BuilderSection
        title="Filters"
        actionLabel="Add Filter"
        dragActive={activeDropZone === 'filters'}
        dropHint="Drop a field to filter"
        dropZone="filters"
        onAdd={() => updateDraft({ filters: [...draft.filters, newFilter()] })}
        onDropField={(field) => updateDraft({
          filters: [...draft.filters, { ...newFilter(), field }],
        })}
      >
        <label className="query-builder-inline-field">
          <span>Logic</span>
          <select
            aria-label="Filter logic"
            value={draft.filterLogic}
            onChange={(event) => updateDraft({ filterLogic: event.target.value === 'or' ? 'or' : 'and' })}
          >
            <option value="and">AND</option>
            <option value="or">OR</option>
          </select>
        </label>
        {draft.filters.length === 0 ? (
          <p className="query-builder-empty">No filters applied.</p>
        ) : draft.filters.map((filter) => (
          <div
            key={filter.id}
            className={`query-builder-row query-builder-row--filter${filter.enabled === false ? ' is-disabled' : ''}`}
          >
            <label className="query-builder-toggle">
              <input
                type="checkbox"
                aria-label={`Apply filter ${filter.field || 'empty'}`}
                checked={filter.enabled ?? true}
                onChange={(event) => updateFilter(draft, updateDraft, filter.id, {
                  enabled: event.target.checked,
                })}
              />
              On
            </label>
            <input
              aria-label="Filter field"
              value={filter.field}
              onChange={(event) => updateFilter(draft, updateDraft, filter.id, {
                field: event.target.value,
              })}
            />
            <select
              aria-label="Filter operator"
              value={filter.operator}
              onChange={(event) => updateFilter(draft, updateDraft, filter.id, {
                operator: event.target.value as CosmosSqlFilterOperator,
              })}
            >
              {FILTER_OPERATORS.map((operator) => (
                <option key={operator.value} value={operator.value}>{operator.label}</option>
              ))}
            </select>
            <select
              aria-label="Filter value type"
              value={filter.valueType}
              onChange={(event) => updateFilter(draft, updateDraft, filter.id, {
                valueType: event.target.value as CosmosSqlBuilderValueType,
              })}
            >
              {VALUE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <input
              aria-label="Filter value"
              disabled={filter.operator === 'is-null' || filter.operator === 'is-not-null'}
              value={filter.value}
              onChange={(event) => updateFilter(draft, updateDraft, filter.id, {
                value: event.target.value,
              })}
            />
            <RemoveButton
              label={`Remove filter ${filter.field || 'empty'}`}
              onClick={() => updateDraft({
                filters: draft.filters.filter((item) => item.id !== filter.id),
              })}
            />
          </div>
        ))}
      </BuilderSection>

      <BuilderSection
        title="Sort"
        actionLabel="Add Sort"
        dragActive={activeDropZone === 'sort'}
        dropHint="Drop a field to order"
        dropZone="sort"
        onAdd={() => updateDraft({ sort: [...draft.sort, newSort()] })}
        onDropField={(field) => updateDraft({ sort: [...draft.sort, { ...newSort(), field }] })}
      >
        {draft.sort.length === 0 ? (
          <p className="query-builder-empty">No ordering applied.</p>
        ) : draft.sort.map((sort) => (
          <div key={sort.id} className="query-builder-row query-builder-row--sort">
            <input
              aria-label="Sort field"
              value={sort.field}
              onChange={(event) => updateDraft({
                sort: draft.sort.map((item) =>
                  item.id === sort.id ? { ...item, field: event.target.value } : item,
                ),
              })}
            />
            <select
              aria-label="Sort direction"
              value={sort.direction}
              onChange={(event) => updateDraft({
                sort: draft.sort.map((item) => item.id === sort.id
                  ? { ...item, direction: event.target.value === 'desc' ? 'desc' : 'asc' }
                  : item),
              })}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            <RemoveButton
              label={`Remove sort ${sort.field || 'empty'}`}
              onClick={() => updateDraft({
                sort: draft.sort.filter((item) => item.id !== sort.id),
              })}
            />
          </div>
        ))}
      </BuilderSection>

      <section className="cosmos-generated-query" aria-label="Generated query">
        <div className="cosmos-generated-query__header">
          <div>
            <h3>Generated query</h3>
            <p>SQL and bound values generated from the current builder draft.</p>
          </div>
          <button
            type="button"
            className="query-builder-action"
            onClick={() => onUseInQueryEditor?.(draft)}
          >
            Use in Query Editor
          </button>
        </div>
        <code className="cosmos-generated-query__sql">{generatedRequest.query}</code>
        {generatedRequest.parameters.length > 0 ? (
          <table className="cosmos-generated-query__parameters">
            <thead>
              <tr><th>Name</th><th>Value</th></tr>
            </thead>
            <tbody>
              {generatedRequest.parameters.map((parameter) => (
                <tr key={parameter.name}>
                  <td>{parameter.name}</td>
                  <td>{formatGeneratedValue(parameter.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="query-builder-empty">No parameter bindings.</p>
        )}
      </section>
    </section>
  )
}

function formatGeneratedValue(value: unknown) {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function RemoveButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button
      type="button"
      className="query-builder-remove query-builder-remove--icon"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Trash2 size={13} aria-hidden="true" />
    </button>
  )
}

function updateFilter(
  draft: CosmosSqlBuilderState,
  updateDraft: (patch: Partial<CosmosSqlBuilderState>) => void,
  id: string,
  patch: Partial<CosmosSqlBuilderState['filters'][number]>,
) {
  updateDraft({
    filters: draft.filters.map((item) => item.id === id ? { ...item, ...patch } : item),
  })
}

function newFilter(): CosmosSqlBuilderState['filters'][number] {
  return {
    id: cosmosSqlBuilderRowId('filter'),
    enabled: true,
    field: '',
    operator: 'eq',
    value: '',
    valueType: 'string',
  }
}

function newSort(): CosmosSqlBuilderState['sort'][number] {
  return {
    id: cosmosSqlBuilderRowId('sort'),
    field: '',
    direction: 'asc',
  }
}

function wholeNumber(value: string, fallback: number, minimum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

type CosmosDropZone = 'projection' | 'filters' | 'sort'

function cosmosDropZoneFromPoint(clientX: number, clientY: number): CosmosDropZone {
  const dropZone = queryBuilderDropZoneFromPoint(clientX, clientY)
  return dropZone === 'projection' || dropZone === 'sort' ? dropZone : 'filters'
}
