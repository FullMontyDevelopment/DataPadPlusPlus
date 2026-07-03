import type { CSSProperties } from 'react'

export type GuidePopoverPlacement = 'top' | 'right' | 'bottom' | 'left'

export interface SpotlightState {
  top: number
  left: number
  width: number
  height: number
}

export interface GuidePopoverSize {
  width: number
  height: number
}

export function getGuidePopoverStyle(
  spotlight: SpotlightState | undefined,
  preferredPlacement: GuidePopoverPlacement = 'right',
  popoverSize: GuidePopoverSize = { width: 360, height: 260 },
): CSSProperties {
  const margin = 16
  const width = Math.min(popoverSize.width, window.innerWidth - margin * 2)
  const height = Math.min(popoverSize.height, window.innerHeight - margin * 2)

  if (!spotlight) {
    return {
      top: clamp((window.innerHeight - height) / 2, margin, Math.max(margin, window.innerHeight - height - margin)),
      left: clamp((window.innerWidth - width) / 2, margin, Math.max(margin, window.innerWidth - width - margin)),
    }
  }

  const gap = 14
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const placements = fallbackPlacements(preferredPlacement)
  const candidates = placements.map((placement) =>
    popoverPositionForPlacement(spotlight, placement, width, height, gap),
  )
  const fittingCandidate = candidates.find((candidate) =>
    popoverFitsPrimaryAxis(candidate, width, height, viewportWidth, viewportHeight, margin),
  )
  const position =
    fittingCandidate ??
    candidates[0] ??
    popoverPositionForPlacement(spotlight, preferredPlacement, width, height, gap)

  return {
    top: clamp(position.top, margin, Math.max(margin, viewportHeight - height - margin)),
    left: clamp(position.left, margin, Math.max(margin, viewportWidth - width - margin)),
  }
}

function fallbackPlacements(
  preferredPlacement: GuidePopoverPlacement,
): GuidePopoverPlacement[] {
  switch (preferredPlacement) {
    case 'top':
      return ['top', 'right', 'left', 'bottom']
    case 'bottom':
      return ['bottom', 'right', 'left', 'top']
    case 'left':
      return ['left', 'bottom', 'top', 'right']
    case 'right':
    default:
      return ['right', 'bottom', 'top', 'left']
  }
}

function popoverPositionForPlacement(
  spotlight: SpotlightState,
  placement: GuidePopoverPlacement,
  width: number,
  height: number,
  gap: number,
) {
  const horizontalCenter = spotlight.left + spotlight.width / 2 - width / 2
  const verticalCenter = spotlight.top + spotlight.height / 2 - height / 2

  switch (placement) {
    case 'top':
      return {
        placement,
        top: spotlight.top - height - gap,
        left: horizontalCenter,
      }
    case 'bottom':
      return {
        placement,
        top: spotlight.top + spotlight.height + gap,
        left: horizontalCenter,
      }
    case 'left':
      return {
        placement,
        top: verticalCenter,
        left: spotlight.left - width - gap,
      }
    case 'right':
    default:
      return {
        placement,
        top: verticalCenter,
        left: spotlight.left + spotlight.width + gap,
      }
  }
}

function popoverFitsPrimaryAxis(
  position: { placement: GuidePopoverPlacement; top: number; left: number },
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin: number,
) {
  if (position.placement === 'left' || position.placement === 'right') {
    return position.left >= margin && position.left + width <= viewportWidth - margin
  }

  return position.top >= margin && position.top + height <= viewportHeight - margin
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
