import { documentResultBehaviorForConnection } from './datastore-result-behaviors'
import { editablePermissions } from './document-edit-permissions'
import type { DocumentGridRow } from './document-grid-model'

type DocumentResultBehavior = ReturnType<typeof documentResultBehaviorForConnection>

interface DocumentContextMenuProps {
  behavior: DocumentResultBehavior
  onClose(): void
  onCopyDocument(): void
  onCopyPath(): void
  onCopyValue(): void
  onDelete(): void
  onEditValue(): void
  onRename(): void
  onViewRawJson(): void
  row: DocumentGridRow
  x: number
  y: number
}

export function DocumentContextMenu({
  behavior,
  onClose,
  onCopyDocument,
  onCopyPath,
  onCopyValue,
  onDelete,
  onEditValue,
  onRename,
  onViewRawJson,
  row,
  x,
  y,
}: DocumentContextMenuProps) {
  const permissions = editablePermissions(row, behavior)

  return (
    <div
      className="document-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {behavior.contextActions.copyPath ? (
        <button type="button" role="menuitem" onClick={() => { onCopyPath(); onClose() }}>
          Copy Path
        </button>
      ) : null}
      {behavior.contextActions.copyValue ? (
        <button type="button" role="menuitem" onClick={() => { onCopyValue(); onClose() }}>
          Copy Value
        </button>
      ) : null}
      {behavior.contextActions.copyDocument ? (
        <button type="button" role="menuitem" onClick={() => { onCopyDocument(); onClose() }}>
          Copy Document JSON
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={() => { onViewRawJson(); onClose() }}>
        View Raw JSON
      </button>
      {behavior.contextActions.renameField && permissions.canEditField ? (
        <button type="button" role="menuitem" onClick={() => { onRename(); onClose() }}>
          Rename Field
        </button>
      ) : null}
      {behavior.contextActions.editValue && permissions.canEditLeaf ? (
        <button type="button" role="menuitem" onClick={() => { onEditValue(); onClose() }}>
          Edit Value
        </button>
      ) : null}
      {behavior.contextActions.changeType && permissions.canChangeType ? (
        <span role="menuitem" className="document-context-menu-note">
          Double-click type to change
        </span>
      ) : null}
      {behavior.contextActions.deleteField && permissions.canDeleteField ? (
        <button type="button" role="menuitem" onClick={() => { onDelete(); onClose() }}>
          Delete Field
        </button>
      ) : null}
    </div>
  )
}
