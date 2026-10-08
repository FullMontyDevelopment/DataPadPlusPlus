import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

export interface FilterDropTarget {
  groupId?: string
  rowId?: string
  placement: 'before' | 'after'
}

export function moveQueryBuilderFilter<T extends { id: string; groupId?: string }>(
  rows: T[], rowId: string, target: FilterDropTarget,
): T[] {
  const moving = rows.find(row => row.id === rowId)
  if (!moving || target.rowId === rowId) return rows
  const next = rows.filter(row => row.id !== rowId)
  let index = target.rowId ? next.findIndex(row => row.id === target.rowId) : -1
  if (index < 0) {
    index = 0
    next.forEach((row, position) => { if (row.groupId === target.groupId) index = position + 1 })
  }
  else if (target.placement === 'after') index += 1
  next.splice(index, 0, { ...moving, groupId: target.groupId })
  return next
}

/** Scoped pointer capture keeps filter movement independent of other mounted builders. */
export function useQueryBuilderFilterDrag(
  rootRef: RefObject<HTMLElement | null>, contextKey: string,
  onMove: ((rowId: string, target: FilterDropTarget) => void) | undefined,
) {
  const active = useRef<{ rowId: string; pointerId: number; handle: HTMLElement } | undefined>(undefined)
  useEffect(() => {
    const root = rootRef.current
    const clearVisuals = () => {
      root?.querySelectorAll('.is-row-dragging,.is-row-drop-target').forEach(element => {
        element.classList.remove('is-row-dragging', 'is-row-drop-target', 'is-row-drop-before', 'is-row-drop-after')
      })
    }
    const cancel = () => {
      const drag = active.current
      active.current = undefined
      try { drag?.handle.releasePointerCapture(drag.pointerId) } catch { /* Already released. */ }
      clearVisuals()
    }
    const resolve = (event: PointerEvent) => {
      const element = document.elementFromPoint?.(event.clientX, event.clientY)
      if (!root || !element || !root.contains(element)) return undefined
      const zoneElement = element.closest<HTMLElement>('[data-query-builder-drop-zone]')
      const zone = zoneElement?.dataset.queryBuilderDropZone
      if (!zone || (zone !== 'filters' && !zone.startsWith('filters:'))) return undefined
      const row = element.closest<HTMLElement>('[data-query-builder-filter-id]')
      return {
        element: row ?? zoneElement!,
        groupId: zone.startsWith('filters:') ? zone.slice(8) : undefined,
        rowId: row?.dataset.queryBuilderFilterId,
        placement: row && event.clientY <= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2
          ? 'before' as const : 'after' as const,
      }
    }
    const move = (event: PointerEvent) => {
      const drag = active.current
      if (!drag || drag.pointerId !== event.pointerId) return
      clearVisuals()
      drag.handle.closest('.query-builder-row')?.classList.add('is-row-dragging')
      const target = resolve(event)
      if (target && target.rowId !== drag.rowId) {
        target.element.classList.add('is-row-drop-target')
        if (target.rowId) target.element.classList.add(`is-row-drop-${target.placement}`)
      }
    }
    const drop = (event: PointerEvent) => {
      const drag = active.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const target = resolve(event)
      cancel()
      if (target) onMove?.(drag.rowId, target)
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', drop)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key)
    return () => {
      cancel()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', drop)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [contextKey, onMove, rootRef])

  return (event: ReactPointerEvent<HTMLButtonElement>, rowId: string) => {
    if (!onMove || event.button !== 0) return
    event.preventDefault()
    active.current = { rowId, pointerId: event.pointerId, handle: event.currentTarget }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Window listeners also receive uncaptured events. */ }
    event.currentTarget.closest('.query-builder-row')?.classList.add('is-row-dragging')
  }
}
