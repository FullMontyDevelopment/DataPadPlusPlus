import { copyText } from './payload-export'

interface KeyValueContextMenuProps {
  canEdit: boolean
  canDelete?: boolean
  canPersistTtl?: boolean
  canRename?: boolean
  canSetTtl?: boolean
  copyKeyLabel?: string
  deleteLabel?: string
  keyName: string
  rawValue: string
  x: number
  y: number
  onClose(): void
  onDelete(): void
  onEdit(): void
  onPersistTtl(): void
  onRename(): void
  onSetTtl(): void
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
  rawValue,
  onClose,
  onDelete,
  onEdit,
  onPersistTtl,
  onRename,
  onSetTtl,
  x,
  y,
}: KeyValueContextMenuProps) {
  return (
    <div
      className="document-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={() => { void copyText(keyName); onClose() }}>
        {copyKeyLabel}
      </button>
      <button type="button" role="menuitem" onClick={() => { void copyText(rawValue); onClose() }}>
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
    </div>
  )
}
