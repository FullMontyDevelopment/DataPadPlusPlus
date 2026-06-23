import type { MongoBuilderValueType, MongoFindFilterGroup, MongoFindFilterRow, MongoFilterOperator } from '@datapadplusplus/shared-types'
import type { DragEvent, PointerEvent } from 'react'
import { BuilderSection } from '../../query-builder/BuilderSection'
import { TrashIcon } from '../../icons'
import type { MongoFindSectionProps } from './MongoBuilderSection.types'
import { rowId } from './MongoBuilderSection.types'
import { defaultFilterGroup } from '../../query-builder/mongo-find-defaults'
import { mongoFilterRow, mongoFilterRowFromDroppedField } from '../../query-builder/mongo-filter-row'
import {
  acceptMongoBuilderRowDrag,
  acceptMongoBuilderRowPointerDrop,
  clearMongoBuilderRowDrag,
  mongoBuilderPointerTarget,
  type MongoBuilderRowDragPayload,
} from './MongoBuilderRowDrag.helpers'
import { MongoBuilderDragHandle } from './MongoBuilderRowDrag'

const FILTER_OPERATORS: Array<{ value: MongoFilterOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'ne', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'Contains' },
  { value: 'not-contains', label: 'Not Contains' },
  { value: 'regex', label: 'Regex' },
  { value: 'is-null', label: 'Is null' },
  { value: 'is-not-null', label: 'Is not null' },
  { value: 'exists', label: 'Exists' },
  { value: 'does-not-exist', label: 'Does not exist' },
  { value: 'type', label: 'Is type' },
  { value: 'not-type', label: 'Is not type' },
  { value: 'starts-with', label: 'Starts with' },
  { value: 'not-starts-with', label: 'Does not start with' },
  { value: 'ends-with', label: 'Ends with' },
  { value: 'not-ends-with', label: 'Does not end with' },
  { value: 'in', label: 'In' },
  { value: 'not-in', label: 'Not in' },
]

const VALUE_TYPES: Array<{ value: MongoBuilderValueType; label: string }> = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'date', label: 'Date' },
  { value: 'objectId', label: 'ObjectId' },
  { value: 'null', label: 'null' },
  { value: 'json', label: 'json' },
]

export function MongoFilterBuilderSection({
  activeFilterGroupId,
  dragActive,
  draft,
  filterGroups,
  updateDraft,
}: MongoFindSectionProps & { activeFilterGroupId?: string }) {
  const hasExplicitGroups = filterGroups.length > 0
  const standaloneRows = draft.filters.filter((row) => !row.groupId)
  const moveFilter = (payload: MongoBuilderRowDragPayload, targetGroupId?: string, targetRowId?: string, placement: RowDropPlacement = 'after') => {
    updateDraft({
      filterGroups,
      filters: moveMongoFilterRow(draft.filters, payload.rowId, targetGroupId, targetRowId, placement),
    })
  }
  const handleFilterPointerDrop = (
    event: PointerEvent<HTMLElement>,
    fallbackGroupId?: string,
    fallbackRowId?: string,
  ) => {
    const payload = acceptMongoBuilderRowPointerDrop(event, 'filter')

    if (!payload) {
      return
    }

    const target = filterPointerDropTarget(event, fallbackGroupId, fallbackRowId)

    if (!target) {
      clearMongoBuilderRowDrag()
      return
    }

    event.stopPropagation()
    moveFilter(payload, target.groupId, target.rowId, target.placement)
    clearMongoBuilderRowDrag()
  }

  return (
    <BuilderSection
      title="Filters"
      actionLabel="Add Group"
      dropHint="Drop a result field to filter"
      dropZone="filters"
      dragActive={dragActive}
      onInternalDragOver={(event) => Boolean(acceptMongoBuilderRowDrag(event, 'filter'))}
      onInternalDrop={(event) => {
        const payload = acceptMongoBuilderRowDrag(event, 'filter')

        if (!payload) {
          return false
        }

        const target = event.target instanceof HTMLElement ? event.target : undefined
        const potentialTargetRow = target?.closest<HTMLElement>('[data-mongo-builder-row-id]')
        const targetRow = potentialTargetRow?.dataset.mongoBuilderRowKind === 'filter'
          ? potentialTargetRow
          : undefined
        const targetRowId = targetRow?.dataset.mongoBuilderRowId
        const targetGroupId = targetRow
          ? targetRow.dataset.mongoBuilderFilterGroupId || undefined
          : target?.closest<HTMLElement>('[data-mongo-builder-group-id]')?.dataset.mongoBuilderGroupId

        moveFilter(
          payload,
          targetGroupId,
          targetRowId,
          targetRow ? rowDropPlacement(event, targetRow) : 'after',
        )
        clearMongoBuilderRowDrag()
        return true
      }}
      secondaryActionLabel="Add Filter"
      onDropField={(field, payload) =>
        updateDraft({
          filterGroups,
          filters: [
            ...draft.filters,
            mongoFilterRowFromDroppedField(undefined, field, payload),
          ],
        })
      }
      onSecondaryAdd={() =>
        updateDraft({
          filterGroups,
          filters: [...draft.filters, mongoFilterRow(undefined)],
        })
      }
      onAdd={() =>
        updateDraft({
          filterGroups: [
            ...filterGroups,
            filterGroups.length === 0
              ? defaultFilterGroup()
              : {
                  id: rowId('filter-group'),
                  enabled: true,
                  label: `Group ${filterGroups.length + 1}`,
                  logic: 'and',
                },
          ],
        })
      }
    >
      {draft.filters.length === 0 && !hasExplicitGroups ? (
        <p className="query-builder-empty">No filters.</p>
      ) : null}
      {draft.filters.length > 0 || hasExplicitGroups ? (
        <div
          aria-label="Ungrouped filters"
          className="query-builder-filter-root"
          data-mongo-builder-filter-root="true"
          onDragOverCapture={(event) => {
            if (acceptMongoBuilderRowDrag(event, 'filter')) {
              event.stopPropagation()
            }
          }}
          onDropCapture={(event) => {
            const payload = acceptMongoBuilderRowDrag(event, 'filter')

            if (!payload) {
              return
            }

            event.stopPropagation()
            moveFilter(payload, undefined)
            clearMongoBuilderRowDrag()
          }}
          onPointerUpCapture={(event) => {
            handleFilterPointerDrop(event, undefined)
          }}
        >
          <FilterRows
            draft={draft}
            filterGroups={filterGroups}
            handleFilterPointerDrop={handleFilterPointerDrop}
            moveFilter={moveFilter}
            rows={standaloneRows}
            updateDraft={updateDraft}
          />
        </div>
      ) : null}
      {filterGroups.map((group) => (
        <FilterGroup
          draft={draft}
          filterGroups={filterGroups}
          group={group}
          handleFilterPointerDrop={handleFilterPointerDrop}
          key={group.id}
          dragActive={activeFilterGroupId === group.id}
          moveFilter={moveFilter}
          updateDraft={updateDraft}
        />
      ))}
    </BuilderSection>
  )
}

function FilterGroup({
  draft,
  dragActive,
  filterGroups,
  group,
  handleFilterPointerDrop,
  moveFilter,
  updateDraft,
}: MongoFindSectionProps & {
  dragActive?: boolean
  group: MongoFindFilterGroup
  handleFilterPointerDrop(event: PointerEvent<HTMLElement>, fallbackGroupId?: string, fallbackRowId?: string): void
  moveFilter(payload: MongoBuilderRowDragPayload, targetGroupId?: string, targetRowId?: string, placement?: RowDropPlacement): void
}) {
  const rows = draft.filters.filter((row) => row.groupId === group.id)

  return (
    <div
      aria-label={`Filter group ${group.label}`}
      className={`query-builder-filter-group${dragActive ? ' is-drag-over' : ''}${
        group.enabled === false ? ' is-disabled' : ''
      }`}
      data-mongo-builder-group-id={group.id}
      data-query-builder-drop-zone={`filters:${group.id}`}
      onDragOverCapture={(event) => {
        if (acceptMongoBuilderRowDrag(event, 'filter')) {
          event.stopPropagation()
        }
      }}
      onDropCapture={(event) => {
        const payload = acceptMongoBuilderRowDrag(event, 'filter')

        if (!payload) {
          return
        }

        event.stopPropagation()
        moveFilter(payload, group.id)
        clearMongoBuilderRowDrag()
      }}
      onPointerUpCapture={(event) => {
        handleFilterPointerDrop(event, group.id)
      }}
    >
      <div className="query-builder-filter-group-header">
        <label className="query-builder-toggle">
          <input
            aria-label={`Apply group ${group.label}`}
            title={group.enabled === false ? `Enable ${group.label}` : `Disable ${group.label}`}
            type="checkbox"
            checked={group.enabled ?? true}
            onChange={(event) =>
              updateDraft({
                filterGroups: filterGroups.map((item) =>
                  item.id === group.id ? { ...item, enabled: event.target.checked } : item,
                ),
              })
            }
          />
        </label>
        <strong>{group.label}</strong>
        <label>
          <span>Match</span>
          <select
            aria-label={`Filter group logic ${group.label}`}
            value={group.logic}
            onChange={(event) =>
              updateDraft({
                filterGroups: filterGroups.map((item) =>
                  item.id === group.id
                    ? { ...item, logic: event.target.value as MongoFindFilterGroup['logic'] }
                    : item,
                ),
              })
            }
          >
            <option value="and">All (AND)</option>
            <option value="or">Any (OR)</option>
          </select>
        </label>
        <button
          type="button"
          className="drawer-button"
          onClick={() =>
            updateDraft({
              filterGroups,
              filters: [...draft.filters, mongoFilterRow(group.id)],
            })
          }
        >
          Add Filter
        </button>
        <button
          type="button"
          className="query-builder-remove query-builder-remove--icon"
          aria-label={filterGroups.length === 1 ? `Clear ${group.label}` : `Remove ${group.label}`}
          title={filterGroups.length === 1 ? `Clear ${group.label}` : `Remove ${group.label}`}
          onClick={() =>
            updateDraft({
              filterGroups: filterGroups.filter((item) => item.id !== group.id),
              filters: draft.filters.filter((row) => row.groupId !== group.id),
            })
          }
        >
          <TrashIcon className="toolbar-icon" />
        </button>
      </div>
      {rows.length === 0 ? <p className="query-builder-empty">No filters in this group.</p> : null}
      <FilterRows
        draft={draft}
        filterGroups={filterGroups}
        moveFilter={moveFilter}
        handleFilterPointerDrop={handleFilterPointerDrop}
        rows={rows}
        updateDraft={updateDraft}
      />
    </div>
  )
}

function FilterRows({
  draft,
  filterGroups,
  handleFilterPointerDrop,
  moveFilter,
  rows,
  updateDraft,
}: MongoFindSectionProps & {
  handleFilterPointerDrop(event: PointerEvent<HTMLElement>, fallbackGroupId?: string, fallbackRowId?: string): void
  moveFilter(payload: MongoBuilderRowDragPayload, targetGroupId?: string, targetRowId?: string, placement?: RowDropPlacement): void
  rows: MongoFindFilterRow[]
}) {
  return (
    <>
      {rows.map((row) => (
        <div
          className={`query-builder-row query-builder-row--filter query-builder-row--draggable${
            row.enabled === false ? ' is-disabled' : ''
          }`}
          data-mongo-builder-filter-group-id={row.groupId}
          data-mongo-builder-row-kind="filter"
          data-mongo-builder-row-id={row.id}
          key={row.id}
          onDragOverCapture={(event) => {
            if (acceptMongoBuilderRowDrag(event, 'filter')) {
              event.stopPropagation()
            }
          }}
          onDropCapture={(event) => {
            const payload = acceptMongoBuilderRowDrag(event, 'filter')

            if (!payload) {
              return
            }

            event.stopPropagation()
            moveFilter(payload, row.groupId, row.id, rowDropPlacement(event))
            clearMongoBuilderRowDrag()
          }}
          onPointerUpCapture={(event) => {
            handleFilterPointerDrop(event, row.groupId, row.id)
          }}
        >
          <MongoBuilderDragHandle
            groupId={row.groupId}
            kind="filter"
            label={`Drag filter ${row.field || row.id}`}
            rowId={row.id}
          />
          <label className="query-builder-toggle">
            <input
              aria-label={`Apply filter ${row.field || row.id}`}
              title={row.enabled === false ? 'Enable filter' : 'Disable filter'}
              type="checkbox"
              checked={row.enabled ?? true}
              onChange={(event) =>
                updateDraft({
                  filterGroups,
                  filters: draft.filters.map((item) =>
                    item.id === row.id ? { ...item, enabled: event.target.checked } : item,
                  ),
                })
              }
            />
          </label>
          <input
            aria-label="Filter field"
            placeholder="field"
            value={row.field}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                filters: draft.filters.map((item) =>
                  item.id === row.id ? { ...item, field: event.target.value } : item,
                ),
              })
            }
          />
          <select
            aria-label="Filter operator"
            value={row.operator}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                filters: draft.filters.map((item) =>
                  item.id === row.id
                    ? mongoFilterWithOperator(item, event.target.value as MongoFilterOperator)
                    : item,
                ),
              })
            }
          >
            {FILTER_OPERATORS.map((operator) => (
              <option key={operator.value} value={operator.value}>
                {operator.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Value type"
            value={row.valueType}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                filters: draft.filters.map((item) =>
                  item.id === row.id
                    ? { ...item, valueType: event.target.value as MongoBuilderValueType }
                    : item,
                ),
              })
            }
          >
            {VALUE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Filter value"
            placeholder={filterValuePlaceholder(row.operator)}
            value={row.value}
            disabled={row.valueType === 'null' || mongoOperatorHasNoValue(row.operator)}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                filters: draft.filters.map((item) =>
                  item.id === row.id ? { ...item, value: event.target.value } : item,
                ),
              })
            }
          />
          <button
            type="button"
            className="query-builder-remove query-builder-remove--icon"
            aria-label="Remove filter"
            title="Remove filter"
            onClick={() =>
              updateDraft({
                filterGroups,
                filters: draft.filters.filter((item) => item.id !== row.id),
              })
            }
          >
            <TrashIcon className="toolbar-icon" />
          </button>
        </div>
      ))}
    </>
  )
}

function mongoFilterWithOperator(row: MongoFindFilterRow, operator: MongoFilterOperator): MongoFindFilterRow {
  const currentlyNoValue = mongoOperatorHasNoValue(row.operator) || row.valueType === 'null'
  const nextHasNoValue = mongoOperatorHasNoValue(operator)

  return {
    ...row,
    operator,
    value: nextHasNoValue ? '' : row.value,
    valueType: operator === 'is-null' || operator === 'is-not-null'
      ? 'null'
      : currentlyNoValue && !nextHasNoValue
        ? 'string'
        : row.valueType,
  }
}

function mongoOperatorHasNoValue(operator: MongoFilterOperator) {
  return ['exists', 'does-not-exist', 'is-null', 'is-not-null'].includes(operator)
}

function filterValuePlaceholder(operator: MongoFilterOperator) {
  if (operator === 'type' || operator === 'not-type') {
    return 'string, date, objectId, 2...'
  }

  return mongoOperatorHasNoValue(operator) ? '' : 'value'
}

type RowDropPlacement = 'before' | 'after'
interface FilterPointerDropTarget {
  groupId?: string
  rowId?: string
  placement: RowDropPlacement
}

function moveMongoFilterRow(
  filters: MongoFindFilterRow[],
  rowId: string,
  targetGroupId?: string,
  targetRowId?: string,
  placement: RowDropPlacement = 'after',
) {
  const moving = filters.find((row) => row.id === rowId)

  if (!moving) {
    return filters
  }

  if (targetRowId === rowId && moving.groupId === targetGroupId) {
    return filters
  }

  const withoutMoving = filters.filter((row) => row.id !== rowId)
  const moved = { ...moving, groupId: targetGroupId }
  const targetIndex = targetRowId
    ? withoutMoving.findIndex((row) => row.id === targetRowId)
    : -1

  if (targetIndex >= 0) {
    const next = [...withoutMoving]
    next.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, moved)
    return next
  }

  const appendIndex = lastIndexForGroup(withoutMoving, targetGroupId) + 1
  const next = [...withoutMoving]
  next.splice(appendIndex, 0, moved)
  return next
}

function lastIndexForGroup(filters: MongoFindFilterRow[], groupId?: string) {
  for (let index = filters.length - 1; index >= 0; index -= 1) {
    if (filters[index]?.groupId === groupId) {
      return index
    }
  }

  return -1
}

function rowDropPlacement(event: DragEvent<HTMLElement>, element = event.currentTarget): RowDropPlacement {
  const rect = element.getBoundingClientRect()
  return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
}

function rowPointerDropPlacement(event: PointerEvent<HTMLElement>, element = event.currentTarget): RowDropPlacement {
  const rect = element.getBoundingClientRect()
  return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
}

function filterPointerDropTarget(
  event: PointerEvent<HTMLElement>,
  fallbackGroupId?: string,
  fallbackRowId?: string,
): FilterPointerDropTarget | undefined {
  const target = mongoBuilderPointerTarget(event)
  const potentialTargetRow = target?.closest<HTMLElement>('[data-mongo-builder-row-id]')
  const targetRow = potentialTargetRow?.dataset.mongoBuilderRowKind === 'filter'
    ? potentialTargetRow
    : undefined

  if (targetRow) {
    const targetRowId = targetRow.dataset.mongoBuilderRowId

    if (targetRowId) {
      return filterPointerDropResult(
        targetRow.dataset.mongoBuilderFilterGroupId || undefined,
        rowPointerDropPlacement(event, targetRow),
        targetRowId,
      )
    }
  }

  const targetGroupId = target
    ?.closest<HTMLElement>('[data-mongo-builder-group-id]')
    ?.dataset.mongoBuilderGroupId

  if (targetGroupId) {
    return filterPointerDropResult(targetGroupId, 'after')
  }

  const isUngroupedRoot = target?.closest<HTMLElement>('[data-mongo-builder-filter-root]')

  if (isUngroupedRoot) {
    return filterPointerDropResult(undefined, 'after')
  }

  if (fallbackRowId) {
    return filterPointerDropResult(fallbackGroupId, rowPointerDropPlacement(event), fallbackRowId)
  }

  if (fallbackGroupId !== undefined) {
    return filterPointerDropResult(fallbackGroupId, 'after')
  }

  return undefined
}

function filterPointerDropResult(
  groupId: string | undefined,
  placement: RowDropPlacement,
  rowId?: string,
): FilterPointerDropTarget {
  return {
    ...(groupId !== undefined ? { groupId } : {}),
    ...(rowId !== undefined ? { rowId } : {}),
    placement,
  }
}
