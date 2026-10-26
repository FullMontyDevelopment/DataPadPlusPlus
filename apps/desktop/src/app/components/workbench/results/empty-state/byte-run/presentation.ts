import { GROUND, PLAYER_HEIGHT, PLAYER_WIDTH, PLAYER_X, WORLD_HEIGHT, WORLD_WIDTH } from './engine'
import type { Run } from './engine'

export interface Point { x: number; y: number }

// Shared by drawing and pointer mapping, including letterboxing and close-up
// narrow docks. Only a panel resize changes the framing: boosts and normal
// acceleration must never zoom or shift the playfield under the player.
export function viewport(width: number, height: number) {
  const visibleWidth = Math.min(WORLD_WIDTH, Math.max(480,
    width * WORLD_HEIGHT / Math.max(1, Math.min(height, WORLD_HEIGHT))))
  const scale = Math.min(width / visibleWidth, height / WORLD_HEIGHT)
  return { visibleWidth, scale, x: (width - visibleWidth * scale) / 2, y: (height - WORLD_HEIGHT * scale) / 2 }
}

export function sceneTransform(visibleWidth: number, direction: 1 | -1, shift: number) {
  const playerLeft = PLAYER_X + (visibleWidth - PLAYER_WIDTH - 2 * PLAYER_X) * shift
  return { x: playerLeft + (direction === -1 ? PLAYER_WIDTH : 0) - direction * PLAYER_X, direction }
}

export function pointerInWorld(point: Point, width: number, height: number, direction: 1 | -1 = 1, shift = direction === -1 ? 1 : 0): Point | null {
  const view = viewport(width, height)
  if (view.scale <= 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  const scene = sceneTransform(view.visibleWidth, direction, shift)
  return { x: ((point.x - view.x) / view.scale - scene.x) / direction, y: (point.y - view.y) / view.scale }
}

export function robotEyes(run: Run, pointer: Point | null, reducedMotion: boolean) {
  const danger = run.obstacles.some(obstacle => obstacle.x > PLAYER_X && obstacle.x - PLAYER_X < run.speed * 0.45)
  const expression = run.over ? 'dazed' : run.falling ? 'surprised' : run.pickupFeedback > 0 ? 'happy' : run.landed > 0 && !pointer ? 'blink'
    : run.y > 0 ? (run.velocity > 0 ? 'surprised' : 'focused') : danger ? 'surprised'
    : !pointer && !reducedMotion && run.elapsed % 4 > 3.8 && run.elapsed % 4 < 3.9 ? 'blink'
    : run.speed > 500 ? 'focused' : 'neutral'
  const height = expression === 'surprised' ? 8 : expression === 'focused' ? 5 : 7
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value))
  return {
    expression, height,
    x: pointer ? clamp((pointer.x - PLAYER_X - 14) / 50, 1.7) : 0.8,
    y: pointer ? clamp((pointer.y - (GROUND - PLAYER_HEIGHT - run.y + 9)) / 50, (height - 3) / 2)
      : run.y > 0 ? (run.velocity > 0 ? -1 : 1) : 0,
  }
}
