import { describe, expect, it, vi } from 'vitest'
import { drawRun } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/draw'
import { applyPowerup, BYTE_RADIUS, createRun, GROUND, MAX_SPEED, OBSTACLE_TYPES, PLAYER_X, PLAYER_WIDTH, START_SPEED } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'
import type { ObstacleKind } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'
import { drawPowerups } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/draw-powerups'
import { BOOST_MULTIPLIER, POWER_RADIUS } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/effects'

const palette = { text: '#ddd', muted: '#888', accent: '#49f', background: '#222' }
function context() {
  const calls: unknown[][] = []
  const methods = ['setTransform', 'clearRect', 'translate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'strokeRect', 'fillRect', 'ellipse', 'fill', 'fillText']
  const ctx = Object.fromEntries(methods.map(name => [name, vi.fn((...args: unknown[]) => calls.push([name, ...args]))]))
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

describe('Byte Run artwork', () => {
  it('keeps the camera scale and position fixed as pace increases, boosts and returns to normal', () => {
    for (const [width, height] of [[280, 120], [360, 700], [720, 180], [1600, 300]]) {
      for (const direction of [1, -1] as const) for (const shift of [0, 0.5, 1]) {
        for (const reduced of [false, true]) {
          const run = createRun()
          run.direction = direction; run.screenShift = shift
          let baseline: unknown[][] | undefined
          for (const speed of [START_SPEED, MAX_SPEED, MAX_SPEED * BOOST_MULTIPLIER, MAX_SPEED]) {
            run.speed = speed
            const { ctx, calls } = context()
            drawRun(ctx, run, width!, height!, 2, palette, reduced)
            const transforms = calls.filter(call => ['setTransform', 'translate', 'scale'].includes(call[0] as string))
            if (!baseline) baseline = transforms
            else expect(transforms, `${width}x${height}, direction=${direction}, speed=${speed}`).toEqual(baseline)
          }
        }
      }
    }
  })

  it('draws the entire ground-level collection footprint, including a partially scrolled trail', () => {
    const run = createRun()
    run.powerups = [{ x: -100, y: POWER_RADIUS, span: 300, kind: 'reverse' },
      { x: 260, y: POWER_RADIUS, kind: 'boost' }, { x: 350, y: POWER_RADIUS, span: 250, kind: 'barriers' }]
    const before = structuredClone(run)
    const { ctx, calls } = context()
    drawPowerups(ctx, run, palette, 0, 720)
    expect(ctx.strokeRect).toHaveBeenCalledWith(-110, GROUND - 20, 320, 20)
    expect(ctx.strokeRect).toHaveBeenCalledWith(250, GROUND - 20, 20, 20)
    expect(ctx.strokeRect).toHaveBeenCalledWith(340, GROUND - 20, 270, 20)
    expect(ctx.fillRect).toHaveBeenCalledWith(-110, GROUND - 20, 320, 20)
    expect(ctx.globalAlpha).toBe(1)
    expect(calls.length).toBeLessThan(150)
    expect(run).toEqual(before)
  })

  it('does not draw a trail once its entire footprint leaves the viewport', () => {
    const run = createRun()
    run.powerups = [{ x: -311, y: POWER_RADIUS, span: 300, kind: 'boost' }]
    const { ctx, calls } = context()
    drawPowerups(ctx, run, palette, 0, 720)
    expect(calls).toHaveLength(0)
  })

  it('mirrors the scene but not feedback text, draws distinct powers, and exposes the world edge', () => {
    const run = createRun()
    run.distance = 100
    applyPowerup(run, 'reverse')
    run.powerups = [{ x: 100, y: POWER_RADIUS, kind: 'reverse' }, { x: 200, y: POWER_RADIUS, kind: 'boost' }, { x: 300, y: POWER_RADIUS, kind: 'barriers' }]
    const { ctx } = context()
    drawRun(ctx, run, 720, 180, 1, palette, true)
    expect(ctx.translate).toHaveBeenCalledWith(720, 0) // No animated shift with reduced motion.
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1)
    expect(ctx.fillText).toHaveBeenCalledWith('Reverse −50', 360, 26)
    expect(ctx.lineTo).toHaveBeenCalledWith(PLAYER_X + PLAYER_WIDTH / 2 + 100, GROUND + 22)
    expect(ctx.strokeRect).toHaveBeenCalledWith(90, GROUND - 20, 20, 20)
    expect(ctx.strokeRect).toHaveBeenCalledWith(190, GROUND - 20, 20, 20)
    expect(ctx.strokeRect).toHaveBeenCalledWith(290, GROUND - 20, 20, 20)
    run.falling = true; run.y = -100
    expect(() => drawRun(ctx, run, 300, 180, 1, palette, false)).not.toThrow()
  })
  it('keeps the character readable in narrow docks without mutating gameplay', () => {
    const run = createRun(11)
    const before = structuredClone(run)
    const { ctx } = context()
    drawRun(ctx, run, 360, 700, 2, palette, false)
    expect(ctx.scale).toHaveBeenCalledWith(0.75, 0.75)
    expect(run).toEqual(before)
  })

  it('draws all obstacle silhouettes, running, jumping and collision poses without external assets', () => {
    const run = createRun()
    run.obstacles = Object.entries(OBSTACLE_TYPES).map(([kind, spec], index) => ({
      kind: kind as ObstacleKind, ...spec, x: 150 + index * 110,
    }))
    const frames: unknown[][][] = []
    for (const pose of [{ distance: 24, y: 0, over: false }, { distance: 37, y: 0, over: false },
      { distance: 40, y: 60, over: false }, { distance: 44, y: 0, over: true }]) {
      Object.assign(run, pose)
      const { ctx, calls } = context()
      drawRun(ctx, run, 720, 180, 1, palette, false)
      expect(calls.length).toBeLessThan(250)
      expect(ctx.globalAlpha).toBe(1)
      expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0)
      frames.push(calls)
    }
    expect(frames[0]).not.toEqual(frames[1])
    expect(frames[1]).not.toEqual(frames[2])
    expect(frames[2]).not.toEqual(frames[3])
  })

  it('keeps decorative scenery and running motion still in reduced-motion mode', () => {
    const run = createRun()
    const first = context(); const second = context()
    run.distance = 450
    drawRun(first.ctx, run, 720, 180, 1, palette, true)
    run.distance = 900
    drawRun(second.ctx, run, 720, 180, 1, palette, true)
    expect(second.calls).toEqual(first.calls)
    run.y = 40
    const jump = context()
    drawRun(jump.ctx, run, 720, 180, 1, palette, true)
    expect(jump.calls).not.toEqual(first.calls)
  })

  it('draws pointer-aware eyes and small pickup feedback without a scarf or extra HUD', () => {
    const run = createRun()
    const left = context(); const right = context()
    drawRun(left.ctx, run, 720, 180, 1, palette, false, { x: -50, y: 20 })
    drawRun(right.ctx, run, 720, 180, 1, palette, false, { x: 700, y: 170 })
    expect(left.calls).not.toEqual(right.calls)
    // The removed scarf was a translucent 16x3 rectangle behind the head.
    expect(left.calls.some(call => call[0] === 'fillRect' && call[3] === 16 && call[4] === 3)).toBe(false)
    run.pickupFeedback = 0.4; run.lastBonus = 30
    run.bytes = [{ x: 250, y: 90 }]
    const reward = context()
    drawRun(reward.ctx, run, 720, 180, 1, palette, true)
    expect(reward.ctx.fillText).toHaveBeenCalledWith('+30', expect.any(Number), expect.any(Number))
    expect(reward.ctx.globalAlpha).toBe(1)
  })

  it('renders ground and airborne prizes above the track in both dock layouts', () => {
    const run = createRun()
    run.bytes = [{ x: 200, y: BYTE_RADIUS + 3 }, { x: 300, y: 60 }, { x: 400, y: 99 }]
    const before = structuredClone(run)
    for (const [width, height] of [[720, 180], [300, 700]]) {
      const { ctx } = context()
      drawRun(ctx, run, width!, height!, 2, palette, true)
      for (const byte of run.bytes) {
        expect(ctx.moveTo).toHaveBeenCalledWith(byte.x, GROUND - byte.y - BYTE_RADIUS)
        expect(ctx.lineTo).toHaveBeenCalledWith(byte.x, GROUND - byte.y + BYTE_RADIUS)
        expect(GROUND - byte.y + BYTE_RADIUS).toBeLessThan(GROUND)
      }
    }
    expect(run).toEqual(before)
  })
})
