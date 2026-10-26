import { BYTE_RADIUS, GROUND, obstacleParts, PICKUP_FEEDBACK_SECONDS, PLAYER_HEIGHT, PLAYER_WIDTH, PLAYER_X, worldPosition } from './engine'
import type { Obstacle, Run } from './engine'
import { robotEyes, sceneTransform, viewport } from './presentation'
import { drawPowerups } from './draw-powerups'
import type { Point } from './presentation'

export interface Palette { text: string; muted: string; accent: string; background: string }

export function drawRun(ctx: CanvasRenderingContext2D, run: Run, width: number, height: number,
  density: number, palette: Palette, reducedMotion: boolean, pointer: Point | null = null) {
  ctx.setTransform(density, 0, 0, density, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const { visibleWidth, scale, x, y } = viewport(width, height)
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  const shift = reducedMotion ? (run.direction === -1 ? 1 : 0) : run.screenShift
  const scene = sceneTransform(visibleWidth, run.direction, shift)
  ctx.translate(scene.x, 0)
  ctx.scale(run.direction, 1)
  const left = run.direction === 1 ? -scene.x : scene.x - visibleWidth
  const right = run.direction === 1 ? visibleWidth - scene.x : scene.x
  const edge = run.direction === -1 ? PLAYER_X + PLAYER_WIDTH / 2 + worldPosition(run) : Infinity
  const groundRight = Math.min(right - 18, edge)
  ctx.lineWidth = 1
  // A slower-moving skyline adds depth without assets or an idle animation.
  ctx.strokeStyle = palette.muted
  ctx.globalAlpha = 0.14
  const skyline = reducedMotion ? 0 : (run.distance * 0.18) % 160
  for (let x = Math.floor(left / 160) * 160 - skyline, i = 0; x < right; x += 160, i++) {
    if (x > edge) continue
    const top = 76 - ((i + (reducedMotion ? 0 : Math.floor(run.distance * 0.18 / 160))) % 3) * 14
    ctx.strokeRect(x, top, 42, GROUND - top)
    ctx.strokeRect(x + 48, top + 24, 27, GROUND - top - 24)
    for (let y = top + 9; y < GROUND - 8; y += 12) {
      ctx.fillStyle = palette.muted
      ctx.fillRect(x + 7, y, 6, 2)
      ctx.fillRect(x + 20, y, 14, 2)
    }
  }
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  ctx.moveTo(left + 18, GROUND + 1)
  ctx.lineTo(groundRight, GROUND + 1)
  if (edge < right) { ctx.lineTo(groundRight, GROUND + 22) }
  ctx.stroke()
  const offset = reducedMotion ? 0 : run.distance % 70
  for (let x = Math.floor(left / 70) * 70 + 30 - offset; x < groundRight - 33; x += 70) {
    ctx.fillStyle = palette.muted
    ctx.fillRect(x, GROUND + 11, 7, 1)
    ctx.fillRect(x + 26, GROUND + 17, 3, 1)
  }
  ctx.globalAlpha = 1
  for (const obstacle of run.obstacles) {
    if (obstacle.x < right && obstacle.x + obstacle.width > left) drawObstacle(ctx, obstacle, palette)
  }
  drawBytes(ctx, run, palette, right)
  drawPowerups(ctx, run, palette, left, right)
  drawRobot(ctx, run, palette, reducedMotion, pointer)
  // Text stays upright while the scene and character face the other way.
  ctx.setTransform(density, 0, 0, density, 0, 0)
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.fillStyle = palette.text
  ctx.font = 'bold 10px ui-monospace, monospace'
  if (run.effectFeedback > 0 && !run.over) {
    ctx.textAlign = 'center'
    ctx.fillText(run.effectMessage, visibleWidth / 2, 26)
    ctx.textAlign = 'start'
  }
  if (run.pickupFeedback > 0 && !run.over) {
    const lift = reducedMotion ? 0 : (1 - run.pickupFeedback / PICKUP_FEEDBACK_SECONDS) * 12
    const feedbackX = scene.x + run.direction * (PLAYER_X + 4)
    ctx.textAlign = run.direction === -1 ? 'end' : 'start'
    ctx.fillText(`+${run.lastBonus}`, feedbackX, GROUND - PLAYER_HEIGHT - run.y - 14 - lift)
    ctx.textAlign = 'start'
  }
}

function drawBytes(ctx: CanvasRenderingContext2D, run: Run, palette: Palette, visibleWidth: number) {
  for (const byte of run.bytes) {
    if (byte.x - BYTE_RADIUS > visibleWidth) continue
    const y = GROUND - byte.y
    ctx.fillStyle = palette.accent
    ctx.beginPath()
    ctx.moveTo(byte.x, y - BYTE_RADIUS)
    ctx.lineTo(byte.x + BYTE_RADIUS, y)
    ctx.lineTo(byte.x, y + BYTE_RADIUS)
    ctx.lineTo(byte.x - BYTE_RADIUS, y)
    ctx.fill()
    ctx.fillStyle = palette.background
    ctx.fillRect(byte.x - 2, y - 2, 4, 4)
  }
}

function drawObstacle(ctx: CanvasRenderingContext2D, obstacle: Obstacle, palette: Palette) {
  for (const part of obstacleParts(obstacle)) {
    const y = GROUND - part.height
    ctx.fillStyle = palette.muted
    ctx.fillRect(part.x, y, part.width, part.height)
    ctx.fillStyle = palette.background
    if (obstacle.kind === 'barrier') {
      for (let x = part.x + 4; x < part.x + part.width - 4; x += 12) {
        ctx.beginPath()
        ctx.moveTo(x, y + 4); ctx.lineTo(x + 5, y + 4)
        ctx.lineTo(x + 1, y + 13); ctx.lineTo(x - 4, y + 13)
        ctx.fill()
      }
      ctx.fillRect(part.x + 7, GROUND - 5, part.width - 14, 5)
    } else if (obstacle.kind === 'crate') {
      ctx.fillRect(part.x + 3, y + 3, part.width - 6, part.height - 6)
      ctx.strokeStyle = palette.muted
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(part.x + 5, y + 5); ctx.lineTo(part.x + part.width - 5, GROUND - 5)
      ctx.moveTo(part.x + part.width - 5, y + 5); ctx.lineTo(part.x + 5, GROUND - 5)
      ctx.stroke()
    } else {
      for (let row = y + 5; row < GROUND - 4; row += 10) {
        ctx.fillRect(part.x + 4, row, part.width - 8, 3)
      }
    }
  }
}

function drawRobot(ctx: CanvasRenderingContext2D, run: Run, palette: Palette, reducedMotion: boolean, pointer: Point | null) {
  const airborne = run.y > 0 || run.falling
  const stride = !reducedMotion && !airborne && !run.over ? Math.sin(run.distance / 13) : 0
  const x = PLAYER_X
  const y = GROUND - PLAYER_HEIGHT - run.y
  const bob = reducedMotion || airborne ? 0 : Math.abs(stride)
  ctx.fillStyle = palette.muted
  ctx.globalAlpha = run.falling ? 0 : Math.max(0.08, 0.22 - run.y / 500)
  ctx.beginPath()
  ctx.ellipse(x + PLAYER_WIDTH / 2, GROUND + 3, 15 - run.y / 12, 2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  // Courier bot: antenna, visor, backpack, swinging arms and little boots.
  ctx.fillStyle = palette.accent
  ctx.fillRect(x + 7, y - 4 - bob, 2, 6)
  ctx.fillRect(x + 5, y - 6 - bob, 6, 3)
  ctx.fillRect(x + 1, y + 1 - bob, 26, 17)
  ctx.fillRect(x - 1, y + 6 - bob, 3, 7)
  ctx.fillRect(x + 27, y + 6 - bob, 2, 7)
  ctx.fillRect(x + 7, y + 19, 15, 9)
  ctx.fillRect(x + 2, y + 20, 4, 8)
  ctx.fillStyle = palette.background
  ctx.fillRect(x + 5, y + 5 - bob, 20, 9)
  const eyes = robotEyes(run, pointer, reducedMotion)
  for (const offset of [7, 17]) {
    const eyeX = x + offset
    const eyeY = y + 9.5 - eyes.height / 2 - bob
    ctx.fillStyle = palette.text
    ctx.strokeStyle = palette.text
    ctx.lineWidth = 1.5
    if (eyes.expression === 'dazed' || eyes.expression === 'happy') {
      ctx.beginPath()
      ctx.moveTo(eyeX, eyeY + 5)
      ctx.lineTo(eyeX + (eyes.expression === 'happy' ? 3 : 6), eyeY + 1)
      if (eyes.expression === 'dazed') ctx.moveTo(eyeX, eyeY + 1)
      ctx.lineTo(eyeX + 6, eyeY + 5)
      ctx.stroke()
    } else if (eyes.expression === 'blink') {
      ctx.fillRect(eyeX, y + 9 - bob, 6, 2)
    } else {
      ctx.fillRect(eyeX, eyeY, 6, eyes.height)
      ctx.fillStyle = palette.background
      ctx.fillRect(eyeX + 2 + eyes.x, eyeY + eyes.height / 2 - 1.5 + eyes.y, 2, 3)
    }
  }
  ctx.fillStyle = palette.text
  ctx.fillRect(x + 12, y + 21, 5, 2)
  ctx.fillStyle = palette.accent
  const front = airborne ? -3 : stride * 4
  const back = airborne ? 3 : -stride * 4
  ctx.fillRect(x + 10 + back, y + 28, 4, airborne ? 3 : 6)
  ctx.fillRect(x + 16 + front, y + 28, 4, airborne ? 4 : 6)
  ctx.fillRect(x + 9 + back, y + (airborne ? 30 : 32), 7, 2)
  ctx.fillRect(x + 15 + front, y + (airborne ? 31 : 32), 8, 2)
  ctx.fillRect(x + 23, y + 20 + (airborne ? -2 : stride * 2), 4, 6)
}
