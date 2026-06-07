interface KeyValueAddPanelProps {
  duplicate: boolean
  keyName: string
  value: string
  onCancel(): void
  onInsert(): void
  onKeyNameChange(value: string): void
  onValueChange(value: string): void
}

export function KeyValueAddPanel({
  duplicate,
  keyName,
  value,
  onCancel,
  onInsert,
  onKeyNameChange,
  onValueChange,
}: KeyValueAddPanelProps) {
  const disabled = keyName.trim().length === 0 || duplicate

  return (
    <div className="keyvalue-edit-panel">
      <div>
        <strong>Add key</strong>
        <span>{duplicate ? 'Key already exists.' : 'Create a string or JSON value.'}</span>
      </div>
      <input
        aria-label="New key name"
        value={keyName}
        onChange={(event) => onKeyNameChange(event.target.value)}
      />
      <input
        aria-label="New key value"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <button type="button" className="drawer-button" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        className="drawer-button drawer-button--primary"
        disabled={disabled}
        onClick={onInsert}
      >
        Add Key
      </button>
    </div>
  )
}

interface KeyValueTtlPanelProps {
  keyName: string
  seconds: string
  onCancel(): void
  onSecondsChange(value: string): void
  onSetTtl(): void
}

export function KeyValueTtlPanel({
  keyName,
  seconds,
  onCancel,
  onSecondsChange,
  onSetTtl,
}: KeyValueTtlPanelProps) {
  return (
    <div className="data-grid-confirmation">
      <div>
        <strong>Set TTL for {keyName}</strong>
        <span>Use positive seconds. Existing value is preserved.</span>
      </div>
      <input
        aria-label="TTL seconds"
        type="number"
        min={1}
        value={seconds}
        onChange={(event) => onSecondsChange(event.target.value)}
      />
      <button type="button" className="drawer-button" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        className="drawer-button drawer-button--primary"
        disabled={Number(seconds) <= 0}
        onClick={onSetTtl}
      >
        Set TTL
      </button>
    </div>
  )
}

interface KeyValueRenamePanelProps {
  duplicate: boolean
  keyName: string
  nextKeyName: string
  onCancel(): void
  onRename(): void
  onNextKeyNameChange(value: string): void
}

export function KeyValueRenamePanel({
  duplicate,
  keyName,
  nextKeyName,
  onCancel,
  onRename,
  onNextKeyNameChange,
}: KeyValueRenamePanelProps) {
  const trimmed = nextKeyName.trim()
  const disabled = trimmed.length === 0 || trimmed === keyName || duplicate

  return (
    <div className="data-grid-confirmation">
      <div>
        <strong>Rename {keyName}</strong>
        <span>{duplicate ? 'A key with that name already exists in the loaded result.' : 'Keep the value and TTL with a new key name.'}</span>
      </div>
      <input
        aria-label="New key name"
        value={nextKeyName}
        onChange={(event) => onNextKeyNameChange(event.target.value)}
      />
      <button type="button" className="drawer-button" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        className="drawer-button drawer-button--primary"
        disabled={disabled}
        onClick={onRename}
      >
        Rename
      </button>
    </div>
  )
}

interface KeyValueJsonPathPanelProps {
  keyName: string
  path: string
  value: string
  error?: string
  onCancel(): void
  onSetPath(): void
  onValueChange(value: string): void
}

export function KeyValueJsonPathPanel({
  keyName,
  path,
  value,
  error,
  onCancel,
  onSetPath,
  onValueChange,
}: KeyValueJsonPathPanelProps) {
  return (
    <div className="data-grid-confirmation">
      <div>
        <strong>Set {path}</strong>
        <span>{error ?? keyName}</span>
      </div>
      <textarea
        aria-label={`JSON value for ${path}`}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <button type="button" className="drawer-button" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        className="drawer-button drawer-button--primary"
        disabled={value.trim().length === 0 || Boolean(error)}
        onClick={onSetPath}
      >
        Set Path
      </button>
    </div>
  )
}
