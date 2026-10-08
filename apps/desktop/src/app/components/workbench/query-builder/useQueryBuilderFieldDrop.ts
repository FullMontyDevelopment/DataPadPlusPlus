import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  acceptFieldDrag, clearFieldDragData, readFieldDragPayload,
  FIELD_POINTER_DRAG_CANCEL_EVENT, FIELD_POINTER_DRAG_DROP_EVENT, FIELD_POINTER_DRAG_MOVE_EVENT,
  type FieldDragPayload, type FieldPointerDragDetail,
} from '../results/field-drag'
import { pointInsideElement } from './query-builder-drag-targets'

/** Opt-in result-field drops for adapters, including WebViews without HTML drag/drop. */
export function useQueryBuilderFieldDrop(
  contextKey: string,
  onDrop: ((payload: FieldDragPayload, zone: string) => void) | undefined,
) {
  const rootRef = useRef<HTMLElement>(null)
  const [activeDropZone, setActiveDropZone] = useState<string>()
  const pointerContext = useRef<string | undefined>(undefined)
  const clear = () => setActiveDropZone(undefined)

  const zoneForTarget = (target: EventTarget | null) => {
    const root = rootRef.current
    if (!root || !(target instanceof Element) || !root.contains(target)) return undefined
    return target.closest<HTMLElement>('[data-query-builder-drop-zone]')?.dataset.queryBuilderDropZone ?? 'filters'
  }

  useEffect(() => {
    const cancel = () => {
      pointerContext.current = undefined
      setActiveDropZone(undefined)
    }
    const zoneAt = (detail: FieldPointerDragDetail | undefined) => {
      const root = rootRef.current
      if (!onDrop || !root || !detail || !pointInsideElement(root, detail.clientX, detail.clientY)) return undefined
      const target = document.elementFromPoint?.(detail.clientX, detail.clientY)
      // Do not accept a drop through an overlaid dialog or another builder.
      if (!target || !root.contains(target)) return undefined
      return target.closest<HTMLElement>('[data-query-builder-drop-zone]')?.dataset.queryBuilderDropZone ?? 'filters'
    }
    const move = (event: Event) => {
      const zone = zoneAt((event as CustomEvent<FieldPointerDragDetail>).detail)
      pointerContext.current = zone ? contextKey : undefined
      setActiveDropZone(zone)
    }
    const drop = (event: Event) => {
      const detail = (event as CustomEvent<FieldPointerDragDetail>).detail
      const zone = zoneAt(detail)
      const accepted = pointerContext.current === contextKey
      cancel()
      if (accepted && zone && detail?.payload.fieldPath.trim()) onDrop?.(detail.payload, zone)
    }
    window.addEventListener(FIELD_POINTER_DRAG_MOVE_EVENT, move)
    window.addEventListener(FIELD_POINTER_DRAG_DROP_EVENT, drop)
    window.addEventListener(FIELD_POINTER_DRAG_CANCEL_EVENT, cancel)
    window.addEventListener('blur', cancel)
    return () => {
      cancel()
      window.removeEventListener(FIELD_POINTER_DRAG_MOVE_EVENT, move)
      window.removeEventListener(FIELD_POINTER_DRAG_DROP_EVENT, drop)
      window.removeEventListener(FIELD_POINTER_DRAG_CANCEL_EVENT, cancel)
      window.removeEventListener('blur', cancel)
    }
  }, [contextKey, onDrop])

  const over = (event: DragEvent<HTMLElement>) => {
    if (onDrop && acceptFieldDrag(event)) setActiveDropZone(zoneForTarget(event.target))
  }
  return {
    rootRef,
    activeDropZone: onDrop ? activeDropZone : undefined,
    dropHandlers: {
      onDragEnterCapture: over,
      onDragOverCapture: over,
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) clear()
      },
      onDropCapture: (event: DragEvent<HTMLElement>) => {
        // A single owner handles group/row drops before section handlers can duplicate them.
        event.preventDefault()
        event.stopPropagation()
        clear()
        const payload = readFieldDragPayload(event)
        const zone = zoneForTarget(event.target)
        if (payload?.fieldPath && zone) onDrop?.(payload, zone)
        clearFieldDragData()
      },
      onDragEnd: clear,
    },
  }
}
