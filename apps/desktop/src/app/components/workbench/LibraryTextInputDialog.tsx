import { useState } from 'react'

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
        className="workbench-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-input-dialog-title"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <p className="sidebar-eyebrow">Library</p>
        <h2 id="library-input-dialog-title">{title}</h2>
        <p>{body}</p>
        <label className="drawer-field">
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
        {error ? <p className="form-error">{error}</p> : null}
        <div className="drawer-button-row">
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
