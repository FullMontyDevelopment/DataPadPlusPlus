import type { DataEditKind } from '@datapadplusplus/shared-types'

export interface DocumentEditProgressState {
  kind: DataEditKind
  phase: 'executing' | 'confirming'
  rowId: string
}

const actionLabels: Partial<Record<DataEditKind, string>> = {
  'rename-field': 'Renaming…',
  'unset-field': 'Removing…',
  'add-field': 'Adding…',
  'change-field-type': 'Saving…',
  'update-document': 'Saving…',
  'delete-document': 'Deleting…',
}

export function DocumentEditProgress({
  edit,
  onCancelLoading,
}: {
  edit?: DocumentEditProgressState
  onCancelLoading?: () => void
}) {
  const confirming = edit?.phase === 'confirming'
  const label = !edit ? 'Loading…'
    : confirming ? 'Confirm…'
      : actionLabels[edit.kind] ?? 'Saving…'

  return (
    <span className="document-edit-progress">
      <span className={`document-edit-progress-spinner${confirming ? ' is-paused' : ''}`} aria-hidden="true" />
      <span role="status" aria-live="polite">{label}</span>
      {!edit && onCancelLoading ? (
        <button type="button" className="document-edit-progress-cancel" title="Cancel loading" aria-label="Cancel loading" onClick={onCancelLoading}>×</button>
      ) : null}
    </span>
  )
}
