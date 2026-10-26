import { useState } from 'react'

/** An empty edit is a draft, never an instruction to remove a query limit. */
export function QueryLimitInput({ value, minimum = 1, disabled, title, label = 'Query limit', className = 'toolbar-fetch-size', onChange }: {
  value: number | null
  minimum?: number
  disabled?: boolean
  title?: string
  label?: string
  className?: string
  onChange(value: number): void
}) {
  const [draft, setDraft] = useState({ source: value, text: value === null ? '' : String(value) })
  const text = draft.source === value ? draft.text : value === null ? '' : String(value)
  const valid = /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) >= minimum
  return <label className={className} title={title}>
    <span>{label}</span>
    <input aria-label={label} aria-invalid={text !== '' && !valid} type="number" min={minimum} step={1}
      disabled={disabled} value={text} placeholder={value === null ? 'No limit' : undefined}
      onChange={event => {
        const text = event.target.value
        setDraft({ source: value, text })
        const next = Number(text)
        if (/^\d+$/.test(text) && Number.isSafeInteger(next) && next >= minimum) onChange(next)
      }}
      onBlur={() => setDraft({ source: value, text: value === null ? '' : String(value) })}
      onKeyDown={event => {
        if (event.key === 'Escape' || (event.key === 'Enter' && !event.ctrlKey && !event.metaKey)) {
          event.preventDefault(); event.stopPropagation(); event.currentTarget.blur()
        }
      }} />
  </label>
}
