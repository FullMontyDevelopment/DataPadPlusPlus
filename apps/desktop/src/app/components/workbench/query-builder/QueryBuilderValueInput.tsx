import { useState } from 'react'
import type { QueryBuilderValueType } from './query-value-codec'
import {
  dateTimeLocalToUtcIso,
  queryBuilderOperatorArity,
  utcIsoToDateTimeLocal,
  validateQueryBuilderValue,
} from './query-value-codec'
import { QueryBuilderJsonValueDialog } from './QueryBuilderJsonValueDialog'

interface QueryBuilderValueInputProps {
  ariaLabel: string
  operator?: string
  theme: string
  value: string
  valueType: QueryBuilderValueType
  disabled?: boolean
  onChange(value: string): void
}

export function QueryBuilderValueInput({
  ariaLabel,
  operator = '',
  theme,
  value,
  valueType,
  disabled = false,
  onChange,
}: QueryBuilderValueInputProps) {
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false)
  const arity = queryBuilderOperatorArity(operator)
  const validation = validateQueryBuilderValue(value, valueType, { operator })

  if (arity === 'none' || valueType === 'null') return null

  const error = validation.ok ? undefined : validation.error
  const commonProps = {
    'aria-invalid': Boolean(error) || undefined,
    'aria-label': ariaLabel,
    disabled,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
  }

  return (
    <div className={`query-builder-typed-value is-${arity}${error ? ' has-error' : ''}`}>
      {valueType === 'boolean' ? (
        <select
          aria-label={ariaLabel}
          disabled={disabled}
          value={value.trim().toLowerCase() === 'true' ? 'true' : value.trim().toLowerCase() === 'false' ? 'false' : ''}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" disabled>Select…</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      ) : (
        <input
          {...commonProps}
          inputMode={arity === 'length' ? 'numeric' : valueType === 'number' ? 'decimal' : undefined}
          placeholder={placeholderForValue(valueType, arity)}
          type="text"
        />
      )}
      {valueType === 'date' && arity === 'single' ? (
        <input
          aria-label={`${ariaLabel} date picker`}
          className="query-builder-date-picker"
          disabled={disabled}
          type="datetime-local"
          value={dateTimeLocalValue(value)}
          onChange={(event) => {
            if (event.target.value) onChange(dateTimeLocalToUtcIso(event.target.value))
          }}
        />
      ) : null}
      {valueType === 'json' ? (
        <button
          type="button"
          className="query-builder-json-open"
          disabled={disabled}
          onClick={() => setJsonEditorOpen(true)}
        >
          Open JSON editor
        </button>
      ) : null}
      {error ? <span className="query-builder-value-error" role="alert">{error}</span> : null}
      {jsonEditorOpen ? (
        <QueryBuilderJsonValueDialog
          ariaLabel={`${ariaLabel} JSON editor`}
          theme={theme}
          value={value}
          onApply={(nextValue) => {
            onChange(nextValue)
            setJsonEditorOpen(false)
          }}
          onClose={() => setJsonEditorOpen(false)}
        />
      ) : null}
    </div>
  )
}

function placeholderForValue(valueType: QueryBuilderValueType, arity: ReturnType<typeof queryBuilderOperatorArity>) {
  if (arity === 'length') return '0'
  if (arity === 'list') return valueType === 'json' ? '["one", "two"]' : 'one, two'
  if (valueType === 'date') return '2026-08-09T12:00:00Z'
  if (valueType === 'uuid') return '00000000-0000-4000-8000-000000000000'
  if (valueType === 'objectId') return '24 hexadecimal characters'
  if (valueType === 'json') return '{"key":"value"}'
  return 'value'
}

function dateTimeLocalValue(value: string) {
  try {
    return utcIsoToDateTimeLocal(value)
  } catch {
    return ''
  }
}
