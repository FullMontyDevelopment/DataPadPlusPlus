import { DragHandleIcon } from '../../icons'
import {
  beginMongoBuilderRowDrag,
  clearMongoBuilderRowDrag,
  type MongoBuilderRowDragKind,
  updateMongoBuilderRowDragVisuals,
} from './MongoBuilderRowDrag.helpers'

interface MongoBuilderDragHandleProps {
  groupId?: string
  kind: MongoBuilderRowDragKind
  label: string
  rowId: string
}

export function MongoBuilderDragHandle({
  groupId,
  kind,
  label,
  rowId,
}: MongoBuilderDragHandleProps) {
  return (
    <button
      type="button"
      className="query-builder-drag-handle"
      aria-label={label}
      data-mongo-builder-drag-group-id={groupId}
      data-mongo-builder-drag-kind={kind}
      data-mongo-builder-drag-row-id={rowId}
      title="Drag to reorder"
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return
        }

        event.preventDefault()
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Pointer capture is a convenience; target resolution still uses elementFromPoint.
        }
        beginMongoBuilderRowDrag({
          groupId,
          kind,
          rowId,
        })
      }}
      onPointerMove={(event) => {
        updateMongoBuilderRowDragVisuals(event, kind)
      }}
      onPointerUp={(event) => {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          // The browser may already have released capture after the drop.
        }
        clearMongoBuilderRowDrag()
      }}
      onPointerCancel={clearMongoBuilderRowDrag}
    >
      <DragHandleIcon className="toolbar-icon" />
    </button>
  )
}
