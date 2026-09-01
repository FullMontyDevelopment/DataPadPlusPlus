import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  CONTEXT_MENU_VIEWPORT_MARGIN,
  calculateContextMenuPlacement,
  type ContextMenuPlacement,
  type ContextMenuPoint,
  type ContextMenuViewport,
} from './context-menu-placement'

const SCROLL_EDGE_TOLERANCE = 1

interface ContextMenuSurfaceProps {
  anchorPoint: ContextMenuPoint
  ariaLabel: string
  children: ReactNode
  className: string
  onClose(): void
  originElement?: HTMLElement | null
}

interface ContextMenuSurfaceStyle extends CSSProperties {
  '--context-menu-max-height': string
  '--context-menu-max-width': string
}

let activeContextMenu:
  | { close(): void; id: symbol }
  | undefined

export function ContextMenuSurface({
  anchorPoint,
  ariaLabel,
  children,
  className,
  onClose,
  originElement,
}: ContextMenuSurfaceProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const instanceIdRef = useRef(Symbol('context-menu'))
  const onCloseRef = useRef(onClose)
  const originElementRef = useRef<HTMLElement | null>(null)
  const anchorX = anchorPoint.x
  const anchorY = anchorPoint.y
  const [measured, setMeasured] = useState(false)
  const [scrollEdges, setScrollEdges] = useState({ above: false, below: false })
  const [placement, setPlacement] = useState<ContextMenuPlacement>(() =>
    calculateContextMenuPlacement(
      { x: anchorX, y: anchorY },
      { height: 0, width: 0 },
      currentViewport(),
    ),
  )

  useLayoutEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const updateScrollEdges = useCallback(() => {
    const menu = menuRef.current
    if (!menu) {
      return
    }

    const next = {
      above: menu.scrollTop > SCROLL_EDGE_TOLERANCE,
      below:
        menu.scrollTop + menu.clientHeight <
        menu.scrollHeight - SCROLL_EDGE_TOLERANCE,
    }
    setScrollEdges((current) =>
      current.above === next.above && current.below === next.below
        ? current
        : next,
    )
  }, [])

  const measure = useCallback(() => {
    const menu = menuRef.current
    if (!menu) {
      return
    }

    const viewport = currentViewport()
    const maxWidth = Math.max(
      1,
      viewport.width - CONTEXT_MENU_VIEWPORT_MARGIN * 2,
    )
    const maxHeight = Math.max(
      1,
      viewport.height - CONTEXT_MENU_VIEWPORT_MARGIN * 2,
    )

    setStylePropertyIfChanged(
      menu,
      '--context-menu-max-width',
      `${maxWidth}px`,
    )
    setStylePropertyIfChanged(
      menu,
      '--context-menu-max-height',
      `${maxHeight}px`,
    )

    const bounds = menu.getBoundingClientRect()
    const next = calculateContextMenuPlacement(
      { x: anchorX, y: anchorY },
      {
        height: Math.min(bounds.height, maxHeight),
        width: Math.min(bounds.width, maxWidth),
      },
      viewport,
    )

    setPlacement((current) =>
      samePlacement(current, next) ? current : next,
    )
    setMeasured(true)
    updateScrollEdges()
  }, [anchorX, anchorY, updateScrollEdges])

  useLayoutEffect(() => {
    originElementRef.current =
      originElement ??
      originElementAt({ x: anchorX, y: anchorY }) ??
      activeFocusableElement() ??
      null
    measure()

    const menu = menuRef.current
    const firstItem = enabledMenuItems(menu)[0]
    if (firstItem) {
      firstItem.focus({ preventScroll: true })
      firstItem.scrollIntoView?.({ block: 'nearest' })
      updateScrollEdges()
    } else {
      menu?.focus({ preventScroll: true })
    }
  }, [anchorX, anchorY, measure, originElement, updateScrollEdges])

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) {
      return
    }

    const update = () => measure()
    const viewport = window.visualViewport
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(update)
    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver(update)

    resizeObserver?.observe(menu)
    mutationObserver?.observe(menu, {
      attributes: true,
      childList: true,
      subtree: true,
    })
    window.addEventListener('resize', update)
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)

    return () => {
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', update)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
    }
  }, [measure])

  useEffect(() => {
    const id = instanceIdRef.current
    if (activeContextMenu?.id !== id) {
      activeContextMenu?.close()
      activeContextMenu = { id, close: () => onCloseRef.current() }
    }

    const closeFromPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node | null)) {
        onCloseRef.current()
      }
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
      scheduleAfterPaint(() => {
        if (originElementRef.current?.isConnected) {
          originElementRef.current.focus({ preventScroll: true })
        }
      })
    }
    const closeFromBlur = () => onCloseRef.current()

    window.addEventListener('pointerdown', closeFromPointer, true)
    window.addEventListener('keydown', closeFromKeyboard, true)
    window.addEventListener('blur', closeFromBlur)
    return () => {
      if (activeContextMenu?.id === id) {
        activeContextMenu = undefined
      }
      window.removeEventListener('pointerdown', closeFromPointer, true)
      window.removeEventListener('keydown', closeFromKeyboard, true)
      window.removeEventListener('blur', closeFromBlur)
    }
  }, [])

  if (typeof document === 'undefined') {
    return null
  }

  const surface = (
    <div
      ref={menuRef}
      className={`context-menu-surface ${className}${
        scrollEdges.above ? ' has-scroll-above' : ''
      }${scrollEdges.below ? ' has-scroll-below' : ''}`}
      role="menu"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      tabIndex={-1}
      style={
        {
          '--context-menu-max-height': `${placement.maxHeight}px`,
          '--context-menu-max-width': `${placement.maxWidth}px`,
          left: placement.left,
          top: placement.top,
          visibility: measured ? 'visible' : 'hidden',
        } as ContextMenuSurfaceStyle
      }
      onKeyDown={handleMenuKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      onScroll={updateScrollEdges}
    >
      {children}
    </div>
  )

  return createPortal(surface, document.body)
}

function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return
  }

  const items = enabledMenuItems(event.currentTarget)
  if (items.length === 0) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const currentIndex = items.findIndex(
    (item) => item === event.currentTarget.ownerDocument.activeElement,
  )
  let nextIndex = 0

  if (event.key === 'End') {
    nextIndex = items.length - 1
  } else if (event.key === 'ArrowUp') {
    nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1
  } else if (event.key === 'ArrowDown') {
    nextIndex = currentIndex >= items.length - 1 ? 0 : currentIndex + 1
  }

  const nextItem = items[nextIndex]
  nextItem?.focus({ preventScroll: true })
  nextItem?.scrollIntoView?.({ block: 'nearest' })
}

function enabledMenuItems(menu?: HTMLElement | null) {
  if (!menu) {
    return []
  }

  return Array.from(
    menu.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
    ),
  ).filter(
    (item) =>
      item.tabIndex >= 0 &&
      !item.hasAttribute('disabled') &&
      item.getAttribute('aria-disabled') !== 'true',
  )
}

function currentViewport(): ContextMenuViewport {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { height: 1, left: 0, top: 0, width: 1 }
  }

  const viewport = window.visualViewport
  return {
    height:
      viewport?.height ||
      document.documentElement.clientHeight ||
      window.innerHeight ||
      1,
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width:
      viewport?.width ||
      document.documentElement.clientWidth ||
      window.innerWidth ||
      1,
  }
}

function originElementAt(point: ContextMenuPoint) {
  if (typeof document === 'undefined' || !document.elementFromPoint) {
    return undefined
  }

  const element = document.elementFromPoint(point.x, point.y)
  return element?.closest<HTMLElement>(
    'button, [href], [role="button"], [role="tab"], [role="treeitem"], [tabindex]:not([tabindex="-1"])',
  )
}

function activeFocusableElement() {
  if (typeof document === 'undefined') {
    return undefined
  }

  const activeElement = document.activeElement
  return activeElement instanceof HTMLElement && activeElement !== document.body
    ? activeElement
    : undefined
}

function samePlacement(
  current: ContextMenuPlacement,
  next: ContextMenuPlacement,
) {
  return (
    current.left === next.left &&
    current.maxHeight === next.maxHeight &&
    current.maxWidth === next.maxWidth &&
    current.top === next.top
  )
}

function scheduleAfterPaint(action: () => void) {
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(action)
    return
  }

  queueMicrotask(action)
}

function setStylePropertyIfChanged(
  element: HTMLElement,
  property: string,
  value: string,
) {
  if (element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value)
  }
}
