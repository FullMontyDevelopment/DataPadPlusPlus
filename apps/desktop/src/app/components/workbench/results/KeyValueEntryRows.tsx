import { JsonTreeView } from './JsonTreeView'
import { valueTypeName } from './keyvalue-edit-requests'
import type { KeyValueResultRow } from './keyvalue-results-helpers'
import { copyText } from './payload-export'

interface KeyValueEntryRowsProps {
  canEdit: boolean
  canEditValues?: boolean
  editingKey?: string
  editingValue: string
  expandedKeys: Set<string>
  rows: KeyValueResultRow[]
  onBeginValueEdit(keyName: string, rawValue: string): void
  onBeginJsonPathEdit?(path: string, value: unknown): void
  onCancelEdit(): void
  onCommitValueEdit(): void
  onDeleteJsonPath?(path: string, value: unknown): void
  onOpenContextMenu(keyName: string, x: number, y: number): void
  onToggleExpanded(keyName: string): void
  onUpdateEditingValue(value: string): void
}

export function KeyValueEntryRows({
  canEdit,
  canEditValues = canEdit,
  editingKey,
  editingValue,
  expandedKeys,
  rows,
  onBeginValueEdit,
  onBeginJsonPathEdit,
  onCancelEdit,
  onCommitValueEdit,
  onDeleteJsonPath,
  onOpenContextMenu,
  onToggleExpanded,
  onUpdateEditingValue,
}: KeyValueEntryRowsProps) {
  return (
    <>
      {rows.map(({ keyName, parsedValue, rawValue }) => {
        const expanded = expandedKeys.has(keyName)
        const valueType = valueTypeName(parsedValue)
        return (
          <div
            key={keyName}
            className="keyvalue-result-entry"
            onContextMenu={(event) => {
              event.preventDefault()
              onOpenContextMenu(keyName, event.clientX, event.clientY)
            }}
          >
            <div className="keyvalue-result-row" role="row">
              <button
                type="button"
                className="keyvalue-expand-button"
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${keyName}`}
                onClick={() => onToggleExpanded(keyName)}
              >
                {expanded ? 'v' : '>'}
              </button>
              <button
                type="button"
                className="keyvalue-key"
                title="Copy key"
                onClick={() => void copyText(keyName)}
              >
                {keyName}
              </button>
              <span className={`document-type-badge is-${valueType}`}>{valueType}</span>
              {editingKey === keyName ? (
                <input
                  className="keyvalue-value-input"
                  aria-label={`Edit value ${keyName}`}
                  value={editingValue}
                  autoFocus
                  onBlur={() => onCommitValueEdit()}
                  onChange={(event) => onUpdateEditingValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      onCommitValueEdit()
                    }

                    if (event.key === 'Escape') {
                      event.preventDefault()
                      onCancelEdit()
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={`keyvalue-value${canEditValues ? ' is-editable' : ''}`}
                  title={canEditValues ? 'Double-click to edit value' : valuePreview(parsedValue)}
                  onClick={() => void copyText(rawValue)}
                  onDoubleClick={() => {
                    if (canEditValues) {
                      onBeginValueEdit(keyName, rawValue)
                    }
                  }}
                >
                  {valuePreview(parsedValue)}
                </button>
              )}
            </div>
            {expanded ? (
              <div className="keyvalue-result-detail">
                <JsonTreeView
                  value={parsedValue}
                  label={keyName}
                  onDeleteValue={onDeleteJsonPath}
                  onEditValue={onBeginJsonPathEdit}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function valuePreview(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (value === null) {
    return 'null'
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return JSON.stringify(value)
}
