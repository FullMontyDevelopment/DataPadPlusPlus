import { describe, expect, it } from 'vitest'
import { createRun, MAX_SPEED, PLAYER_WIDTH, PLAYER_X } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'
import { pointerInWorld, robotEyes, sceneTransform, viewport } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/presentation'

describe('robot personality and pointer coordinates', () => {
  it('keeps reversed pointer tracking aligned throughout the camera shift and narrow layouts', () => {
    for (const width of [280, 720, 1600]) for (const shift of [0, 0.5, 1]) {
      const view = viewport(width, 240)
      const scene = sceneTransform(view.visibleWidth, -1, shift)
      const point = pointerInWorld({ x: view.x + (scene.x - 99) * view.scale, y: view.y + 80 * view.scale }, width, 240, -1, shift)!
      expect(point.x).toBeCloseTo(99, 8)
      expect(point.y).toBeCloseTo(80, 8)
      if (shift === 1) expect(scene.x - PLAYER_X - PLAYER_WIDTH).toBe(view.visibleWidth - PLAYER_X - PLAYER_WIDTH)
    }
  })
  it('maps pointer positions through letterboxing and resized narrow/wide cameras', () => {
    for (const [width, height] of [[280, 120], [360, 700], [900, 250], [1600, 300]]) {
      const view = viewport(width!, height!)
      const point = pointerInWorld({ x: view.x + 99 * view.scale, y: view.y + 80 * view.scale }, width!, height!)!
      expect(point.x).toBeCloseTo(99, 10)
      expect(point.y).toBeCloseTo(80, 10)
      expect(view.visibleWidth).toBeGreaterThanOrEqual(480)
      expect(view.visibleWidth * view.scale).toBeLessThanOrEqual(width!)
      expect(180 * view.scale).toBeLessThanOrEqual(height!)
    }
    expect(pointerInWorld({ x: 20, y: 40 }, 0, 0)).toBeNull()
    expect(pointerInWorld({ x: NaN, y: 40 }, 900, 250)).toBeNull()
  })

  it('follows the pointer in both axes with pupils bounded inside the eyes', () => {
    const run = createRun()
    const before = structuredClone(run)
    const left = robotEyes(run, { x: -2000, y: -2000 }, false)
    const right = robotEyes(run, { x: 2000, y: 2000 }, false)
    expect(left.x).toBe(-1.7)
    expect(right.x).toBe(1.7)
    expect(left.y).toBe(-2)
    expect(right.y).toBe(2)
    expect(robotEyes(run, { x: -2000, y: -2000 }, true)).toEqual(left)
    expect(run).toEqual(before)
  })

  it('uses distinct jump, landing, pickup, danger and collision expressions', () => {
    const run = createRun()
    expect(robotEyes(run, null, false).expression).toBe('neutral')
    run.y = 30; run.velocity = 200
    expect(robotEyes(run, null, false)).toMatchObject({ expression: 'surprised', y: -1 })
    run.velocity = -200
    expect(robotEyes(run, null, false)).toMatchObject({ expression: 'focused', y: 1 })
    run.y = 0; run.landed = 0.1
    expect(robotEyes(run, null, false).expression).toBe('blink')
    run.landed = 0
    run.obstacles = [{ x: 100, width: 28, height: 28, kind: 'crate' }]
    expect(robotEyes(run, null, false).expression).toBe('surprised')
    run.pickupFeedback = 0.3
    expect(robotEyes(run, null, false).expression).toBe('happy')
    run.over = true
    expect(robotEyes(run, { x: 30, y: 40 }, false).expression).toBe('dazed')
  })

  it('keeps decorative blinking out of reduced-motion and active pointer tracking', () => {
    const run = createRun()
    run.elapsed = 3.85
    expect(robotEyes(run, null, false).expression).toBe('blink')
    expect(robotEyes(run, null, true).expression).toBe('neutral')
    expect(robotEyes(run, { x: 30, y: 40 }, false).expression).toBe('neutral')
    run.speed = MAX_SPEED
    expect(robotEyes(run, { x: 30, y: 40 }, false).expression).toBe('focused')
  })
})
