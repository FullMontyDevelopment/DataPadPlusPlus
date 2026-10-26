import { describe, expect, it } from 'vitest'
import { advance, applyPowerup, createRun, jump, MAX_SPEED, PLAYER_WIDTH, PLAYER_X, score, STEP_SECONDS, WORLD_HEIGHT, WORLD_WIDTH, worldPosition } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'
import type { Run } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'
import { activeEffects, BARRIER_SECONDS, BOOST_MULTIPLIER, BOOST_SECONDS, choosePowerup, MAX_POWERUPS, POWER_RADIUS, REVERSE_PENALTY } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/effects'

function isolated(seed = 71) {
  const run = createRun(seed)
  run.nextObstacle = Infinity
  run.nextByteAt = Infinity
  run.nextPowerAt = Infinity
  return run
}
function stepFor(run: Run, seconds: number, hz = 120) {
  for (let i = 0; i < seconds * hz && !run.over; i++) advance(run, 1 / hz)
}
function dodge(run: Run) {
  const next = run.obstacles.find(item => item.x + item.width > PLAYER_X)
  if (next && (next.x + next.width / 2 - PLAYER_X - PLAYER_WIDTH / 2) / run.speed < 0.33) jump(run)
}

describe('Byte Run special pickups', () => {
  it('collects a reverse once, deducts points and then runs the score backwards', () => {
    const run = isolated()
    run.distance = 10_000
    run.powerups = [{ kind: 'reverse', x: PLAYER_X + 14, y: POWER_RADIUS }]
    advance(run, STEP_SECONDS)
    expect(run.direction).toBe(-1)
    expect(run.powerups).toHaveLength(0)
    expect(run.penalty).toBe(REVERSE_PENALTY)
    expect(run.peakScore).toBeGreaterThanOrEqual(1000)
    const position = worldPosition(run)
    const points = score(run)
    stepFor(run, 0.5)
    expect(worldPosition(run)).toBeLessThan(position)
    expect(score(run)).toBeLessThan(points)
    expect(run.screenShift).toBe(1)
    const remainingPosition = worldPosition(run)
    applyPowerup(run, 'reverse')
    expect(worldPosition(run)).toBe(remainingPosition)
    expect(run.penalty).toBe(REVERSE_PENALTY) // Correcting it has no second penalty.
    expect(run.direction).toBe(1)
    stepFor(run, 0.5)
    expect(run.screenShift).toBe(0)
    expect(worldPosition(run)).toBeGreaterThan(remainingPosition)
  })

  it('moves existing objects behind the turn instead of teleporting them onto the player', () => {
    const run = isolated()
    run.distance = 1000
    run.obstacles = [{ kind: 'crate', x: 200, width: 28, height: 28 }]
    run.bytes = [{ x: 300, y: 60 }]
    applyPowerup(run, 'reverse')
    expect(run.obstacles).toHaveLength(0)
    expect(run.bytes).toHaveLength(0)
    expect(run.nextObstacle).toBeGreaterThan(run.distance)
    advance(run, STEP_SECONDS)
    expect(run.over).toBe(false)
  })

  it('offers substantially more reverse pickups and shorter waits when running backwards', () => {
    const counts = { forward: 0, backward: 0 }
    for (let i = 0; i < 1000; i++) {
      if (choosePowerup(i / 1000, false) === 'reverse') counts.forward++
      if (choosePowerup(i / 1000, true) === 'reverse') counts.backward++
    }
    expect(counts.backward).toBe(850)
    expect(counts.backward).toBeGreaterThan(counts.forward * 2)
    for (let seed = 1; seed <= 100; seed++) {
      const run = createRun(seed)
      expect(run.nextPowerAt).toBeGreaterThanOrEqual(12)
      expect(run.nextPowerAt).toBeLessThan(24)
      run.distance = 10_000
      applyPowerup(run, 'reverse')
      expect(run.nextPowerAt - run.elapsed).toBeGreaterThanOrEqual(1.5)
      expect(run.nextPowerAt - run.elapsed).toBeLessThan(3.5)
      run.nextObstacle = Infinity
      run.elapsed = run.nextPowerAt
      advance(run, STEP_SECONDS)
      expect(run.powerups).toHaveLength(1)
      expect(run.powerups[0]!.x - POWER_RADIUS).toBeGreaterThanOrEqual(WORLD_WIDTH)
      expect(run.powerups[0]!.y).toBe(POWER_RADIUS)
    }
  })

  it('falls off the start, cannot jump out or collect a rescue after falling, and ends the run', () => {
    const run = isolated()
    run.distance = 10
    applyPowerup(run, 'reverse')
    stepFor(run, 0.1)
    expect(worldPosition(run)).toBe(0)
    expect(run.falling).toBe(true)
    expect(run.over).toBe(false)
    jump(run)
    expect(run.velocity).toBeLessThanOrEqual(0)
    applyPowerup(run, 'reverse')
    expect(run.direction).toBe(-1)
    stepFor(run, 1)
    expect(run.over).toBe(true)
    expect(run.y).toBeLessThan(-WORLD_HEIGHT)
    expect(score(run)).toBe(0)
    expect(run.powerups).toHaveLength(0)
  })

  it('boosts speed temporarily without stacking multipliers or letting timers advance while paused', () => {
    const run = isolated()
    run.distance = 100_000
    applyPowerup(run, 'boost')
    advance(run, STEP_SECONDS)
    expect(run.speed).toBe(MAX_SPEED * BOOST_MULTIPLIER)
    const remaining = run.boostRemaining
    advance(run, 0)
    expect(run.boostRemaining).toBe(remaining)
    applyPowerup(run, 'boost')
    expect(run.boostRemaining).toBe(BOOST_SECONDS)
    stepFor(run, BOOST_SECONDS + 0.1)
    expect(run.boostRemaining).toBe(0)
    expect(run.speed).toBe(MAX_SPEED)
  })

  it('raises only newly spawned barriers and stops generating them when the effect expires', () => {
    const run = isolated()
    const existing = { kind: 'crate' as const, x: 300, width: 28, height: 28 }
    run.obstacles = [existing]
    applyPowerup(run, 'barriers')
    run.nextObstacle = 0
    advance(run, STEP_SECONDS)
    expect(existing.height).toBe(28)
    expect(run.obstacles.at(-1)).toMatchObject({ kind: 'tower' })
    expect(run.obstacles.at(-1)!.height).toBeGreaterThanOrEqual(64)
    run.obstacles = []
    run.nextObstacle = Infinity
    stepFor(run, BARRIER_SECONDS + 0.1)
    expect(run.barriersRemaining).toBe(0)
    run.nextObstacle = run.distance
    advance(run, STEP_SECONDS)
    expect(run.obstacles.at(-1)!.height).toBeLessThan(64)
  })

  it('keeps tall barriers jumpable at introductory, peak and boosted speeds', () => {
    for (const distance of [0, 100_000]) for (const boost of [false, true]) {
      const run = isolated()
      run.distance = distance
      applyPowerup(run, 'barriers')
      if (boost) applyPowerup(run, 'boost')
      run.nextObstacle = run.distance
      advance(run, STEP_SECONDS)
      const obstacle = run.obstacles[0]!
      run.nextObstacle = Infinity
      obstacle.x = PLAYER_X + PLAYER_WIDTH / 2 - obstacle.width / 2 + run.speed * 0.33 / (boost ? BOOST_MULTIPLIER : 1)
      jump(run)
      stepFor(run, 1)
      expect(run.over, `${distance}/${boost}`).toBe(false)
    }
  })

  it('boosts jump timing with travel rather than making a previously jumpable obstacle unreachable', () => {
    for (const boostAt of [0, 0.1, 0.25, 0.4]) {
      const run = isolated()
      run.distance = 100_000
      run.obstacles = [{ kind: 'tower', x: PLAYER_X + PLAYER_WIDTH / 2 - 12 + MAX_SPEED * 0.33, width: 24, height: 68 }]
      jump(run)
      stepFor(run, boostAt)
      applyPowerup(run, 'boost')
      stepFor(run, 1)
      expect(run.over, `boost at ${boostAt}`).toBe(false)
    }
  })

  it('can combine effects, preserves collision priority and resets everything for a new run', () => {
    const run = isolated()
    run.distance = 100_000
    applyPowerup(run, 'reverse')
    applyPowerup(run, 'boost')
    applyPowerup(run, 'barriers')
    expect(activeEffects(run)).toBe('Reverse · Speed boost · Tall barriers')
    run.powerups = [{ kind: 'reverse', x: PLAYER_X + 14, y: POWER_RADIUS }]
    run.obstacles = [{ kind: 'tower', x: PLAYER_X, width: 24, height: 68 }]
    advance(run, STEP_SECONDS)
    expect(run.over).toBe(true)
    expect(run.direction).toBe(-1)
    const fresh = createRun()
    expect(activeEffects(fresh)).toBe('')
    expect(fresh.retreat).toBe(0)
    expect(fresh.penalty).toBe(0)
    expect(fresh.screenShift).toBe(0)
    expect(fresh.falling).toBe(false)
  })

  it('bounds special-pickup population and keeps their random stream separate from obstacles', () => {
    const a = isolated(119)
    const b = isolated(119)
    a.nextObstacle = b.nextObstacle = 0
    a.nextPowerAt = 0
    a.powerups = Array.from({ length: MAX_POWERUPS }, () => ({ kind: 'boost', x: 10_000, y: POWER_RADIUS }))
    advance(a, STEP_SECONDS)
    advance(b, STEP_SECONDS)
    expect(a.powerups).toHaveLength(MAX_POWERUPS)
    expect(a.obstacles).toEqual(b.obstacles)
    expect(a.seed).toBe(b.seed)
    expect(a.nextPowerAt).toBeGreaterThan(a.elapsed)
  })

  it('is deterministic across frame rates through reversal, boost expiry and correction', () => {
    const runs = [30, 60, 144].map(hz => {
      const run = isolated(19)
      run.distance = 100_000
      applyPowerup(run, 'reverse')
      applyPowerup(run, 'boost')
      run.nextObstacle = run.nextPowerAt = Infinity
      stepFor(run, 4, hz)
      applyPowerup(run, 'reverse')
      run.nextObstacle = run.nextPowerAt = Infinity
      stepFor(run, 6, hz)
      return run
    })
    for (const run of runs.slice(1)) {
      expect(worldPosition(run)).toBeCloseTo(worldPosition(runs[0]!), 8)
      expect(score(run)).toBe(score(runs[0]!))
      expect(run.boostRemaining).toBe(0)
      expect(run.direction).toBe(1)
    }
  })

  it('runs the integrated generator with all pickup types without unbounded state', () => {
    const seen = new Set<string>()
    let reversed = false
    let trailSeen = false
    let singleSeen = false
    for (let seed = 1; seed <= 40; seed++) {
      const run = createRun(seed * 137)
      for (let i = 0; i < 120 * 120 && !run.over; i++) {
        dodge(run)
        advance(run, STEP_SECONDS)
        for (const power of run.powerups) {
          seen.add(power.kind)
          if (power.span! > 0) trailSeen = true
          else singleSeen = true
        }
        if (run.direction === -1) reversed = true
        if (run.powerups.length > MAX_POWERUPS) throw new Error('Unbounded powerups')
        if (!Number.isFinite(score(run))) throw new Error('Invalid score')
      }
    }
    expect([...seen].sort()).toEqual(['barriers', 'boost', 'reverse'])
    expect(reversed).toBe(true)
    expect(trailSeen).toBe(true)
    expect(singleSeen).toBe(true)
  })
})
