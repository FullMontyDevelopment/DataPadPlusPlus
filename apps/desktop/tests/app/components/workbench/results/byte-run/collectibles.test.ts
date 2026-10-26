import { describe, expect, it } from 'vitest'
import { advance, BYTE_RADIUS, createRun as createFullRun, EXTREME_AFTER_SECONDS, jump, MAX_BYTES, MAX_BYTE_INTERVAL, MAX_SPEED, MIN_BYTE_INTERVAL, PLAYER_WIDTH, PLAYER_X, STEP_SECONDS, WORLD_WIDTH } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'
import type { Run } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'

function createRun(seed = 1) {
  const run = createFullRun(seed)
  run.nextPowerAt = Infinity // Test ordinary prizes independently of special effects.
  return run
}

function play(run: Run, seconds: number, greedy = false, hz = 120) {
  const hazards: string[] = []
  const pickups: { time: number; x: number; y: number }[] = []
  let population = 0
  for (let frame = 0; frame < seconds * hz && !run.over; frame++) {
    const hazard = run.obstacles.find(item => item.x + item.width > PLAYER_X)
    const byte = run.bytes.find(item => item.x > PLAYER_X)
    const eta = byte ? (byte.x - PLAYER_X - PLAYER_WIDTH / 2) / run.speed : Infinity
    const waitsForGroundPrize = greedy && byte && byte.y < 30 && eta > 0 && eta < 0.55
    if (!waitsForGroundPrize && hazard && (hazard.x + hazard.width / 2 - PLAYER_X - PLAYER_WIDTH / 2) / run.speed < 0.33) jump(run)
    if (greedy && byte && byte.y > 40 && eta > 0 && eta < 0.33) jump(run)
    const next = run.nextObstacle
    const existing = new Set(run.bytes)
    advance(run, 1 / hz)
    if (run.nextObstacle !== next) hazards.push(JSON.stringify([run.distance, run.nextObstacle, run.obstacles.at(-1)]))
    for (const prize of run.bytes) if (!existing.has(prize)) pickups.push({ time: run.elapsed, ...prize })
    population = Math.max(population, run.bytes.length)
  }
  return { hazards, pickups, population }
}

describe('sparse, optional Byte Run collectibles', () => {
  it('randomizes time and height independently of speed, with ground, middle and high prizes', () => {
    function samples(seed: number, distance: number) {
      const run = createRun(seed)
      run.distance = distance
      run.nextObstacle = Infinity
      const values: { delay: number; y: number }[] = []
      for (let i = 0; i < 500; i++) {
        const delay = run.nextByteAt - run.elapsed
        expect(delay).toBeGreaterThanOrEqual(MIN_BYTE_INTERVAL)
        expect(delay).toBeLessThanOrEqual(MAX_BYTE_INTERVAL)
        run.elapsed = run.nextByteAt
        run.bytes = []
        advance(run, STEP_SECONDS)
        expect(run.bytes).toHaveLength(1)
        const byte = run.bytes[0]!
        expect(byte.x - BYTE_RADIUS).toBeGreaterThanOrEqual(WORLD_WIDTH)
        expect(byte.y).toBeGreaterThan(BYTE_RADIUS)
        expect(byte.y).toBeLessThan(100)
        values.push({ delay, y: byte.y })
      }
      return values
    }
    const values = samples(37, 0)
    expect(samples(37, 100_000)).toEqual(values)
    expect(samples(38, 0)).not.toEqual(values)
    expect(values.filter(value => value.y < 30).length).toBeGreaterThan(150)
    expect(values.filter(value => value.y >= 50 && value.y < 78).length).toBeGreaterThan(130)
    expect(values.filter(value => value.y >= 82).length).toBeGreaterThan(90)
    expect(new Set(values.map(value => value.y.toFixed(2))).size).toBeGreaterThan(400)
    expect(Math.max(...values.map(value => value.delay)) - Math.min(...values.map(value => value.delay))).toBeGreaterThan(6)
  })

  it('spawns far fewer prizes than obstacles, without preventing survival when ignored', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const run = createRun(seed * 137)
      const { pickups, hazards, population } = play(run, 90)
      expect(run.over).toBe(false)
      expect(pickups.length).toBeGreaterThan(5)
      expect(pickups.length).toBeLessThan(hazards.length * 0.3)
      expect(pickups[0]!.time).toBeGreaterThanOrEqual(MIN_BYTE_INTERVAL)
      for (let i = 1; i < pickups.length; i++) expect(pickups[i]!.time - pickups[i - 1]!.time).toBeGreaterThanOrEqual(MIN_BYTE_INTERVAL)
      expect(population).toBeLessThanOrEqual(MAX_BYTES)
    }
  })

  it('does not change hazard randomness or difficulty when pickups are disabled or skipped', () => {
    const enabled = createRun(317)
    const disabled = createRun(317)
    disabled.nextByteAt = Infinity
    const withPickups = play(enabled, 150)
    const withoutPickups = play(disabled, 150)
    expect(withPickups.pickups.length).toBeGreaterThan(0)
    expect(withoutPickups.pickups).toHaveLength(0)
    expect(withPickups.hazards).toEqual(withoutPickups.hazards)
    expect(enabled.seed).toBe(disabled.seed)
    expect(enabled.distance).toBe(disabled.distance)
    expect(enabled.speed).toBe(disabled.speed)
    expect(enabled.over).toBe(false)
  })

  it('allows ground collection without jumping, but jumping over it does not award it', () => {
    const grounded = createRun(17)
    grounded.nextObstacle = Infinity
    grounded.bytes = [{ x: PLAYER_X + 14, y: BYTE_RADIUS + 3 }]
    advance(grounded, STEP_SECONDS)
    expect(grounded.collected).toBe(1)
    expect(grounded.bonus).toBe(10)
    advance(grounded, STEP_SECONDS)
    expect(grounded.collected).toBe(1)

    const airborne = createRun(17)
    airborne.nextObstacle = Infinity
    jump(airborne)
    advance(airborne, 0.1)
    airborne.bytes = [{ x: PLAYER_X + 14, y: BYTE_RADIUS + 3 }]
    for (let i = 0; i < 120; i++) advance(airborne, STEP_SECONDS)
    expect(airborne.collected).toBe(0)
    expect(airborne.over).toBe(false)
  })

  it('keeps risky prizes offscreen when introduced and outside solid obstacle silhouettes', () => {
    let lowPrizesBehindHazard = 0
    for (let seed = 1; seed <= 100; seed++) {
      const run = createRun(seed)
      Object.assign(run, { distance: 100_000, elapsed: EXTREME_AFTER_SECONDS, nextObstacle: Infinity, nextByteAt: 0 })
      run.obstacles = [{ kind: 'tower', x: WORLD_WIDTH - 5, width: 28, height: 68 }]
      advance(run, STEP_SECONDS)
      expect(run.bytes).toHaveLength(1)
      const byte = run.bytes[0]!
      const hazard = run.obstacles[0]!
      expect(byte.x - BYTE_RADIUS).toBeGreaterThanOrEqual(WORLD_WIDTH)
      expect(byte.x + BYTE_RADIUS > hazard.x && byte.x - BYTE_RADIUS < hazard.x + hazard.width && byte.y - BYTE_RADIUS < hazard.height).toBe(false)
      if (byte.y < 30) {
        lowPrizesBehindHazard++
        expect(byte.x - BYTE_RADIUS - hazard.x - hazard.width).toBeLessThan(40)
      }
    }
    expect(lowPrizesBehindHazard).toBeGreaterThan(25)
  })

  it('skips low pickups when an imminent obstacle would appear on top of them', () => {
    let skipped = 0
    for (let seed = 1; seed <= 100; seed++) {
      const run = createRun(seed)
      Object.assign(run, { distance: 100_000, elapsed: EXTREME_AFTER_SECONDS, nextObstacle: 100_010, nextByteAt: 0 })
      advance(run, STEP_SECONDS)
      if (!run.bytes.length) skipped++
      else expect(run.bytes[0]!.y - BYTE_RADIUS).toBeGreaterThanOrEqual(68)
      expect(run.nextByteAt - run.elapsed).toBeGreaterThanOrEqual(MIN_BYTE_INTERVAL)
    }
    expect(skipped).toBeGreaterThan(40)
  })

  it('creates genuine temptations: greedy chasing can fail where ignoring prizes survives', () => {
    let greedyCrashes = 0
    for (let seed = 1; seed <= 30; seed++) {
      for (const greedy of [false, true]) {
        const run = createRun(seed * 137)
        Object.assign(run, { distance: 100_000, elapsed: EXTREME_AFTER_SECONDS, speed: MAX_SPEED, nextObstacle: 100_100, nextByteAt: 184 })
        play(run, 60, greedy)
        if (greedy && run.over) greedyCrashes++
        if (!greedy) expect(run.over).toBe(false)
      }
    }
    expect(greedyCrashes).toBeGreaterThan(20)
  })

  it('caps active pickups, schedules no catch-up burst and resets scheduling on restart', () => {
    const run = createRun(71)
    const initial = structuredClone(run)
    run.nextObstacle = Infinity
    run.nextByteAt = 0
    run.bytes = Array.from({ length: MAX_BYTES }, (_, i) => ({ x: 2000 + i * 50, y: 90 }))
    advance(run, STEP_SECONDS)
    expect(run.bytes).toHaveLength(MAX_BYTES)
    expect(run.nextByteAt - run.elapsed).toBeGreaterThanOrEqual(MIN_BYTE_INTERVAL)
    run.bytes = []
    advance(run, 60)
    expect(run.bytes).toHaveLength(0)
    expect(createRun(71)).toEqual(initial)
  })

  it('produces the same pickup positions and schedules at 30, 60 and 144 Hz', () => {
    const runs = [30, 60, 144].map(hz => {
      const run = createRun(41)
      run.nextObstacle = Infinity
      for (let frame = 0; frame < hz * 60; frame++) advance(run, 1 / hz)
      return run
    })
    for (const run of runs.slice(1)) {
      expect(run.bytes).toEqual(runs[0]!.bytes)
      expect(run.collected).toBe(runs[0]!.collected)
      expect(run.bonus).toBe(runs[0]!.bonus)
      expect(run.nextByteAt).toBeCloseTo(runs[0]!.nextByteAt, 8)
      expect(run.byteSeed).toBe(runs[0]!.byteSeed)
    }
  })
})
