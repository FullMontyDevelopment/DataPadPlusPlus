export const CONTEXT_MENU_VIEWPORT_MARGIN = 8

export interface ContextMenuPoint {
  x: number
  y: number
}

export interface ContextMenuViewport {
  height: number
  left: number
  top: number
  width: number
}

export interface ContextMenuSize {
  height: number
  width: number
}

export interface ContextMenuPlacement {
  left: number
  maxHeight: number
  maxWidth: number
  top: number
}

export function calculateContextMenuPlacement(
  anchorPoint: ContextMenuPoint,
  menuSize: ContextMenuSize,
  viewport: ContextMenuViewport,
): ContextMenuPlacement {
  const maxWidth = Math.max(
    1,
    viewport.width - CONTEXT_MENU_VIEWPORT_MARGIN * 2,
  )
  const maxHeight = Math.max(
    1,
    viewport.height - CONTEXT_MENU_VIEWPORT_MARGIN * 2,
  )
  const width = Math.min(menuSize.width, maxWidth)
  const height = Math.min(menuSize.height, maxHeight)
  const minimumLeft = viewport.left + CONTEXT_MENU_VIEWPORT_MARGIN
  const minimumTop = viewport.top + CONTEXT_MENU_VIEWPORT_MARGIN
  const maximumLeft = Math.max(
    minimumLeft,
    viewport.left + viewport.width - width - CONTEXT_MENU_VIEWPORT_MARGIN,
  )
  const maximumTop = Math.max(
    minimumTop,
    viewport.top + viewport.height - height - CONTEXT_MENU_VIEWPORT_MARGIN,
  )

  return {
    left: clamp(anchorPoint.x, minimumLeft, maximumLeft),
    maxHeight,
    maxWidth,
    top: clamp(anchorPoint.y, minimumTop, maximumTop),
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}
