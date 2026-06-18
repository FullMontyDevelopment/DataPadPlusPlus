import type { DragEvent, PointerEvent } from 'react'
import { DragHandleIcon } from '../../icons'

export type MongoBuilderRowDragKind = 'filter' | 'projection' | 'sort' | 'stage'

export interface MongoBuilderRowDragPayload {
  kind: MongoBuilderRowDragKind
  rowId: string
  groupId?: string
}

export const MONGO_BUILDER_ROW_DRAG_MIME = 'application/x-datapadplusplus-mongo-builder-row'
let activeMongoBuilderRowDragPayload: MongoBuilderRowDragPayload | undefined

interface MongoBuilderDragHandleProps {
  groupId?: string
  kind: MongoBuilderRowDragKind
  label: string
  rowId: string
}

export function MongoBuilderDragHandle({
  groupId,
  kind,
  label,
  rowId,
}: MongoBuilderDragHandleProps) {
  return (
    <button
      type="button"
      className="query-builder-drag-handle"
      aria-label={label}
      data-mongo-builder-drag-group-id={groupId}
      data-mongo-builder-drag-kind={kind}
      data-mongo-builder-drag-row-id={rowId}
      title="Drag to reorder"
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return
        }

        event.preventDefault()
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Pointer capture is a convenience; target resolution still uses elementFromPoint.
        }
        beginMongoBuilderRowDrag({
          groupId,
          kind,
          rowId,
        })
      }}
      onPointerMove={(event) => {
        updateMongoBuilderRowDragVisuals(event, kind)
      }}
      onPointerUp={(event) => {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          // The browser may already have released capture after the drop.
        }
        clearMongoBuilderRowDrag()
      }}
      onPointerCancel={clearMongoBuilderRowDrag}
    >
      <DragHandleIcon className="toolbar-icon" />
    </button>
  )
}

export function acceptMongoBuilderRowDrag(
  event: DragEvent<HTMLElement>,
  kind: MongoBuilderRowDragKind,
) {
  const payload = activeMongoBuilderRowDragPayload?.kind === kind
    ? activeMongoBuilderRowDragPayload
    : readMongoBuilderRowDrag(event)

  if (!payload || payload.kind !== kind) {
    return undefined
  }

  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  return payload
}

export function acceptMongoBuilderRowPointerDrop(
  event: PointerEvent<HTMLElement>,
  kind: MongoBuilderRowDragKind,
) {
  const payload = activeMongoBuilderRowDragPayload

  if (!payload || payload.kind !== kind) {
    return undefined
  }

  event.preventDefault()
  return payload
}

export function mongoBuilderPointerTarget(event: PointerEvent<HTMLElement>) {
  const target = typeof document.elementFromPoint === 'function'
    ? document.elementFromPoint(event.clientX, event.clientY)
    : undefined

  if (target instanceof HTMLElement) {
    return target
  }

  return event.target instanceof HTMLElement ? event.target : undefined
}

export function readMongoBuilderRowDrag(event: DragEvent<HTMLElement>) {
  const raw = event.dataTransfer.getData(MONGO_BUILDER_ROW_DRAG_MIME)

  if (!raw) {
    return activeMongoBuilderRowDragPayload
  }

  try {
    const parsed = JSON.parse(raw) as Partial<MongoBuilderRowDragPayload>

    if (!isMongoBuilderRowDragKind(parsed.kind) || typeof parsed.rowId !== 'string') {
      return activeMongoBuilderRowDragPayload
    }

    return {
      kind: parsed.kind,
      rowId: parsed.rowId,
      groupId: typeof parsed.groupId === 'string' ? parsed.groupId : undefined,
    } satisfies MongoBuilderRowDragPayload
  } catch {
    return activeMongoBuilderRowDragPayload
  }
}

export function clearMongoBuilderRowDrag() {
  activeMongoBuilderRowDragPayload = undefined
  clearMongoBuilderRowDragVisuals()
}

export function beginMongoBuilderRowDrag(payload: MongoBuilderRowDragPayload) {
  clearMongoBuilderRowDragVisuals()
  activeMongoBuilderRowDragPayload = payload
  document.body.classList.add('is-mongo-builder-row-dragging')
  activeMongoBuilderRowElement(payload)?.classList.add('is-row-dragging')
}

export function updateMongoBuilderRowDragVisuals(
  event: PointerEvent<HTMLElement>,
  kind: MongoBuilderRowDragKind,
) {
  const payload = activeMongoBuilderRowDragPayload

  if (!payload || payload.kind !== kind) {
    return
  }

  clearMongoBuilderRowDropVisuals()
  activeMongoBuilderRowElement(payload)?.classList.add('is-row-dragging')

  const target = mongoBuilderPointerTarget(event)
  const row = target?.closest<HTMLElement>('[data-mongo-builder-row-id]')

  if (row && row.dataset.mongoBuilderRowKind !== kind) {
    row.classList.add('is-row-drop-incompatible')
    return
  }

  if (row) {
    if (row.dataset.mongoBuilderRowId === payload.rowId) {
      return
    }

    row.classList.add('is-row-drop-target', rowDropVisualPlacement(event, row))
    return
  }

  if (kind !== 'filter') {
    return
  }

  const group = target?.closest<HTMLElement>('[data-mongo-builder-group-id]')
  const root = target?.closest<HTMLElement>('[data-mongo-builder-filter-root]')
  const container = group ?? root

  if (container) {
    container.classList.add('is-row-drop-target')
  }
}

function clearMongoBuilderRowDragVisuals() {
  document.body.classList.remove('is-mongo-builder-row-dragging')
  document
    .querySelectorAll<HTMLElement>(
      [
        '.is-row-dragging',
        '.is-row-drop-target',
        '.is-row-drop-before',
        '.is-row-drop-after',
        '.is-row-drop-incompatible',
      ].join(','),
    )
    .forEach((element) => {
      element.classList.remove(
        'is-row-dragging',
        'is-row-drop-target',
        'is-row-drop-before',
        'is-row-drop-after',
        'is-row-drop-incompatible',
      )
    })
}

function clearMongoBuilderRowDropVisuals() {
  document
    .querySelectorAll<HTMLElement>(
      '.is-row-drop-target,.is-row-drop-before,.is-row-drop-after,.is-row-drop-incompatible',
    )
    .forEach((element) => {
      element.classList.remove(
        'is-row-drop-target',
        'is-row-drop-before',
        'is-row-drop-after',
        'is-row-drop-incompatible',
      )
    })
}

function activeMongoBuilderRowElement(payload: MongoBuilderRowDragPayload) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-mongo-builder-row-id]'))
    .find((row) =>
      row.dataset.mongoBuilderRowKind === payload.kind
      && row.dataset.mongoBuilderRowId === payload.rowId,
    )
}

function rowDropVisualPlacement(event: PointerEvent<HTMLElement>, row: HTMLElement) {
  const rect = row.getBoundingClientRect()
  return event.clientY > rect.top + rect.height / 2
    ? 'is-row-drop-after'
    : 'is-row-drop-before'
}

function isMongoBuilderRowDragKind(value: unknown): value is MongoBuilderRowDragKind {
  return value === 'filter' || value === 'projection' || value === 'sort' || value === 'stage'
}
