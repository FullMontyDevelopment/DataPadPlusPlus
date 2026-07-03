interface DataGridContextMenuProps {
  canDelete: boolean
  deleteLabel: string
  disabledReason?: string
  onClose(): void
  onDeleteRow(): void
  x: number
  y: number
}

export function DataGridContextMenu({
  canDelete,
  deleteLabel,
  disabledReason,
  onClose,
  onDeleteRow,
  x,
  y,
}: DataGridContextMenuProps) {
  return (
    <div
      className="document-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {canDelete ? (
        <button
          type="button"
          role="menuitem"
          className="document-context-menu-danger"
          onClick={() => { onDeleteRow(); onClose() }}
        >
          {deleteLabel}
        </button>
      ) : disabledReason ? (
        <button type="button" role="menuitem" disabled title={disabledReason}>
          {deleteLabel} unavailable
        </button>
      ) : null}
    </div>
  )
}
