import { ContextMenuSurface } from '../ContextMenuSurface'

interface DataGridContextMenuProps {
  canDelete: boolean
  deleteLabel: string
  disabledReason?: string
  onClose(): void
  onDeleteRow(): void
  x: number
  y: number
  originElement?: HTMLElement | null
}

export function DataGridContextMenu({
  canDelete,
  deleteLabel,
  disabledReason,
  onClose,
  onDeleteRow,
  x,
  y,
  originElement,
}: DataGridContextMenuProps) {
  return (
    <ContextMenuSurface
      anchorPoint={{ x, y }}
      ariaLabel="Row options"
      className="document-context-menu"
      onClose={onClose}
      originElement={originElement}
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
    </ContextMenuSurface>
  )
}
