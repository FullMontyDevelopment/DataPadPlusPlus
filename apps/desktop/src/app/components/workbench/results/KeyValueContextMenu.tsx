import { copyText } from './payload-export'
import { ContextMenuSurface } from '../ContextMenuSurface'

interface KeyValueContextMenuProps {
  canEdit: boolean
  canDelete?: boolean
  canPersistTtl?: boolean
  canRename?: boolean
  canSetTtl?: boolean
  copyKeyLabel?: string
  deleteLabel?: string
  keyName: string
  x: number
  y: number
  originElement?: HTMLElement | null
  onClose(): void
  onCopyValue(): void
  onDelete(): void
  onEdit(): void
  onPersistTtl(): void
  onRename(): void
  onSetTtl(): void
  onViewValue(): void
}

export function KeyValueContextMenu({
  canEdit,
  canDelete = canEdit,
  canPersistTtl = canEdit,
  canRename = canEdit,
  canSetTtl = canEdit,
  copyKeyLabel = 'Copy Key',
  deleteLabel = 'Delete Key',
  keyName,
  onClose,
  onCopyValue,
  onDelete,
  onEdit,
  onPersistTtl,
  onRename,
  onSetTtl,
  onViewValue,
  x,
  y,
  originElement,
}: KeyValueContextMenuProps) {
  return (
    <ContextMenuSurface
      anchorPoint={{ x, y }}
      ariaLabel={`Key options for ${keyName}`}
      className="document-context-menu"
      onClose={onClose}
      originElement={originElement}
    >
      <button type="button" role="menuitem" onClick={() => { void copyText(keyName); onClose() }}>
        {copyKeyLabel}
      </button>
      <button type="button" role="menuitem" onClick={() => { onViewValue(); onClose() }}>
        View Value
      </button>
      <button type="button" role="menuitem" onClick={() => { onCopyValue(); onClose() }}>
        Copy Value
      </button>
      {canEdit ? (
        <button type="button" role="menuitem" onClick={() => { onEdit(); onClose() }}>
          Edit Value
        </button>
      ) : null}
      {canRename ? (
        <button type="button" role="menuitem" onClick={() => { onRename(); onClose() }}>
          Rename Key
        </button>
      ) : null}
      {canSetTtl ? (
        <button type="button" role="menuitem" onClick={() => { onSetTtl(); onClose() }}>
          Set TTL
        </button>
      ) : null}
      {canPersistTtl ? (
        <button type="button" role="menuitem" onClick={() => { onPersistTtl(); onClose() }}>
          Remove TTL
        </button>
      ) : null}
      {canDelete ? (
        <button
          type="button"
          role="menuitem"
          className="document-context-menu-danger"
          onClick={() => { onDelete(); onClose() }}
        >
          {deleteLabel}
        </button>
      ) : null}
    </ContextMenuSurface>
  )
}
