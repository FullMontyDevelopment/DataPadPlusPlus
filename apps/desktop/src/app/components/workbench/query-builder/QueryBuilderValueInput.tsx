import { useState } from 'react'
import type { QueryBuilderValueType } from './query-value-codec'
import {
  dateTimeLocalToUtcIso,
  queryBuilderOperatorArity,
  utcIsoToDateTimeLocal,
  validateQueryBuilderValue,
} from './query-value-codec'
import { CalendarIcon } from '../icons'
import { QueryBuilderIconButton } from './QueryBuilderIconButton'
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
  const validationKey = `${operator}\u0000${valueType}`
  const [validationState, setValidationState] = useState(() => ({
    key: validationKey,
    visible: false,
  }))

  if (validationState.key !== validationKey) {
    setValidationState({ key: validationKey, visible: false })
  }

  if (arity === 'none' || valueType === 'null') return null

  const error = validationState.key === validationKey && validationState.visible && !validation.ok
    ? validation.error
    : undefined
  const revealValidation = () => setValidationState({ key: validationKey, visible: true })
  const commonProps = {
    'aria-invalid': Boolean(error) || undefined,
    'aria-label': ariaLabel,
    disabled,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    onBlur: revealValidation,
  }

  return (
    <div className={`query-builder-typed-value is-${arity}${error ? ' has-error' : ''}`}>
      {valueType === 'boolean' ? (
        <select
          aria-label={ariaLabel}
          disabled={disabled}
          value={value.trim().toLowerCase() === 'true' ? 'true' : value.trim().toLowerCase() === 'false' ? 'false' : ''}
          onChange={(event) => onChange(event.target.value)}
          onBlur={revealValidation}
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
        <label className="query-builder-date-picker" title={`${ariaLabel} date picker`}>
          <CalendarIcon className="query-builder-date-picker__icon" />
          <input
            aria-label={`${ariaLabel} date picker`}
            className="query-builder-date-picker__input"
            disabled={disabled}
            type="datetime-local"
            value={dateTimeLocalValue(value)}
            onBlur={revealValidation}
            onChange={(event) => {
              if (event.target.value) onChange(dateTimeLocalToUtcIso(event.target.value))
            }}
          />
        </label>
      ) : null}
      {valueType === 'json' ? (
        <QueryBuilderIconButton
          action="json"
          label="Open JSON editor"
          disabled={disabled}
          onClick={() => setJsonEditorOpen(true)}
        />
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
