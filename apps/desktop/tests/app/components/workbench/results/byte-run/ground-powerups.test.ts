import { describe, expect, it } from 'vitest'
import { advance, applyPowerup, createRun, jump, MAX_SPEED, PLAYER_WIDTH, PLAYER_X, STEP_SECONDS, WORLD_WIDTH } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'
import type { Run } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'
import { BOOST_MULTIPLIER, POWER_RADIUS, REVERSE_PENALTY } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/effects'
import type { PowerKind } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/effects'

function isolated(seed = 1) {
  const run = createRun(seed)
  run.nextObstacle = run.nextByteAt = run.nextPowerAt = Infinity
  return run
}

function generated(seed: number, distance = 0, reversed = false) {
  const run = isolated(seed)
  run.distance = distance
  if (reversed) applyPowerup(run, 'reverse')
  run.nextObstacle = Infinity
  run.nextPowerAt = 0
  advance(run, STEP_SECONDS)
  run.nextPowerAt = Infinity
  return run
}

function trail(distance = 0) {
  for (let seed = 1; seed <= 100; seed++) {
    const run = generated(seed, distance)
    if (run.powerups[0]!.span! > 0) return run
  }
  throw new Error('No trail generated')
}

function stepFor(run: Run, seconds: number) {
  for (let i = 0; i < seconds / STEP_SECONDS && !run.over; i++) advance(run, STEP_SECONDS)
}

describe('ground-level special pickups', () => {
  it('grounds every kind in both directions, with mostly single icons and occasional trails', () => {
    for (const reversed of [false, true]) {
      const kinds = new Set<PowerKind>()
      let trails = 0
      for (let seed = 1; seed <= 1000; seed++) {
        const run = generated(seed, 10_000, reversed)
        const power = run.powerups[0]!
        expect(power.y - POWER_RADIUS).toBe(0)
        expect(power.x - POWER_RADIUS).toBeGreaterThanOrEqual(WORLD_WIDTH)
        if (power.span! > 0) trails++
        kinds.add(power.kind)
      }
      expect([...kinds].sort()).toEqual(['barriers', 'boost', 'reverse'])
      expect(trails).toBeGreaterThan(120)
      expect(trails).toBeLessThan(240)
    }
  })

  it('lets a well-timed jump avoid every single-icon pickup at slow, fast and boosted speeds', () => {
    for (const kind of ['reverse', 'boost', 'barriers'] as const) {
      for (const distance of [0, 100_000]) for (const boosted of [false, true]) {
        const run = isolated()
        run.distance = distance
        if (boosted) applyPowerup(run, 'boost')
        advance(run, STEP_SECONDS)
        const control = structuredClone(run)
        run.powerups = [{ kind, y: POWER_RADIUS,
          x: PLAYER_X + PLAYER_WIDTH / 2 + run.speed * 0.33 / (boosted ? BOOST_MULTIPLIER : 1) }]
        jump(run); jump(control)
        stepFor(run, 1.2); stepFor(control, 1.2)
        expect(run.powerups).toHaveLength(0)
        expect(run.direction).toBe(control.direction)
        expect(run.penalty).toBe(control.penalty)
        expect(run.boostRemaining).toBe(control.boostRemaining)
        expect(run.barriersRemaining).toBe(control.barriersRemaining)
      }
    }
  })

  it('makes a trail unavoidable across jump timings, including continuous jumping and boost expiry', () => {
    for (const distance of [0, 100_000]) for (const boosted of [false, true]) {
      const original = trail(distance)
      for (let jumpAt = -1; jumpAt <= 120; jumpAt++) {
        const run = structuredClone(original)
        const power = run.powerups[0]!
        power.kind = 'barriers'
        // Approach a real generated trail; vary the jump by each simulation
        // step and repeatedly jump after landing to try to escape the effect.
        power.x = PLAYER_X + PLAYER_WIDTH + MAX_SPEED * 0.5
        if (boosted) { applyPowerup(run, 'boost'); run.boostRemaining = 0.65 }
        let collected = false
        for (let frame = 0; frame < 6 / STEP_SECONDS && !run.over; frame++) {
          if (jumpAt >= 0 && frame >= jumpAt) jump(run)
          advance(run, STEP_SECONDS)
          if (run.barriersRemaining > 0) { collected = true; break }
        }
        expect(collected, `distance=${distance}, boost=${boosted}, jump=${jumpAt}`).toBe(true)
        expect(run.powerups).toHaveLength(0)
        expect(run.over).toBe(false)
      }
    }
  })

  it('applies a whole trail only once, including reverse, and can collect its tail after the head leaves view', () => {
    for (const kind of ['reverse', 'boost', 'barriers'] as const) {
      const run = isolated()
      run.distance = 10_000
      run.powerups = [{ kind, x: -100, y: POWER_RADIUS, span: 250 }]
      advance(run, STEP_SECONDS)
      expect(run.powerups).toHaveLength(0)
      const direction = run.direction
      const boost = run.boostRemaining
      const barriers = run.barriersRemaining
      run.nextObstacle = run.nextPowerAt = Infinity
      stepFor(run, 0.1)
      expect(run.direction).toBe(direction)
      expect(run.penalty).toBe(kind === 'reverse' ? REVERSE_PENALTY : 0)
      expect(run.boostRemaining).toBeLessThanOrEqual(boost)
      expect(run.barriersRemaining).toBeLessThanOrEqual(barriers)
    }
  })

  it('falls back to a single icon in short gaps without moving hazards or extending past the world edge', () => {
    const original = trail()
    // Recreate the same RNG state just before its first spawn.
    const seed = Array.from({ length: 100 }, (_, index) => index + 1)
      .find(value => generated(value).powerups[0]!.span! > 0)
    expect(seed).toBeDefined()
    const run = isolated(seed)
    run.nextPowerAt = 0
    run.nextObstacle = 100
    advance(run, STEP_SECONDS)
    expect(run.powerups[0]).toMatchObject({ y: POWER_RADIUS, span: 0 })
    expect(run.nextObstacle).toBe(100)
    expect(original.powerups[0]!.span).toBeGreaterThan(100)

    for (let index = 1; index <= 100; index++) {
      const nearEdge = generated(index, WORLD_WIDTH + 160 - PLAYER_X - PLAYER_WIDTH / 2, true)
      expect(nearEdge.powerups[0]!.span).toBe(0)
    }
  })

  it('keeps the complete pickup footprint clear of current and forthcoming obstacles', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = isolated(seed)
      run.nextPowerAt = 0
      run.nextObstacle = seed * 3
      run.obstacles = [{ kind: 'barrier', x: WORLD_WIDTH, width: 54, height: 22 }]
      advance(run, STEP_SECONDS)
      for (const power of run.powerups) {
        expect(power.x - POWER_RADIUS).toBeGreaterThan(run.obstacles[0]!.x + 54)
        expect(power.x + power.span! + POWER_RADIUS).toBeLessThan(WORLD_WIDTH + run.nextObstacle - run.distance)
      }
    }
  })

  it('mirrors the entire trail and does not leak expired trailing segments', () => {
    const run = isolated()
    run.distance = 10_000
    run.powerups = [{ kind: 'boost', x: -150, y: POWER_RADIUS, span: 120 }]
    applyPowerup(run, 'reverse')
    expect(run.powerups[0]!.x).toBe(2 * PLAYER_X + PLAYER_WIDTH + 150 - 120)
    run.nextObstacle = run.nextPowerAt = Infinity
    run.powerups[0]!.x = -131
    advance(run, STEP_SECONDS)
    expect(run.powerups).toHaveLength(0)
  })
})
