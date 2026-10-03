import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import type { EditorTabDropTarget } from './EditorTabItem'

interface DragSession {
  tabId: string
  pointerId: number
  origin: HTMLDivElement
  startX: number
  startY: number
  x: number
  y: number
  active: boolean
  tabIds: string[]
  commit(tabIds: string[]): void
}

export function reorderedTabIds(
  tabIds: string[],
  sourceId: string,
  target: EditorTabDropTarget,
): string[] {
  if (!tabIds.includes(sourceId) || !tabIds.includes(target.tabId) || sourceId === target.tabId) {
    return tabIds
  }
  const next = tabIds.filter((id) => id !== sourceId)
  const index = next.indexOf(target.tabId) + (target.placement === 'after' ? 1 : 0)
  next.splice(index, 0, sourceId)
  return next
}

/** Local pointer dragging avoids native file-drop interception in desktop WebViews. */
export function useTabPointerReorder(
  stripRef: RefObject<HTMLDivElement | null>,
  tabRefs: RefObject<Map<string, HTMLDivElement>>,
  tabIds: string[],
  onReorderTabs: (ids: string[]) => void,
) {
  const sessionRef = useRef<DragSession | undefined>(undefined)
  const frameRef = useRef<number | undefined>(undefined)
  const suppressClickRef = useRef(false)
  const [draggingTabId, setDraggingTabId] = useState<string>()
  const [dropTarget, setDropTarget] = useState<EditorTabDropTarget>()
  const [announcement, setAnnouncement] = useState('')
  const orderKey = JSON.stringify(tabIds)

  const cancel = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = undefined
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = undefined
    }
    if (session?.active) {
      suppressClickRef.current = true
      setAnnouncement('Tab order unchanged.')
    }
    if (session?.origin.hasPointerCapture?.(session.pointerId)) {
      session.origin.releasePointerCapture(session.pointerId)
    }
    setDraggingTabId(undefined)
    setDropTarget(undefined)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && sessionRef.current) {
        event.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', cancel)
    // Cancel if tabs are added, removed, or reordered elsewhere during a gesture.
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', cancel)
      cancel()
    }
  }, [cancel, orderKey])

  const targetAtPointer = (session: DragSession): EditorTabDropTarget | undefined => {
    const strip = stripRef.current?.getBoundingClientRect()
    if (!strip || session.x < strip.left || session.x > strip.right
      || session.y < strip.top || session.y > strip.bottom) {
      return undefined
    }
    let target: EditorTabDropTarget | undefined
    for (const id of session.tabIds) {
      const rect = tabRefs.current.get(id)?.getBoundingClientRect()
      if (!rect) continue
      target = { tabId: id, placement: 'after' }
      if (session.x < rect.left + rect.width / 2) {
        target = { tabId: id, placement: 'before' }
        break
      }
    }
    if (!target) return undefined
    const next = reorderedTabIds(session.tabIds, session.tabId, target)
    return next.some((id, index) => id !== session.tabIds[index]) ? target : undefined
  }

  const updateTarget = (session: DragSession) => {
    const target = targetAtPointer(session)
    setDropTarget((current) => current?.tabId === target?.tabId
      && current?.placement === target?.placement ? current : target)
  }

  const scrollAtEdge = () => {
    const session = sessionRef.current
    const strip = stripRef.current
    if (!session?.active || !strip) return
    const bounds = strip.getBoundingClientRect()
    if (session.y >= bounds.top && session.y <= bounds.bottom
      && session.x >= bounds.left && session.x <= bounds.right) {
      const edge = Math.min(36, bounds.width / 4)
      const distance = session.x < bounds.left + edge
        ? session.x - bounds.left - edge
        : session.x > bounds.right - edge ? session.x - bounds.right + edge : 0
      if (distance && edge > 0) {
        strip.scrollLeft = Math.max(0, Math.min(
          strip.scrollWidth - strip.clientWidth,
          strip.scrollLeft + distance / edge * 10,
        ))
        updateTarget(session)
      }
    }
    frameRef.current = requestAnimationFrame(scrollAtEdge)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, tabId: string) => {
    suppressClickRef.current = false
    if (event.button !== 0 || event.isPrimary === false
      || (event.target as HTMLElement).closest('button, input')) return
    cancel()
    sessionRef.current = {
      tabId, pointerId: event.pointerId, origin: event.currentTarget,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      active: false, tabIds, commit: onReorderTabs,
    }
    // Capture keeps the gesture alive while moving across other headers or beyond the strip.
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    session.x = event.clientX
    session.y = event.clientY
    if (!session.active) {
      if (Math.hypot(session.x - session.startX, session.y - session.startY) < 6) return
      session.active = true
      setDraggingTabId(session.tabId)
      setAnnouncement('Drag to the insertion marker. Escape cancels.')
      frameRef.current = requestAnimationFrame(scrollAtEdge)
    }
    event.preventDefault()
    updateTarget(session)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    session.x = event.clientX
    session.y = event.clientY
    const target = session.active ? targetAtPointer(session) : undefined
    cancel()
    if (target) {
      const next = reorderedTabIds(session.tabIds, session.tabId, target)
      session.commit(next)
      session.origin.focus({ preventScroll: true })
      setAnnouncement(`Tab moved to position ${next.indexOf(session.tabId) + 1} of ${next.length}.`)
    } else if (session.active) {
      setAnnouncement('Tab order unchanged.')
    }
  }

  return {
    draggingTabId, dropTarget, announcement, cancel,
    onPointerDown, onPointerMove, onPointerUp,
    suppressClick: () => {
      const suppressed = suppressClickRef.current
      suppressClickRef.current = false
      return suppressed
    },
  }
}
