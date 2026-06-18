import type { DragEvent, PointerEvent } from 'react'
import { BuilderSection } from '../../query-builder/BuilderSection'
import { TrashIcon } from '../../icons'
import type { MongoFindSectionProps } from './MongoBuilderSection.types'
import { rowId } from './MongoBuilderSection.types'
import {
  acceptMongoBuilderRowDrag,
  acceptMongoBuilderRowPointerDrop,
  clearMongoBuilderRowDrag,
  mongoBuilderPointerTarget,
  MongoBuilderDragHandle,
} from './MongoBuilderRowDrag'

export function MongoSortBuilderSection({
  dragActive,
  draft,
  filterGroups,
  updateDraft,
}: MongoFindSectionProps) {
  return (
    <BuilderSection
      title="Sort"
      actionLabel="Add Sort"
      dropHint="Drop a result field to order"
      dropZone="sort"
      dragActive={dragActive}
      onInternalDragOver={(event) => Boolean(acceptMongoBuilderRowDrag(event, 'sort'))}
      onInternalDrop={(event) => {
        const payload = acceptMongoBuilderRowDrag(event, 'sort')
        const targetRow = mongoBuilderRowElement(event.target)
        const targetRowId = targetRow?.dataset.mongoBuilderRowId

        if (!payload || !targetRowId) {
          return false
        }

        updateDraft({
          filterGroups,
          sort: moveRow(draft.sort, payload.rowId, targetRowId, rowDropPlacement(event, targetRow)),
        })
        clearMongoBuilderRowDrag()
        return true
      }}
      onDropField={(field) =>
        updateDraft({
          filterGroups,
          sort: [...draft.sort, { id: rowId('sort'), field, direction: 'asc' }],
        })
      }
      onAdd={() =>
        updateDraft({
          filterGroups,
          sort: [...draft.sort, { id: rowId('sort'), field: '', direction: 'asc' }],
        })
      }
    >
      {draft.sort.length === 0 ? <p className="query-builder-empty">No sort.</p> : null}
      {draft.sort.map((row) => (
        <div
          className="query-builder-row query-builder-row--sort query-builder-row--draggable"
          data-mongo-builder-row-kind="sort"
          data-mongo-builder-row-id={row.id}
          key={row.id}
          onDragOverCapture={(event) => {
            if (acceptMongoBuilderRowDrag(event, 'sort')) {
              event.stopPropagation()
            }
          }}
          onDropCapture={(event) => {
            const payload = acceptMongoBuilderRowDrag(event, 'sort')

            if (!payload) {
              return
            }

            event.stopPropagation()
            updateDraft({
              filterGroups,
              sort: moveRow(draft.sort, payload.rowId, row.id, rowDropPlacement(event)),
            })
            clearMongoBuilderRowDrag()
          }}
          onPointerUpCapture={(event) => {
            const payload = acceptMongoBuilderRowPointerDrop(event, 'sort')

            if (!payload) {
              return
            }

            const targetRow = mongoBuilderCompatibleRowElement(
              mongoBuilderPointerTarget(event),
              'sort',
            )
            const targetRowId = targetRow?.dataset.mongoBuilderRowId

            if (!targetRowId) {
              clearMongoBuilderRowDrag()
              return
            }

            event.stopPropagation()
            updateDraft({
              filterGroups,
              sort: moveRow(draft.sort, payload.rowId, targetRowId, rowPointerDropPlacement(event, targetRow)),
            })
            clearMongoBuilderRowDrag()
          }}
        >
          <MongoBuilderDragHandle
            kind="sort"
            label={`Drag sort ${row.field || row.id}`}
            rowId={row.id}
          />
          <input
            aria-label="Sort field"
            placeholder="field"
            value={row.field}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                sort: draft.sort.map((item) =>
                  item.id === row.id ? { ...item, field: event.target.value } : item,
                ),
              })
            }
          />
          <select
            aria-label="Sort direction"
            value={row.direction}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                sort: draft.sort.map((item) =>
                  item.id === row.id
                    ? { ...item, direction: event.target.value as 'asc' | 'desc' }
                    : item,
                ),
              })
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <button
            type="button"
            className="query-builder-remove query-builder-remove--icon"
            aria-label="Remove sort"
            title="Remove sort"
            onClick={() =>
              updateDraft({
                filterGroups,
                sort: draft.sort.filter((item) => item.id !== row.id),
              })
            }
          >
            <TrashIcon className="toolbar-icon" />
          </button>
        </div>
      ))}
    </BuilderSection>
  )
}

type RowDropPlacement = 'before' | 'after'

function moveRow<T extends { id: string }>(
  rows: T[],
  rowId: string,
  targetRowId: string,
  placement: RowDropPlacement,
) {
  const moving = rows.find((item) => item.id === rowId)

  if (!moving || rowId === targetRowId) {
    return rows
  }

  const withoutMoving = rows.filter((item) => item.id !== rowId)
  const targetIndex = withoutMoving.findIndex((item) => item.id === targetRowId)

  if (targetIndex < 0) {
    return [...withoutMoving, moving]
  }

  const next = [...withoutMoving]
  next.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, moving)
  return next
}

function rowDropPlacement(event: DragEvent<HTMLElement>, element = event.currentTarget): RowDropPlacement {
  const rect = element.getBoundingClientRect()
  return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
}

function rowPointerDropPlacement(event: PointerEvent<HTMLElement>, element = event.currentTarget): RowDropPlacement {
  const rect = element.getBoundingClientRect()
  return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
}

function mongoBuilderRowElement(target: EventTarget | null) {
  return mongoBuilderCompatibleRowElement(
    target instanceof HTMLElement ? target : undefined,
    'sort',
  )
}

function mongoBuilderCompatibleRowElement(target: HTMLElement | undefined, kind: string) {
  const row = target?.closest<HTMLElement>('[data-mongo-builder-row-id]')
  return row?.dataset.mongoBuilderRowKind === kind ? row : undefined
}
