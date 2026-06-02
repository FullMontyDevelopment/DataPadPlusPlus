import type {
  QueryBuilderState,
  QueryTabState,
  SearchDslBuilderState,
  SearchDslFilterOperator,
  SearchDslFilterRow,
  SearchDslQueryMode,
  SearchDslValueType,
} from '@datapadplusplus/shared-types'
import { BuilderSection } from './BuilderSection'
import {
  buildSearchDslQueryText,
  newSearchFilter,
  searchDslBuilderRowId,
} from './search-dsl'

interface SearchDslBuilderProps {
  tab: QueryTabState
  builderState: SearchDslBuilderState
  indexOptions?: string[]
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
}

const QUERY_MODES: SearchDslQueryMode[] = ['match-all', 'match', 'term', 'range', 'query-string']
const FILTER_OPERATORS: SearchDslFilterOperator[] = ['term', 'match', 'exists', 'range-gte', 'range-lte']
const VALUE_TYPES: SearchDslValueType[] = ['string', 'number', 'boolean']

export function SearchDslBuilder({
  tab,
  builderState,
  indexOptions = [],
  onBuilderStateChange,
}: SearchDslBuilderProps) {
  const draft = builderState
  const resolvedIndexOptions = uniqueValues([draft.index, ...indexOptions])
  const updateDraft = (patch: Partial<SearchDslBuilderState>) => {
    const nextDraft = { ...draft, ...patch }
    onBuilderStateChange?.(tab.id, {
      ...nextDraft,
      lastAppliedQueryText: buildSearchDslQueryText(nextDraft),
    })
  }

  return (
    <section className="query-builder-panel" aria-label="Search Query DSL builder">
      <div className="query-builder-grid query-builder-grid--sql-target">
        <label className="query-builder-field">
          <span>Index</span>
          <select
            aria-label="Index"
            value={draft.index}
            onChange={(event) => updateDraft({ index: event.target.value })}
          >
            {resolvedIndexOptions.length === 0 ? <option value="">Select index</option> : null}
            {resolvedIndexOptions.map((index) => (
              <option key={index} value={index}>{index}</option>
            ))}
          </select>
        </label>
        <label className="query-builder-field">
          <span>Query</span>
          <select
            aria-label="Search query mode"
            value={draft.queryMode}
            onChange={(event) => updateDraft({ queryMode: event.target.value as SearchDslQueryMode })}
          >
            {QUERY_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        </label>
        <label className="query-builder-field">
          <span>Size</span>
          <input
            aria-label="Size"
            min={0}
            type="number"
            value={draft.size ?? 20}
            onChange={(event) => updateDraft({ size: numberValue(event.target.value, 20) })}
          />
        </label>
      </div>

      {draft.queryMode !== 'match-all' ? (
        <div className="query-builder-row query-builder-row--filter">
          {draft.queryMode !== 'query-string' ? (
            <input
              aria-label="Search field"
              value={draft.field}
              placeholder="field"
              onChange={(event) => updateDraft({ field: event.target.value })}
            />
          ) : null}
          <select
            aria-label="Search value type"
            value={draft.valueType}
            onChange={(event) => updateDraft({ valueType: event.target.value as SearchDslValueType })}
          >
            {VALUE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input
            aria-label="Search value"
            value={draft.value}
            placeholder={draft.queryMode === 'query-string' ? 'status:active' : 'value'}
            onChange={(event) => updateDraft({ value: event.target.value })}
          />
        </div>
      ) : null}

      <SearchFilterSection draft={draft} updateDraft={updateDraft} />
      <SearchSimpleFieldSection
        title="Source Fields"
        actionLabel="Add Field"
        emptyText="Returning full _source documents."
        fields={draft.sourceFields}
        updateFields={(sourceFields) => updateDraft({ sourceFields })}
      />
      <SearchSortSection draft={draft} updateDraft={updateDraft} />
      <SearchAggregationSection draft={draft} updateDraft={updateDraft} />
    </section>
  )
}

function SearchFilterSection({
  draft,
  updateDraft,
}: {
  draft: SearchDslBuilderState
  updateDraft(patch: Partial<SearchDslBuilderState>): void
}) {
  return (
    <BuilderSection
      title="Filters"
      actionLabel="Add Filter"
      dropHint="Drop a field to filter"
      onAdd={() => updateDraft({ filters: [...draft.filters, newSearchFilter()] })}
      onDropField={(field) => updateDraft({ filters: [...draft.filters, newSearchFilter(field)] })}
    >
      {draft.filters.length === 0 ? (
        <p className="query-builder-empty">No filter clauses applied.</p>
      ) : draft.filters.map((filter) => (
        <FilterRow
          key={filter.id}
          row={filter}
          onChange={(patch) =>
            updateDraft({
              filters: draft.filters.map((item) =>
                item.id === filter.id ? { ...item, ...patch } : item,
              ),
            })
          }
          onRemove={() => updateDraft({ filters: draft.filters.filter((item) => item.id !== filter.id) })}
        />
      ))}
    </BuilderSection>
  )
}

function FilterRow({
  row,
  onChange,
  onRemove,
}: {
  row: SearchDslFilterRow
  onChange(patch: Partial<SearchDslFilterRow>): void
  onRemove(): void
}) {
  return (
    <div className={`query-builder-row query-builder-row--filter${row.enabled === false ? ' is-disabled' : ''}`}>
      <label className="query-builder-toggle">
        <input
          type="checkbox"
          aria-label={`Apply filter ${row.field || 'empty'}`}
          checked={row.enabled ?? true}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        On
      </label>
      <input
        aria-label="Filter field"
        value={row.field}
        onChange={(event) => onChange({ field: event.target.value })}
      />
      <select
        aria-label="Filter operator"
        value={row.operator}
        onChange={(event) => onChange({ operator: event.target.value as SearchDslFilterOperator })}
      >
        {FILTER_OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
      </select>
      <select
        aria-label="Filter value type"
        value={row.valueType}
        onChange={(event) => onChange({ valueType: event.target.value as SearchDslValueType })}
      >
        {VALUE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <input
        aria-label="Filter value"
        value={row.value}
        disabled={row.operator === 'exists'}
        onChange={(event) => onChange({ value: event.target.value })}
      />
      <button
        type="button"
        className="query-builder-remove"
        aria-label={`Remove filter ${row.field || 'empty'}`}
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  )
}

function SearchSimpleFieldSection({
  actionLabel,
  emptyText,
  fields,
  title,
  updateFields,
}: {
  actionLabel: string
  emptyText: string
  fields: Array<{ id: string; field: string }>
  title: string
  updateFields(fields: Array<{ id: string; field: string }>): void
}) {
  return (
    <BuilderSection
      title={title}
      actionLabel={actionLabel}
      dropHint="Drop a field"
      onAdd={() => updateFields([...fields, { id: searchDslBuilderRowId('search-field'), field: '' }])}
      onDropField={(field) => updateFields([...fields, { id: searchDslBuilderRowId('search-field'), field }])}
    >
      {fields.length === 0 ? (
        <p className="query-builder-empty">{emptyText}</p>
      ) : fields.map((item) => (
        <div key={item.id} className="query-builder-row query-builder-row--simple">
          <input
            aria-label={`${title} field`}
            value={item.field}
            onChange={(event) =>
              updateFields(fields.map((field) =>
                field.id === item.id ? { ...field, field: event.target.value } : field,
              ))
            }
          />
          <button
            type="button"
            className="query-builder-remove"
            aria-label={`Remove ${title.toLowerCase()} ${item.field || 'empty'}`}
            onClick={() => updateFields(fields.filter((field) => field.id !== item.id))}
          >
            Remove
          </button>
        </div>
      ))}
    </BuilderSection>
  )
}

function SearchSortSection({
  draft,
  updateDraft,
}: {
  draft: SearchDslBuilderState
  updateDraft(patch: Partial<SearchDslBuilderState>): void
}) {
  return (
    <BuilderSection
      title="Sort"
      actionLabel="Add Sort"
      dropHint="Drop a field to sort"
      onAdd={() => updateDraft({ sort: [...draft.sort, { id: searchDslBuilderRowId('search-sort'), field: '', direction: 'asc' }] })}
      onDropField={(field) => updateDraft({ sort: [...draft.sort, { id: searchDslBuilderRowId('search-sort'), field, direction: 'asc' }] })}
    >
      {draft.sort.length === 0 ? (
        <p className="query-builder-empty">No sorting applied.</p>
      ) : draft.sort.map((sort) => (
        <div key={sort.id} className="query-builder-row query-builder-row--sort">
          <input
            aria-label="Sort field"
            value={sort.field}
            onChange={(event) =>
              updateDraft({ sort: draft.sort.map((item) => item.id === sort.id ? { ...item, field: event.target.value } : item) })
            }
          />
          <select
            aria-label="Sort direction"
            value={sort.direction}
            onChange={(event) =>
              updateDraft({ sort: draft.sort.map((item) =>
                item.id === sort.id ? { ...item, direction: event.target.value === 'desc' ? 'desc' : 'asc' } : item,
              ) })
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <button
            type="button"
            className="query-builder-remove"
            aria-label={`Remove sort ${sort.field || 'empty'}`}
            onClick={() => updateDraft({ sort: draft.sort.filter((item) => item.id !== sort.id) })}
          >
            Remove
          </button>
        </div>
      ))}
    </BuilderSection>
  )
}

function SearchAggregationSection({
  draft,
  updateDraft,
}: {
  draft: SearchDslBuilderState
  updateDraft(patch: Partial<SearchDslBuilderState>): void
}) {
  return (
    <BuilderSection
      title="Aggregations"
      actionLabel="Add Terms"
      dropHint="Drop a field to aggregate"
      onAdd={() => updateDraft({ aggregations: [...draft.aggregations, { id: searchDslBuilderRowId('search-agg'), field: '', size: 10 }] })}
      onDropField={(field) => updateDraft({ aggregations: [...draft.aggregations, { id: searchDslBuilderRowId('search-agg'), field, size: 10 }] })}
    >
      {draft.aggregations.length === 0 ? (
        <p className="query-builder-empty">No aggregations requested.</p>
      ) : draft.aggregations.map((agg) => (
        <div key={agg.id} className="query-builder-row query-builder-row--filter">
          <input
            aria-label="Aggregation field"
            value={agg.field}
            onChange={(event) =>
              updateDraft({ aggregations: draft.aggregations.map((item) => item.id === agg.id ? { ...item, field: event.target.value } : item) })
            }
          />
          <input
            aria-label="Aggregation name"
            value={agg.name ?? ''}
            placeholder="optional name"
            onChange={(event) =>
              updateDraft({ aggregations: draft.aggregations.map((item) => item.id === agg.id ? { ...item, name: event.target.value } : item) })
            }
          />
          <input
            aria-label="Aggregation size"
            type="number"
            min={1}
            value={agg.size ?? 10}
            onChange={(event) =>
              updateDraft({ aggregations: draft.aggregations.map((item) => item.id === agg.id ? { ...item, size: numberValue(event.target.value, 10) } : item) })
            }
          />
          <button
            type="button"
            className="query-builder-remove"
            aria-label={`Remove aggregation ${agg.field || 'empty'}`}
            onClick={() => updateDraft({ aggregations: draft.aggregations.filter((item) => item.id !== agg.id) })}
          >
            Remove
          </button>
        </div>
      ))}
    </BuilderSection>
  )
}

function numberValue(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}
