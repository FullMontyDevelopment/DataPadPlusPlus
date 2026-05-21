interface DataGridDeleteConfirmationProps {
  expectedText: string
  rowNumber: number
  onCancel(): void
  onConfirm(): void
}

export function DataGridDeleteConfirmation({
  expectedText,
  rowNumber,
  onCancel,
  onConfirm,
}: DataGridDeleteConfirmationProps) {
  return (
    <div className="data-grid-confirmation" role="dialog" aria-label="Confirm row delete">
      <div>
        <strong>Delete row {rowNumber}?</strong>
        <span>DataPad++ will run this guarded delete with confirmation.</span>
      </div>
      <button type="button" className="drawer-button" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        className="drawer-button drawer-button--danger"
        title={`Uses ${expectedText}`}
        onClick={onConfirm}
      >
        Delete
      </button>
    </div>
  )
}
