import { copyText } from '../../../results/payload-export'
import { ContextMenuSurface } from '../../../ContextMenuSurface'

interface SearchHitsContextMenuProps {
  canEdit: boolean
  documentId: string
  sourceText: string
  x: number
  y: number
  originElement?: HTMLElement | null
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
  originElement,
  onClose,
  onDelete,
  onUpdate,
}: SearchHitsContextMenuProps) {
  return (
    <ContextMenuSurface
      anchorPoint={{ x, y }}
      ariaLabel={`Search result options for ${documentId}`}
      className="document-context-menu"
      onClose={onClose}
      originElement={originElement}
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
    </ContextMenuSurface>
  )
}
