import { useState } from 'react'

export function QueryBatchSizeControl({ value, inheritedValue, disabled, onChange }: {
  value?: number
  inheritedValue: number
  disabled: boolean
  onChange(value?: number): Promise<boolean>
}) {
  const [draft, setDraft] = useState(String(value ?? inheritedValue))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const commit = async (reset = false) => {
    const batch = reset ? undefined : Number(draft)
    if (!reset && (!/^\d+$/.test(draft) || !Number.isInteger(batch) || batch! < 1 || batch! > 5000)) {
      setError('Batch size must be from 1 to 5,000.')
      return
    }
    setError('')
    if (!reset && batch === (value ?? inheritedValue)) return
    setSaving(true)
    try {
      if (await onChange(batch)) setDraft(String(batch ?? inheritedValue))
      else setError('Batch size was not saved.')
    } catch {
      setError('Batch size was not saved. Try again.')
    } finally { setSaving(false) }
  }
  return (
    <div className="toolbar-group toolbar-group--query-results">
      <label className="toolbar-fetch-size" title="Rows per fetch. Changes apply on the next run, not to the current result.">
        <span>Batch size</span>
        <input aria-label="Fetch batch size" type="number" min={1} max={5000} step={1}
          value={draft} disabled={disabled || saving} aria-invalid={Boolean(error)}
          onChange={event => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
      </label>
      {value !== undefined ? <button type="button" disabled={disabled || saving}
        title={`Use workspace batch size (${inheritedValue})`} onClick={() => void commit(true)}>Default</button> : null}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  )
}
