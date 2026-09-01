import { valueTypeName } from './keyvalue-edit-requests'
import type { KeyValueResultRow } from './keyvalue-results-helpers'
import { copyText } from './payload-export'

interface KeyValueEntryRowsProps {
  canEdit: boolean
  canEditValues?: boolean
  editingKey?: string
  editingValue: string
  rows: KeyValueResultRow[]
  onBeginValueEdit(keyName: string, rawValue: string): void
  onCancelEdit(): void
  onCommitValueEdit(): void
  onOpenContextMenu(
    keyName: string,
    x: number,
    y: number,
    originElement: HTMLElement,
  ): void
  onViewValue(keyName: string): void
  onUpdateEditingValue(value: string): void
}

export function KeyValueEntryRows({
  canEdit,
  canEditValues = canEdit,
  editingKey,
  editingValue,
  rows,
  onBeginValueEdit,
  onCancelEdit,
  onCommitValueEdit,
  onOpenContextMenu,
  onViewValue,
  onUpdateEditingValue,
}: KeyValueEntryRowsProps) {
  return (
    <>
      {rows.map(({ keyName, parsedValue, rawValue }) => {
        const valueType = valueTypeName(parsedValue)
        return (
          <div
            key={keyName}
            className="keyvalue-result-entry"
            tabIndex={-1}
            onContextMenu={(event) => {
              event.preventDefault()
              onOpenContextMenu(
                keyName,
                event.clientX,
                event.clientY,
                event.currentTarget,
              )
            }}
          >
            <div className="keyvalue-result-row" role="row">
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
                  title={canEditValues
                    ? 'Click to inspect the full value; double-click to edit it'
                    : 'Click to inspect the full value'}
                  onClick={() => onViewValue(keyName)}
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
