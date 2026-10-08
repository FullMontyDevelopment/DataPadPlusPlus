import type { LiteDbFindBuilderState, LiteDbFilterOperator } from '@datapadplusplus/shared-types'
import { useCallback, useRef } from 'react'
import type { DatastoreQueryBuilderProps } from '../types'
import { BuilderSection } from '../../query-builder/BuilderSection'
import { QueryBuilderIconButton } from '../../query-builder/QueryBuilderIconButton'
import { QueryBuilderValueInput } from '../../query-builder/QueryBuilderValueInput'
import { queryBuilderOperatorArity, queryBuilderValueTypeLabel } from '../../query-builder/query-value-codec'
import { builderStateWithCompiledQueryText } from '../../../../controllers/query-builder-routing'
import { isLiteDbFindBuilderState, LITEDB_FILTER_OPERATORS } from './litedb-find'
import { DragHandleIcon } from '../../icons'
import { useQueryBuilderFieldDrop } from '../../query-builder/useQueryBuilderFieldDrop'
import { moveQueryBuilderFilter, useQueryBuilderFilterDrag, type FilterDropTarget } from '../../query-builder/useQueryBuilderFilterDrag'
import { filterGroupIdFromDropZone } from '../../query-builder/query-builder-drag-targets'
import type { FieldDragPayload } from '../../results/field-drag'
import { liteDbFilterFromDrop } from './litedb-filter-drop'

type Filter = LiteDbFindBuilderState['filters'][number]
const VALUE_TYPES: Filter['valueType'][] = ['string', 'number', 'boolean', 'null', 'date', 'uuid', 'objectId', 'json']
const newId = () => crypto.randomUUID()

export function LiteDbFindBuilder(props: DatastoreQueryBuilderProps) {
  if (!isLiteDbFindBuilderState(props.builderState)) return null
  return <LiteDbFindBuilderContent key={`${props.tab.connectionId}:${props.tab.environmentId}`} {...props} state={props.builderState} />
}

function LiteDbFindBuilderContent({ state, tab, collectionOptions, theme, onBuilderStateChange, showFetchSize, showTargetInputs = true, countControl }: DatastoreQueryBuilderProps & { state: LiteDbFindBuilderState }) {
  const sortField = useRef<HTMLInputElement>(null)
  const update = useCallback((patch: Partial<LiteDbFindBuilderState>) => {
    onBuilderStateChange?.(tab.id, builderStateWithCompiledQueryText({ ...state, ...patch }, undefined, tab))
  }, [onBuilderStateChange, state, tab])
  const addDroppedField = useCallback((payload: FieldDragPayload, zone: string) => {
    if (zone === 'sort') {
      // LiteDB Find supports one sort field; preserve the chosen direction on replacement.
      update({ sort: [{ id: state.sort[0]?.id ?? newId(), field: payload.fieldPath, direction: state.sort[0]?.direction ?? 'asc' }] })
      return
    }
    const groupId = filterGroupIdFromDropZone(zone)
    if (groupId && !state.filterGroups.some(group => group.id === groupId)) return
    update({ filters: [...state.filters, liteDbFilterFromDrop(payload, groupId)] })
  }, [state, update])
  const contextKey = `${tab.id}:${state.collection}`
  const { rootRef, activeDropZone, dropHandlers } = useQueryBuilderFieldDrop(contextKey, onBuilderStateChange ? addDroppedField : undefined)
  const moveFilter = useCallback((id: string, target: FilterDropTarget) => {
    if (target.groupId && !state.filterGroups.some(group => group.id === target.groupId)) return
    update({ filters: moveQueryBuilderFilter(state.filters, id, target) })
  }, [state, update])
  const startFilterDrag = useQueryBuilderFilterDrag(rootRef, contextKey, onBuilderStateChange ? moveFilter : undefined)
  const addFilter = (groupId?: string, field = '') => update({ filters: [...state.filters, { id: newId(), groupId, field, operator: 'eq', valueType: 'string', value: '' }] })
  const updateFilter = (id: string, patch: Partial<Filter>) => update({ filters: state.filters.map(row => row.id === id ? { ...row, ...patch } : row) })
  const renderFilter = (row: Filter, index: number) => {
    const arity = queryBuilderOperatorArity(row.operator)
    return <div key={row.id} data-query-builder-filter-id={row.id} className={`query-builder-row query-builder-row--filter query-builder-row--draggable is-${arity}${row.enabled === false ? ' is-disabled' : ''}`}>
      <button type="button" className="query-builder-drag-handle" aria-label={`Drag filter ${row.field || index + 1}`} title="Drag to reorder or move between groups. Use Up/Down to reorder." disabled={!onBuilderStateChange}
        onPointerDown={event => startFilterDrag(event, row.id)}
        onKeyDown={event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          const siblings = state.filters.filter(item => item.groupId === row.groupId)
          const adjacent = siblings[siblings.findIndex(item => item.id === row.id) + (event.key === 'ArrowUp' ? -1 : 1)]
          if (adjacent) moveFilter(row.id, { groupId: row.groupId, rowId: adjacent.id, placement: event.key === 'ArrowUp' ? 'before' : 'after' })
        }}><DragHandleIcon className="toolbar-icon" /></button>
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
  return <section ref={rootRef} {...dropHandlers} className={`query-builder-panel litedb-query-builder${activeDropZone ? ' is-drag-over' : ''}`} aria-label="LiteDB query builder">
    <div className="litedb-query-builder-controls">
      {showTargetInputs ? <label className="query-builder-field litedb-query-builder-collection"><span>Collection</span><input aria-label="Collection" list={`litedb-collections-${tab.id}`} value={state.collection} onChange={event => update({ collection: event.target.value })} />
        <datalist id={`litedb-collections-${tab.id}`}>{[...new Set(collectionOptions)].map(name => <option key={name} value={name} />)}</datalist>
      </label> : null}
      <label className="query-builder-field query-builder-field--number"><span>Skip</span><input aria-label="Skip" type="number" min={0} step={1} value={Number.isNaN(state.skip) ? '' : state.skip ?? 0} onChange={event => update({ skip: event.target.valueAsNumber })} /></label>
      {showFetchSize ? <label className="query-builder-field query-builder-field--number"><span>Fetch size</span><input aria-label="Fetch size" type="number" min={1} step={1} value={Number.isNaN(state.limit) ? '' : state.limit ?? 20} onChange={event => update({ limit: event.target.valueAsNumber })} /></label> : null}
      {countControl}
    </div>
    <BuilderSection title="Filters" actionLabel="Add Group" onAdd={() => update({ filterGroups: [...state.filterGroups, { id: newId(), label: `Group ${state.filterGroups.length + 1}`, logic: 'and' }] })} secondaryActionLabel="Add Filter" onSecondaryAdd={() => addFilter()} dropHint="Drop a result field to filter" dropZone="filters" dragActive={activeDropZone === 'filters'}>
      {state.filters.length || state.filterGroups.length ? <label className="query-builder-inline-field">Match<select aria-label="Filter logic" value={state.filterLogic} onChange={event => update({ filterLogic: event.target.value as 'and' | 'or' })}><option value="and">All (AND)</option><option value="or">Any (OR)</option></select></label> : <p className="query-builder-empty">No filters.</p>}
      {state.filters.length || state.filterGroups.length ? <div className="query-builder-filter-root" aria-label="Ungrouped filters" data-query-builder-drop-zone="filters">
        {state.filters.map((row, index) => !row.groupId ? renderFilter(row, index) : null)}
      </div> : null}
      {state.filterGroups.map(group => <div key={group.id} aria-label={`Filter group ${group.label}`} data-query-builder-drop-zone={`filters:${group.id}`} className={`query-builder-filter-group${activeDropZone === `filters:${group.id}` ? ' is-drag-over' : ''}${group.enabled === false ? ' is-disabled' : ''}`}>
        <div className="query-builder-filter-group-header">
          <label className="query-builder-toggle"><input type="checkbox" aria-label={`Enable ${group.label}`} checked={group.enabled !== false} onChange={event => update({ filterGroups: state.filterGroups.map(item => item.id === group.id ? { ...item, enabled: event.target.checked } : item) })} /></label>
          <strong>{group.label}</strong>
          <label><span>Match</span><select aria-label={`${group.label} logic`} value={group.logic} onChange={event => update({ filterGroups: state.filterGroups.map(item => item.id === group.id ? { ...item, logic: event.target.value as 'and' | 'or' } : item) })}><option value="and">All (AND)</option><option value="or">Any (OR)</option></select></label>
          <button type="button" className="drawer-button" onClick={() => addFilter(group.id)}>Add Filter</button>
          <QueryBuilderIconButton action="remove" label={`Remove ${group.label}`} onClick={() => update({ filterGroups: state.filterGroups.filter(item => item.id !== group.id), filters: state.filters.filter(row => row.groupId !== group.id) })} />
        </div>
        {!state.filters.some(row => row.groupId === group.id) ? <p className="query-builder-empty">No filters in this group.</p> : null}
        {state.filters.map((row, index) => row.groupId === group.id ? renderFilter(row, index) : null)}
      </div>)}
    </BuilderSection>
    <BuilderSection title="Sort" actionLabel={state.sort.length ? 'Edit Sort' : 'Add Sort'} dropHint="Drop a result field to order" dropZone="sort" dragActive={activeDropZone === 'sort'} onAdd={() => {
      if (!state.sort.length) update({ sort: [{ id: newId(), field: '', direction: 'asc' }] })
      else sortField.current?.focus()
    }}>
      {state.sort.length ? state.sort.map(sort => <div key={sort.id} className="query-builder-row query-builder-row--sort">
        <input ref={sortField} aria-label="Sort field" placeholder="Field" value={sort.field} onChange={event => update({ sort: [{ ...sort, field: event.target.value }] })} />
        <select aria-label="Sort direction" value={sort.direction} onChange={event => update({ sort: [{ ...sort, direction: event.target.value as 'asc' | 'desc' }] })}><option value="asc">Ascending</option><option value="desc">Descending</option></select>
        <QueryBuilderIconButton action="remove" label="Remove sort" onClick={() => update({ sort: [] })} />
      </div>) : <p className="query-builder-empty">No sort.</p>}
    </BuilderSection>
    {state.filters.some(row => row.enabled !== false && ['contains', 'starts-with', 'has-items', 'has-no-items', 'has-length'].includes(row.operator)) ? <p className="query-builder-empty">Computed filters may scan documents. LiteDB uses the database’s configured collation.</p> : null}
  </section>
}
