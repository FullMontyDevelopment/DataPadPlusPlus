import { JsonTreeView } from './JsonTreeView'
import { valueTypeName } from './keyvalue-edit-requests'
import type { KeyValueResultRow } from './keyvalue-results-helpers'
import { copyText } from './payload-export'

interface KeyValueEntryRowsProps {
  canEdit: boolean
  editingKey?: string
  editingValue: string
  expandedKeys: Set<string>
  rows: KeyValueResultRow[]
  onBeginValueEdit(keyName: string, rawValue: string): void
  onCancelEdit(): void
  onCommitValueEdit(): void
  onOpenContextMenu(keyName: string, x: number, y: number): void
  onToggleExpanded(keyName: string): void
  onUpdateEditingValue(value: string): void
}

export function KeyValueEntryRows({
  canEdit,
  editingKey,
  editingValue,
  expandedKeys,
  rows,
  onBeginValueEdit,
  onCancelEdit,
  onCommitValueEdit,
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
                  className={`keyvalue-value${canEdit ? ' is-editable' : ''}`}
                  title={canEdit ? 'Double-click to edit value' : valuePreview(parsedValue)}
                  onClick={() => void copyText(rawValue)}
                  onDoubleClick={() => onBeginValueEdit(keyName, rawValue)}
                >
                  {valuePreview(parsedValue)}
                </button>
              )}
            </div>
            {expanded ? (
              <div className="keyvalue-result-detail">
                <JsonTreeView value={parsedValue} label={keyName} />
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
