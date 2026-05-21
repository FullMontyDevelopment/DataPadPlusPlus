import { useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import {
  coerceValue,
  editableValue,
  parseEditedValue,
  type DocumentGridRow,
  type DocumentValueType,
} from './document-grid-model'
import {
  beginFieldPointerDrag,
  cancelFieldPointerDrag,
  dropFieldPointerDrag,
  moveFieldPointerDrag,
  type FieldDragPayload,
} from './field-drag'

const TYPE_OPTIONS: DocumentValueType[] = ['string', 'number', 'boolean', 'null', 'object', 'array']

interface DocumentGridRowViewProps {
  editingCell?: 'field' | 'type' | 'value'
  expanded: boolean
  matched?: boolean
  row: DocumentGridRow
  onBeginEditing(row: DocumentGridRow, cell: 'field' | 'type' | 'value'): void
  onCancelScheduledCopy(): void
  onContextMenu(row: DocumentGridRow, x: number, y: number): void
  onRenameField(row: DocumentGridRow, nextName: string): void
  onScheduleCopyValue(value: unknown): void
  onStopEditing(): void
  onToggleRow(rowId: string): void
  onUpdateValue(row: DocumentGridRow, nextValue: unknown, editKind?: 'set-field' | 'change-field-type'): void
}

export function DocumentGridRowView({
  editingCell,
  expanded,
  matched = false,
  row,
  onBeginEditing,
  onCancelScheduledCopy,
  onContextMenu,
  onRenameField,
  onScheduleCopyValue,
  onStopEditing,
  onToggleRow,
  onUpdateValue,
}: DocumentGridRowViewProps) {
  const editingField = editingCell === 'field'
  const editingType = editingCell === 'type'
  const editingValue = editingCell === 'value'
  const draggedValue = draggableRowValue(row)
  const draggedValueType = documentDragValueType(draggedValue, row.type)
  const draggedValueLabel = String(row.path.length === 0 ? row.label : row.valueLabel)
  const fieldDragPayload: FieldDragPayload = {
    fieldPath: row.fieldPath,
    value: draggedValue,
    valueLabel: draggedValueLabel,
    valueType: draggedValueType,
  }

  const handleTypeKeyDown = (event: KeyboardEvent<HTMLSelectElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onStopEditing()
    }
  }

  return (
    <div
      role="row"
      aria-level={row.depth + 1}
      aria-expanded={row.expandable ? expanded : undefined}
      className={`document-data-grid-row${matched ? ' is-search-match' : ''}${
        row.fieldPath && !editingField && !editingType && !editingValue
          ? ' is-field-draggable'
          : ''
      }`}
      onPointerDown={(event) => {
        if (!editingField && !editingType && !editingValue) {
          startDocumentFieldPointerDrag(event, fieldDragPayload)
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(row, event.clientX, event.clientY)
      }}
    >
      <div
        className="document-data-grid-cell document-data-grid-cell--id"
        role="gridcell"
        style={{ paddingLeft: 8 + row.depth * 18 }}
        title={row.fieldPath ? `Drag ${row.fieldPath} to the query builder` : row.label}
      >
        {row.expandable ? (
          <button
            type="button"
            className="document-data-grid-expander"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.label}`}
            onClick={() => onToggleRow(row.id)}
          >
            {expanded ? 'v' : '>'}
          </button>
        ) : (
          <span className="document-data-grid-spacer" />
        )}
        {editingField ? (
          <FieldNameEditor
            row={row}
            onRenameField={onRenameField}
            onStopEditing={onStopEditing}
          />
        ) : (
          <span
            className="document-data-grid-field"
            data-field-path={row.fieldPath || undefined}
            title={row.fieldPath ? `Drag ${row.fieldPath} to the query builder` : row.label}
            onDoubleClick={() => onBeginEditing(row, 'field')}
          >
            {row.label}
          </span>
        )}
      </div>
      <div className="document-data-grid-cell document-data-grid-cell--type" role="gridcell">
        {editingType ? (
          <select
            className={`document-type-badge is-${row.type}`}
            aria-label={`Change type ${row.fieldPath}`}
            value={row.type}
            autoFocus
            onBlur={onStopEditing}
            onChange={(event) => {
              onUpdateValue(
                row,
                coerceValue(row.value, event.target.value as DocumentValueType),
                'change-field-type',
              )
              onStopEditing()
            }}
            onKeyDown={handleTypeKeyDown}
          >
            {TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        ) : (
          <span
            className={`document-type-badge is-${row.type}`}
            onDoubleClick={() => onBeginEditing(row, 'type')}
          >
            {row.type}
          </span>
        )}
      </div>
      <div className="document-data-grid-cell document-data-grid-cell--value" role="gridcell">
        {editingValue ? (
          <FieldValueEditor
            row={row}
            onStopEditing={onStopEditing}
            onUpdateValue={onUpdateValue}
          />
        ) : (
          <button
            type="button"
            className="document-data-grid-value"
            title={
              row.fieldPath
                ? `Drag ${row.fieldPath} with value ${draggedValueLabel} to the query builder`
                : 'Copy value'
            }
            onClick={() => onScheduleCopyValue(row.value)}
            onDoubleClick={() => {
              onCancelScheduledCopy()
              onBeginEditing(row, 'value')
            }}
          >
            {row.valueLabel}
          </button>
        )}
      </div>
    </div>
  )
}

const POINTER_DRAG_THRESHOLD_PX = 4

function startDocumentFieldPointerDrag(
  event: PointerEvent<HTMLElement>,
  payload: FieldDragPayload,
) {
  if (!payload.fieldPath || event.button !== 0 || shouldIgnorePointerDrag(event.target)) {
    return
  }

  const pointerId = event.pointerId
  const startX = event.clientX
  const startY = event.clientY
  let dragging = false

  const removeListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('pointercancel', handlePointerCancel)
  }

  const handlePointerMove = (nextEvent: globalThis.PointerEvent) => {
    if (nextEvent.pointerId !== pointerId) {
      return
    }

    const movedX = nextEvent.clientX - startX
    const movedY = nextEvent.clientY - startY

    if (!dragging && Math.hypot(movedX, movedY) < POINTER_DRAG_THRESHOLD_PX) {
      return
    }

    if (!dragging) {
      dragging = true
      beginFieldPointerDrag(payload)
    }

    nextEvent.preventDefault()
    moveFieldPointerDrag(nextEvent.clientX, nextEvent.clientY)
  }

  const handlePointerUp = (nextEvent: globalThis.PointerEvent) => {
    if (nextEvent.pointerId !== pointerId) {
      return
    }

    removeListeners()

    if (dragging) {
      nextEvent.preventDefault()
      dropFieldPointerDrag(nextEvent.clientX, nextEvent.clientY)
    }
  }

  const handlePointerCancel = (nextEvent: globalThis.PointerEvent) => {
    if (nextEvent.pointerId !== pointerId) {
      return
    }

    removeListeners()
    cancelFieldPointerDrag()
  }

  window.addEventListener('pointermove', handlePointerMove, { passive: false })
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerCancel)
}

function shouldIgnorePointerDrag(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, select, textarea'))
}

function draggableRowValue(row: DocumentGridRow) {
  if (
    row.path.length === 0 &&
    row.fieldPath === '_id' &&
    row.value &&
    typeof row.value === 'object' &&
    Object.hasOwn(row.value, '_id')
  ) {
    return (row.value as Record<string, unknown>)._id
  }

  return row.value
}

function documentDragValueType(value: unknown, fallbackType: DocumentValueType) {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  if (typeof value === 'object') {
    return 'object'
  }

  return fallbackType
}

function FieldNameEditor({
  row,
  onRenameField,
  onStopEditing,
}: {
  row: DocumentGridRow
  onRenameField(row: DocumentGridRow, nextName: string): void
  onStopEditing(): void
}) {
  const [fieldDraft, setFieldDraft] = useState(row.label)

  const commit = () => {
    const nextName = fieldDraft.trim()

    if (nextName && nextName !== row.label) {
      onRenameField(row, nextName)
    }

    onStopEditing()
  }

  return (
    <input
      className="document-data-grid-field-input"
      aria-label={`Rename field ${row.label}`}
      value={fieldDraft}
      autoFocus
      onBlur={commit}
      onChange={(event) => setFieldDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => handleDraftEditorKeyDown(event, commit, onStopEditing)}
    />
  )
}

function FieldValueEditor({
  row,
  onStopEditing,
  onUpdateValue,
}: {
  row: DocumentGridRow
  onStopEditing(): void
  onUpdateValue(
    row: DocumentGridRow,
    nextValue: unknown,
    editKind?: 'set-field' | 'change-field-type',
  ): void
}) {
  const [valueDraft, setValueDraft] = useState(editableValue(row.value))

  const commit = () => {
    onUpdateValue(row, parseEditedValue(valueDraft, row.type), 'set-field')
    onStopEditing()
  }

  return (
    <input
      className="document-data-grid-value-input"
      aria-label={`Edit value ${row.fieldPath}`}
      value={valueDraft}
      autoFocus
      onBlur={commit}
      onChange={(event) => setValueDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => handleDraftEditorKeyDown(event, commit, onStopEditing)}
    />
  )
}

function handleDraftEditorKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  commit: () => void,
  cancel: () => void,
) {
  if (event.key === 'Enter') {
    event.preventDefault()
    commit()
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  }
}
