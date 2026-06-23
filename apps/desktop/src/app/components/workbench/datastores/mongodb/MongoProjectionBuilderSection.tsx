import type { MongoFindBuilderState } from '@datapadplusplus/shared-types'
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
} from './MongoBuilderRowDrag.helpers'
import { MongoBuilderDragHandle } from './MongoBuilderRowDrag'

export function MongoProjectionBuilderSection({
  dragActive,
  draft,
  filterGroups,
  updateDraft,
}: MongoFindSectionProps) {
  return (
    <BuilderSection
      title="Projection"
      actionLabel="Add Field"
      dropHint="Drop a result field to project"
      dropZone="projection"
      dragActive={dragActive}
      onInternalDragOver={(event) => Boolean(acceptMongoBuilderRowDrag(event, 'projection'))}
      onInternalDrop={(event) => {
        const payload = acceptMongoBuilderRowDrag(event, 'projection')
        const targetRow = mongoBuilderRowElement(event.target)
        const targetRowId = targetRow?.dataset.mongoBuilderRowId

        if (!payload || !targetRowId) {
          return false
        }

        updateDraft({
          filterGroups,
          projectionFields: moveRow(
            draft.projectionFields,
            payload.rowId,
            targetRowId,
            rowDropPlacement(event, targetRow),
          ),
        })
        clearMongoBuilderRowDrag()
        return true
      }}
      onDropField={(field) =>
        updateDraft({
          filterGroups,
          projectionMode: draft.projectionMode === 'all' ? 'include' : draft.projectionMode,
          projectionFields: [...draft.projectionFields, { id: rowId('projection'), field }],
        })
      }
      onAdd={() =>
        updateDraft({
          filterGroups,
          projectionMode: draft.projectionMode === 'all' ? 'include' : draft.projectionMode,
          projectionFields: [...draft.projectionFields, { id: rowId('projection'), field: '' }],
        })
      }
    >
      {draft.projectionFields.length === 0 ? (
        <p className="query-builder-empty">All fields.</p>
      ) : null}
      {draft.projectionFields.map((field) => (
        <div
          className="query-builder-row query-builder-row--projection query-builder-row--draggable"
          data-mongo-builder-row-kind="projection"
          data-mongo-builder-row-id={field.id}
          key={field.id}
          onDragOverCapture={(event) => {
            if (acceptMongoBuilderRowDrag(event, 'projection')) {
              event.stopPropagation()
            }
          }}
          onDropCapture={(event) => {
            const payload = acceptMongoBuilderRowDrag(event, 'projection')

            if (!payload) {
              return
            }

            event.stopPropagation()
            updateDraft({
              filterGroups,
              projectionFields: moveRow(
                draft.projectionFields,
                payload.rowId,
                field.id,
                rowDropPlacement(event),
              ),
            })
            clearMongoBuilderRowDrag()
          }}
          onPointerUpCapture={(event) => {
            const payload = acceptMongoBuilderRowPointerDrop(event, 'projection')

            if (!payload) {
              return
            }

            const targetRow = mongoBuilderCompatibleRowElement(
              mongoBuilderPointerTarget(event),
              'projection',
            )
            const targetRowId = targetRow?.dataset.mongoBuilderRowId

            if (!targetRowId) {
              clearMongoBuilderRowDrag()
              return
            }

            event.stopPropagation()
            updateDraft({
              filterGroups,
              projectionFields: moveRow(
                draft.projectionFields,
                payload.rowId,
                targetRowId,
                rowPointerDropPlacement(event, targetRow),
              ),
            })
            clearMongoBuilderRowDrag()
          }}
        >
          <MongoBuilderDragHandle
            kind="projection"
            label={`Drag projection ${field.field || field.id}`}
            rowId={field.id}
          />
          <input
            aria-label="Projection field"
            placeholder="field"
            value={field.field}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                projectionFields: draft.projectionFields.map((item) =>
                  item.id === field.id ? { ...item, field: event.target.value } : item,
                ),
              })
            }
          />
          <select
            aria-label={`Projection mode ${field.field || field.id}`}
            value={draft.projectionMode === 'all' ? 'include' : draft.projectionMode}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                projectionMode: event.target.value as MongoFindBuilderState['projectionMode'],
              })
            }
          >
            <option value="include">Include</option>
            <option value="exclude">Exclude</option>
          </select>
          <button
            type="button"
            className="query-builder-remove query-builder-remove--icon"
            aria-label="Remove projection field"
            title="Remove projection field"
            onClick={() =>
              updateDraft({
                filterGroups,
                projectionFields: draft.projectionFields.filter((item) => item.id !== field.id),
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
  const moving = rows.find((row) => row.id === rowId)

  if (!moving || rowId === targetRowId) {
    return rows
  }

  const withoutMoving = rows.filter((row) => row.id !== rowId)
  const targetIndex = withoutMoving.findIndex((row) => row.id === targetRowId)

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
    'projection',
  )
}

function mongoBuilderCompatibleRowElement(target: HTMLElement | undefined, kind: string) {
  const row = target?.closest<HTMLElement>('[data-mongo-builder-row-id]')
  return row?.dataset.mongoBuilderRowKind === kind ? row : undefined
}
