interface DeleteConfirmationPanelProps {
  title: string
  body: string
  confirmLabel?: string
  danger?: boolean
  onCancel(): void
  onConfirm(): void
}

export function DeleteConfirmationPanel({
  title,
  body,
  confirmLabel = 'Delete',
  danger = true,
  onCancel,
  onConfirm,
}: DeleteConfirmationPanelProps) {
  return (
    <div className="data-grid-confirmation" role="dialog" aria-label={title}>
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      <button type="button" className="drawer-button" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        className={`drawer-button ${danger ? 'drawer-button--danger' : 'drawer-button--primary'}`}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </div>
  )
}
