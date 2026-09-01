import { documentResultBehaviorForConnection } from './datastore-result-behaviors'
import { editablePermissions } from './document-edit-permissions'
import type { DocumentGridRow } from './document-grid-model'
import { ContextMenuSurface } from '../ContextMenuSurface'

type DocumentResultBehavior = ReturnType<typeof documentResultBehaviorForConnection>

interface DocumentContextMenuProps {
  behavior: DocumentResultBehavior
  onClose(): void
  onAddField(): void
  onCopyDocument(): void
  onCopyPath(): void
  onCopyValue(): void
  onDelete(): void
  onDeleteDocument(): void
  onEditValue(): void
  onEditRawJson(): void
  onRename(): void
  onViewRawJson(): void
  row: DocumentGridRow
  documentDeleteUnavailableReason?: string
  editUnavailableReason?: string
  protectedPaths?: string[][]
  x: number
  y: number
  originElement?: HTMLElement | null
}

export function DocumentContextMenu({
  behavior,
  onAddField,
  onClose,
  onCopyDocument,
  onCopyPath,
  onCopyValue,
  onDelete,
  onDeleteDocument,
  onEditValue,
  onEditRawJson,
  onRename,
  onViewRawJson,
  row,
  documentDeleteUnavailableReason,
  editUnavailableReason,
  protectedPaths,
  x,
  y,
  originElement,
}: DocumentContextMenuProps) {
  const permissions = editablePermissions(row, behavior, protectedPaths)
  const rootDocument = row.path.length === 0

  return (
    <ContextMenuSurface
      anchorPoint={{ x, y }}
      ariaLabel={
        rootDocument
          ? 'Document options'
          : `Field options for ${row.fieldPath || row.label}`
      }
      className="document-context-menu"
      onClose={onClose}
      originElement={originElement}
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
      {behavior.contextActions.editRawJson ? (
        <button
          type="button"
          role="menuitem"
          disabled={!permissions.canEditRaw || Boolean(editUnavailableReason)}
          title={editUnavailableReason}
          onClick={() => { onEditRawJson(); onClose() }}
        >
          Edit Raw JSON
        </button>
      ) : null}
      {behavior.contextActions.addField && permissions.addFieldDestinationAvailable ? (
        <button
          type="button"
          role="menuitem"
          disabled={!permissions.canAddField || Boolean(editUnavailableReason)}
          title={editUnavailableReason}
          onClick={() => { onAddField(); onClose() }}
        >
          Add Field
        </button>
      ) : null}
      {behavior.contextActions.renameField ? (
        <button
          type="button"
          role="menuitem"
          disabled={!permissions.canEditField || Boolean(editUnavailableReason)}
          title={editUnavailableReason}
          onClick={() => { onRename(); onClose() }}
        >
          Rename Field
        </button>
      ) : null}
      {behavior.contextActions.editValue ? (
        <button
          type="button"
          role="menuitem"
          disabled={!permissions.canEditLeaf || Boolean(editUnavailableReason)}
          title={editUnavailableReason}
          onClick={() => { onEditValue(); onClose() }}
        >
          Edit Value
        </button>
      ) : null}
      {behavior.contextActions.changeType && permissions.canChangeType ? (
        <span role="menuitem" className="document-context-menu-note">
          Double-click type to change
        </span>
      ) : null}
      {behavior.contextActions.deleteDocument && rootDocument && !documentDeleteUnavailableReason ? (
        <button type="button" role="menuitem" className="document-context-menu-danger" onClick={() => { onDeleteDocument(); onClose() }}>
          Delete Document
        </button>
      ) : null}
      {behavior.contextActions.deleteDocument && rootDocument && documentDeleteUnavailableReason ? (
        <button type="button" role="menuitem" disabled title={documentDeleteUnavailableReason}>
          Delete Document unavailable
        </button>
      ) : null}
      {behavior.contextActions.deleteField && !rootDocument ? (
        <button
          type="button"
          role="menuitem"
          disabled={!permissions.canDeleteField || Boolean(editUnavailableReason)}
          title={editUnavailableReason}
          onClick={() => { onDelete(); onClose() }}
        >
          Remove Field
        </button>
      ) : null}
    </ContextMenuSurface>
  )
}
