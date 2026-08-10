import { useEffect, useMemo, useState } from 'react'
import { DesktopCodeEditor } from '../DesktopCodeEditor'

interface QueryBuilderJsonValueDialogProps {
  ariaLabel: string
  theme: string
  value: string
  onApply(value: string): void
  onClose(): void
}

export function QueryBuilderJsonValueDialog({
  ariaLabel,
  theme,
  value,
  onApply,
  onClose,
}: QueryBuilderJsonValueDialogProps) {
  const initialDraft = useMemo(() => prettyJson(value), [value])
  const [draft, setDraft] = useState(initialDraft)
  const [validatedDraft, setValidatedDraft] = useState<string>()
  const [validationError, setValidationError] = useState<string>()
  const canApply = validatedDraft === draft && !validationError

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const validate = () => {
    try {
      JSON.parse(draft)
      setValidatedDraft(draft)
      setValidationError(undefined)
    } catch (error) {
      setValidatedDraft(draft)
      setValidationError(error instanceof Error ? error.message : 'JSON is invalid.')
    }
  }

  const apply = () => {
    if (!canApply) return
    onApply(JSON.stringify(JSON.parse(draft) as unknown))
  }

  return (
    <div className="workbench-modal-overlay query-builder-json-overlay" role="presentation">
      <section className="workbench-dialog query-builder-json-dialog" role="dialog" aria-modal="true" aria-label={`${ariaLabel} dialog`}>
        <header>
          <div>
            <h2>Edit JSON value</h2>
            <p>Format and validate the bound value before applying it to the query.</p>
          </div>
          <button type="button" className="bottom-panel-icon-button" aria-label="Close JSON editor" onClick={onClose}>x</button>
        </header>
        <div className="query-builder-json-editor">
          <DesktopCodeEditor
            ariaLabel={ariaLabel}
            language="json"
            resetKey={ariaLabel}
            theme={theme}
            value={draft}
            onChange={(nextValue) => {
              setDraft(nextValue)
              setValidatedDraft(undefined)
              setValidationError(undefined)
            }}
          />
        </div>
        {validationError ? <p className="query-builder-value-error" role="alert">{validationError}</p> : null}
        {canApply ? <p className="query-builder-value-valid" role="status">JSON passed validation.</p> : null}
        <footer className="workbench-dialog-actions">
          <button type="button" className="drawer-button" onClick={validate}>Validate JSON</button>
          <button type="button" className="drawer-button drawer-button--primary" disabled={!canApply} onClick={apply}>Apply</button>
          <button type="button" className="drawer-button" onClick={onClose}>Cancel</button>
        </footer>
      </section>
    </div>
  )
}

function prettyJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2)
  } catch {
    return value
  }
}
