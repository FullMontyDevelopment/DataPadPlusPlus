import { copyText } from '../../../results/payload-export'

interface SearchHitsContextMenuProps {
  canEdit: boolean
  documentId: string
  sourceText: string
  x: number
  y: number
  onClose(): void
  onDelete(): void
  onUpdate(): void
}

export function SearchHitsContextMenu({
  canEdit,
  documentId,
  sourceText,
  x,
  y,
  onClose,
  onDelete,
  onUpdate,
}: SearchHitsContextMenuProps) {
  return (
    <div
      className="document-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={() => { void copyText(documentId); onClose() }}>
        Copy Document ID
      </button>
      <button type="button" role="menuitem" onClick={() => { void copyText(sourceText); onClose() }}>
        Copy Source JSON
      </button>
      {canEdit ? (
        <button type="button" role="menuitem" onClick={() => { onUpdate(); onClose() }}>
          Update Document
        </button>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          role="menuitem"
          className="document-context-menu-danger"
          onClick={() => { onDelete(); onClose() }}
        >
          Delete Document
        </button>
      ) : null}
    </div>
  )
}
