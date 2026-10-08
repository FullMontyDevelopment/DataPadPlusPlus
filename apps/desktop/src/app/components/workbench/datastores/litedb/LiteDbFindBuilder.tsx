import type { LiteDbFindBuilderState, LiteDbFilterOperator } from '@datapadplusplus/shared-types'
import { useRef } from 'react'
import type { DatastoreQueryBuilderProps } from '../types'
import { BuilderSection } from '../../query-builder/BuilderSection'
import { QueryBuilderIconButton } from '../../query-builder/QueryBuilderIconButton'
import { QueryBuilderValueInput } from '../../query-builder/QueryBuilderValueInput'
import { queryBuilderOperatorArity, queryBuilderValueTypeLabel } from '../../query-builder/query-value-codec'
import { builderStateWithCompiledQueryText } from '../../../../controllers/query-builder-routing'
import { isLiteDbFindBuilderState, LITEDB_FILTER_OPERATORS } from './litedb-find'

type Filter = LiteDbFindBuilderState['filters'][number]
const VALUE_TYPES: Filter['valueType'][] = ['string', 'number', 'boolean', 'null', 'date', 'uuid', 'objectId', 'json']
const newId = () => crypto.randomUUID()

export function LiteDbFindBuilder(props: DatastoreQueryBuilderProps) {
  if (!isLiteDbFindBuilderState(props.builderState)) return null
  return <LiteDbFindBuilderContent {...props} state={props.builderState} />
}

function LiteDbFindBuilderContent({ state, tab, collectionOptions, theme, onBuilderStateChange, showFetchSize }: DatastoreQueryBuilderProps & { state: LiteDbFindBuilderState }) {
  const sortField = useRef<HTMLInputElement>(null)
  const update = (patch: Partial<LiteDbFindBuilderState>) => {
    onBuilderStateChange?.(tab.id, builderStateWithCompiledQueryText({ ...state, ...patch }, undefined, tab))
  }
  const addFilter = (groupId?: string, field = '') => update({ filters: [...state.filters, { id: newId(), groupId, field, operator: 'eq', valueType: 'string', value: '' }] })
  const updateFilter = (id: string, patch: Partial<Filter>) => update({ filters: state.filters.map(row => row.id === id ? { ...row, ...patch } : row) })
  const renderFilter = (row: Filter, index: number) => {
    const arity = queryBuilderOperatorArity(row.operator)
    return <div key={row.id} className={`query-builder-row query-builder-row--filter is-${arity}${row.enabled === false ? ' is-disabled' : ''}`}>
      <label className="query-builder-toggle"><input type="checkbox" aria-label={`Enable filter ${index + 1}`} checked={row.enabled !== false} onChange={event => updateFilter(row.id, { enabled: event.target.checked })} /></label>
      <input aria-label={`Filter ${index + 1} field`} placeholder="Field or nested.path" value={row.field} onChange={event => updateFilter(row.id, { field: event.target.value })} />
      <select aria-label={`Filter ${index + 1} operator`} value={row.operator} onChange={event => {
        const operator = event.target.value as LiteDbFilterOperator
        updateFilter(row.id, { operator, valueType: ['contains', 'starts-with'].includes(operator) ? 'string' : row.valueType })
      }}>
        {LITEDB_FILTER_OPERATORS.map(operator => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
      </select>
      {arity !== 'none' && arity !== 'length' ? <select className="query-builder-value-type" aria-label={`Filter ${index + 1} type`} value={row.valueType} onChange={event => updateFilter(row.id, { valueType: event.target.value as Filter['valueType'] })}>
        {VALUE_TYPES.filter(type => !['contains', 'starts-with'].includes(row.operator) || type === 'string').map(type => <option key={type} value={type}>{queryBuilderValueTypeLabel(type)}</option>)}
      </select> : null}
      {arity !== 'none' ? <QueryBuilderValueInput ariaLabel={`Filter ${index + 1} value`} theme={theme} operator={row.operator} valueType={arity === 'length' ? 'number' : row.valueType} value={row.value} onChange={value => updateFilter(row.id, { value })} /> : null}
      <QueryBuilderIconButton action="remove" label={`Remove filter ${index + 1}`} onClick={() => update({ filters: state.filters.filter(item => item.id !== row.id) })} />
    </div>
  }
  return <section className="query-builder-panel" aria-label="LiteDB query builder">
    <div className="query-builder-grid">
      <label className="query-builder-field"><span>Collection</span><input aria-label="Collection" list={`litedb-collections-${tab.id}`} value={state.collection} onChange={event => update({ collection: event.target.value })} />
        <datalist id={`litedb-collections-${tab.id}`}>{[...new Set(collectionOptions)].map(name => <option key={name} value={name} />)}</datalist>
      </label>
      <label className="query-builder-field query-builder-field--number"><span>Skip</span><input aria-label="Skip" type="number" min={0} step={1} value={Number.isNaN(state.skip) ? '' : state.skip ?? 0} onChange={event => update({ skip: event.target.valueAsNumber })} /></label>
      {showFetchSize ? <label className="query-builder-field query-builder-field--number"><span>Fetch size</span><input aria-label="Fetch size" type="number" min={1} step={1} value={Number.isNaN(state.limit) ? '' : state.limit ?? 20} onChange={event => update({ limit: event.target.valueAsNumber })} /></label> : null}
    </div>
    <BuilderSection title="Filters" actionLabel="Add Filter" onAdd={() => addFilter()} secondaryActionLabel="Add Group" onSecondaryAdd={() => update({ filterGroups: [...state.filterGroups, { id: newId(), label: `Group ${state.filterGroups.length + 1}`, logic: 'and' }] })} onDropField={field => addFilter(undefined, field)}>
      <label className="query-builder-inline-field">Match<select aria-label="Filter logic" value={state.filterLogic} onChange={event => update({ filterLogic: event.target.value as 'and' | 'or' })}><option value="and">All (AND)</option><option value="or">Any (OR)</option></select></label>
      {!state.filters.length && !state.filterGroups.length ? <p className="query-builder-empty">All documents. Add filters to narrow the results.</p> : null}
      {state.filters.map((row, index) => !row.groupId ? renderFilter(row, index) : null)}
      {state.filterGroups.map(group => <fieldset key={group.id} className="query-builder-section">
        <legend>{group.label}</legend>
        <div className="query-builder-section-header">
          <label className="query-builder-toggle"><input type="checkbox" aria-label={`Enable ${group.label}`} checked={group.enabled !== false} onChange={event => update({ filterGroups: state.filterGroups.map(item => item.id === group.id ? { ...item, enabled: event.target.checked } : item) })} />Enabled</label>
          <select aria-label={`${group.label} logic`} value={group.logic} onChange={event => update({ filterGroups: state.filterGroups.map(item => item.id === group.id ? { ...item, logic: event.target.value as 'and' | 'or' } : item) })}><option value="and">All (AND)</option><option value="or">Any (OR)</option></select>
          <button type="button" onClick={() => addFilter(group.id)}>Add Filter</button>
          <QueryBuilderIconButton action="remove" label={`Remove ${group.label}`} onClick={() => update({ filterGroups: state.filterGroups.filter(item => item.id !== group.id), filters: state.filters.filter(row => row.groupId !== group.id) })} />
        </div>
        {state.filters.map((row, index) => row.groupId === group.id ? renderFilter(row, index) : null)}
      </fieldset>)}
    </BuilderSection>
    <BuilderSection title="Sort" actionLabel={state.sort.length ? 'Edit sort field' : 'Add sort field'} onAdd={() => {
      if (!state.sort.length) update({ sort: [{ id: newId(), field: '', direction: 'asc' }] })
      else sortField.current?.focus()
    }} onDropField={field => update({ sort: [{ id: newId(), field, direction: 'asc' }] })}>
      {state.sort.length ? state.sort.map(sort => <div key={sort.id} className="query-builder-row query-builder-row--sort">
        <input ref={sortField} aria-label="Sort field" placeholder="Field" value={sort.field} onChange={event => update({ sort: [{ ...sort, field: event.target.value }] })} />
        <select aria-label="Sort direction" value={sort.direction} onChange={event => update({ sort: [{ ...sort, direction: event.target.value as 'asc' | 'desc' }] })}><option value="asc">Ascending</option><option value="desc">Descending</option></select>
        <QueryBuilderIconButton action="remove" label="Remove sort" onClick={() => update({ sort: [] })} />
      </div>) : <p className="query-builder-empty">Natural order.</p>}
    </BuilderSection>
    {state.filters.some(row => row.enabled !== false && ['contains', 'starts-with', 'has-items', 'has-no-items', 'has-length'].includes(row.operator)) ? <p className="query-builder-empty">Computed filters may scan documents. LiteDB uses the database’s configured collation.</p> : null}
  </section>
}
