import { useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import {
  coerceValue,
  editableValue,
  parseEditedValue,
  type DocumentGridRow,
  type DocumentValueType,
} from './document-grid-model'
import { writeFieldDragData } from './field-drag'

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
  const writeRowDragData = (event: DragEvent<HTMLElement>) => {
    event.stopPropagation()
    writeFieldDragData(event, row.fieldPath, {
      value: draggedValue,
      valueLabel: draggedValueLabel,
      valueType: draggedValueType,
    })
  }

  const handleTypeKeyDown = (event: KeyboardEvent<HTMLSelectElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onStopEditing()
    }
  }

  return (
    <div
      className={`document-data-grid-row${matched ? ' is-search-match' : ''}`}
      role="row"
      aria-level={row.depth + 1}
      aria-expanded={row.expandable ? expanded : undefined}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(row, event.clientX, event.clientY)
      }}
    >
      <div
        className="document-data-grid-cell document-data-grid-cell--id"
        role="gridcell"
        draggable={Boolean(row.fieldPath) && !editingField}
        style={{ paddingLeft: 8 + row.depth * 18 }}
        title={row.fieldPath ? `Drag ${row.fieldPath} to the query builder` : row.label}
        onDragStart={writeRowDragData}
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
            draggable={Boolean(row.fieldPath)}
            data-field-path={row.fieldPath || undefined}
            title={row.fieldPath ? `Drag ${row.fieldPath} to the query builder` : row.label}
            onDragStart={writeRowDragData}
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
            draggable={Boolean(row.fieldPath)}
            title={
              row.fieldPath
                ? `Drag ${row.fieldPath} with value ${draggedValueLabel} to the query builder`
                : 'Copy value'
            }
            onClick={() => onScheduleCopyValue(row.value)}
            onDragStart={writeRowDragData}
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
