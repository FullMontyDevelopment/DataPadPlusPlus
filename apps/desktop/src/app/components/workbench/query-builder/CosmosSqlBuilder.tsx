import type {
  CosmosSqlBuilderState,
  CosmosSqlBuilderValueType,
  CosmosSqlFilterOperator,
  QueryBuilderState,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { Trash2 } from 'lucide-react'
import { BuilderSection } from './BuilderSection'
import {
  buildCosmosSqlQueryText,
  cosmosSqlBuilderRowId,
} from './cosmos-sql'

interface CosmosSqlBuilderProps {
  tab: QueryTabState
  builderState: CosmosSqlBuilderState
  containerOptions?: string[]
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
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
}: CosmosSqlBuilderProps) {
  const draft = builderState
  const resolvedContainerOptions = uniqueValues([draft.container, ...containerOptions])
  const updateDraft = (patch: Partial<CosmosSqlBuilderState>) => {
    const nextDraft = { ...draft, ...patch }
    const next = {
      ...nextDraft,
      lastAppliedQueryText: buildCosmosSqlQueryText(nextDraft),
    }
    onBuilderStateChange?.(tab.id, next)
  }

  return (
    <section className="query-builder-panel" aria-label="Cosmos DB SQL query builder">
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
        dropHint="Drop a field to select it"
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
        dropHint="Drop a field to filter"
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
        dropHint="Drop a field to order"
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
    </section>
  )
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
