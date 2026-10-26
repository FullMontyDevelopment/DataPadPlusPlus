import { GROUND } from './engine'
import type { Run } from './engine'
import type { Palette } from './draw'
import { POWER_RADIUS } from './effects'
import type { PowerKind } from './effects'

export function drawPowerups(ctx: CanvasRenderingContext2D, run: Run, palette: Palette, left: number, right: number) {
  for (const power of run.powerups) {
    const span = power.span ?? 0
    if (power.x + span + POWER_RADIUS < left || power.x - POWER_RADIUS > right) continue
    const y = GROUND - power.y
    ctx.fillStyle = palette.background
    ctx.fillRect(power.x - POWER_RADIUS, y - POWER_RADIUS, span + 2 * POWER_RADIUS, 2 * POWER_RADIUS)
    if (span > 0) {
      ctx.fillStyle = palette.accent
      ctx.globalAlpha = 0.18
      ctx.fillRect(power.x - POWER_RADIUS, y - POWER_RADIUS, span + 2 * POWER_RADIUS, 2 * POWER_RADIUS)
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = palette.accent
    ctx.lineWidth = 1.5
    ctx.strokeRect(power.x - POWER_RADIUS, y - POWER_RADIUS, span + 2 * POWER_RADIUS, 2 * POWER_RADIUS)
    ctx.fillStyle = palette.accent
    const segments = Math.ceil(span / 48)
    for (let index = 0; index <= segments; index++) {
      const x = power.x + (segments > 0 ? span * index / segments : 0)
      if (x + POWER_RADIUS >= left && x - POWER_RADIUS <= right) drawGlyph(ctx, power.kind, x, y)
    }
  }
}

function drawGlyph(ctx: CanvasRenderingContext2D, kind: PowerKind, x: number, y: number) {
  ctx.beginPath()
  if (kind === 'reverse') {
    ctx.moveTo(x + 6, y - 3); ctx.lineTo(x - 6, y - 3)
    ctx.lineTo(x - 2, y - 7); ctx.moveTo(x - 6, y + 3)
    ctx.lineTo(x + 6, y + 3); ctx.lineTo(x + 2, y + 7)
    ctx.stroke()
  } else if (kind === 'boost') {
    ctx.moveTo(x + 2, y - 7); ctx.lineTo(x - 5, y + 1)
    ctx.lineTo(x, y + 1); ctx.lineTo(x - 2, y + 7)
    ctx.lineTo(x + 5, y - 1); ctx.lineTo(x, y - 1)
    ctx.fill()
  } else {
    ctx.fillRect(x - 6, y, 3, 7)
    ctx.fillRect(x - 1, y - 4, 3, 11)
    ctx.fillRect(x + 4, y - 7, 3, 14)
  }
}
