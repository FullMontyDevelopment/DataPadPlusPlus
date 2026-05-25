export function EnvironmentVariableDeleteDialog({
  variableName,
  onCancel,
  onConfirm,
}: {
  variableName: string
  onCancel(): void
  onConfirm(): void
}) {
  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-variable-dialog-title"
      >
        <p className="sidebar-eyebrow">Delete Variable</p>
        <h2 id="delete-variable-dialog-title">Delete {variableName}?</h2>
        <p>
          This removes the variable from this environment. Any connection, query,
          or script using it will need another inherited value before it can run.
        </p>
        <div className="workbench-dialog-actions">
          <button type="button" className="drawer-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--danger"
            onClick={onConfirm}
          >
            Delete Variable
          </button>
        </div>
      </section>
    </div>
  )
}
