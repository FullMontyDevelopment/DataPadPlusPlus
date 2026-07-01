import { useState } from 'react'
import { ObjectFolderIcon } from './icons'

interface LibraryTextInputDialogProps {
  body: string
  confirmLabel: string
  initialValue?: string
  inputLabel: string
  placeholder?: string
  title: string
  validate?(value: string): string | undefined
  onCancel(): void
  onConfirm(value: string): void
}

export function LibraryTextInputDialog({
  body,
  confirmLabel,
  initialValue = '',
  inputLabel,
  placeholder,
  title,
  validate,
  onCancel,
  onConfirm,
}: LibraryTextInputDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string>()

  const submit = () => {
    const nextError = validate?.(value)
    if (nextError) {
      setError(nextError)
      return
    }

    onConfirm(value)
  }

  return (
    <div className="workbench-modal-overlay" role="presentation">
      <form
        className="workbench-dialog library-text-input-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-input-dialog-title"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="library-text-input-dialog-header">
          <span className="library-text-input-dialog-icon" aria-hidden="true">
            <ObjectFolderIcon className="panel-inline-icon" />
          </span>
          <div className="library-text-input-dialog-heading">
            <p className="sidebar-eyebrow">Library</p>
            <h2 id="library-input-dialog-title">{title}</h2>
          </div>
        </div>
        <p className="library-text-input-dialog-copy">{body}</p>
        <label className="library-text-input-dialog-field">
          <span>{inputLabel}</span>
          <input
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(event) => {
              setError(undefined)
              setValue(event.target.value)
            }}
          />
        </label>
        {error ? <p className="form-error library-text-input-dialog-error">{error}</p> : null}
        <div className="library-text-input-dialog-actions">
          <button type="button" className="drawer-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="drawer-button drawer-button--primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
