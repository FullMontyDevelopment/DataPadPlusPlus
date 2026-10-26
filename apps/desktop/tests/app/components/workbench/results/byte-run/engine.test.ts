import { describe, expect, it } from 'vitest'
import { ACCELERATION_DISTANCE, advance, createRun as createFullRun, difficulty, EXTREME_AFTER_SECONDS, jump, JUMP_SECONDS, MAX_BYTES, MAX_OBSTACLES, MAX_SPEED, OBSTACLE_TYPES, obstacleParts, obstacleShape, PLAYER_WIDTH, PLAYER_X, score, stage, START_SPEED, STAGES, STEP_SECONDS, WORLD_WIDTH } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'
import type { ObstacleKind, Run } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'

// Baseline physics/difficulty contracts deliberately exclude optional effects.
// powerups.test.ts exercises the full game and effect interactions separately.
function createRun(seed = 1) {
  const run = createFullRun(seed)
  run.nextPowerAt = Infinity
  return run
}

function jumpAtCenter(run: Run, lead = 0.33) {
  const next = run.obstacles.find(item => item.x + item.width > PLAYER_X)
  if (next && (next.x + next.width / 2 - PLAYER_X - PLAYER_WIDTH / 2) / run.speed < lead) jump(run)
}

describe('Byte Run simulation', () => {
  it('jumps, lands, and cannot double-jump', () => {
    const run = createRun()
    jump(run)
    advance(run, 0.1)
    expect(run.y).toBeGreaterThan(0)
    const velocity = run.velocity
    jump(run)
    expect(run.velocity).toBe(velocity)
    for (let i = 0; i < 8; i++) advance(run, 0.1)
    expect(run.y).toBe(0)
    expect(run.velocity).toBe(0)
    jump(run)
    expect(run.velocity).toBe(430)
  })

  it('produces the same simulation at 30, 60, and 144 Hz', () => {
    const runs = [30, 60, 144].map(hz => {
      const run = createRun(42)
      jump(run)
      for (let i = 0; i < hz * 2; i++) advance(run, 1 / hz)
      return run
    })
    for (const run of runs.slice(1)) {
      expect(run.distance).toBeCloseTo(runs[0]!.distance, 8)
      expect(run.obstacles).toEqual(runs[0]!.obstacles)
      expect(score(run)).toBe(score(runs[0]!))
    }
  })

  it('detects collision without tunnelling and stops scoring after it', () => {
    const run = createRun()
    run.obstacles = [{ x: PLAYER_X + 25, width: 24, height: 30, kind: 'crate' }]
    advance(run, 10)
    expect(run.over).toBe(true)
    const distance = run.distance
    advance(run, 1)
    jump(run)
    expect(run.distance).toBe(distance)
    expect(run.velocity).toBe(0)
  })

  it('clears an obstacle when sufficiently above it', () => {
    const run = createRun()
    run.y = 60
    run.obstacles = [{ x: PLAYER_X, width: 24, height: 30, kind: 'crate' }]
    advance(run, 1 / 120)
    expect(run.over).toBe(false)
  })

  it('bounds speed, catch-up work and obstacle population, with reachable gaps', () => {
    const run = createRun(91)
    run.distance = 100_000
    run.nextObstacle = run.distance
    advance(run, 500)
    expect(run.speed).toBe(MAX_SPEED)
    expect(run.distance).toBeLessThanOrEqual(100_000 + MAX_SPEED * 0.1 + 0.001)
    let spawnDistance = run.distance
    let next = run.nextObstacle
    for (let i = 0; i < 1000; i++) {
      run.over = false // Exercise generation independently of player collision.
      advance(run, 1 / 60)
      expect(run.obstacles.length).toBeLessThanOrEqual(MAX_OBSTACLES)
      if (run.nextObstacle !== next) {
        expect(run.distance - spawnDistance).toBeGreaterThanOrEqual(MAX_SPEED * JUMP_SECONDS)
        spawnDistance = run.distance
        next = run.nextObstacle
      }
    }
  })

  it('ignores invalid time and creates fresh restarts', () => {
    const run = createRun(123)
    for (const elapsed of [NaN, Infinity, -1, 0]) advance(run, elapsed)
    expect(run).toEqual(createRun(123))
    expect(run.obstacles).not.toBe(createRun(123).obstacles)
  })

  it('advances difficulty internally and reaches a substantially higher maximum speed', () => {
    const run = createRun(37)
    run.nextObstacle = Infinity
    const seen = new Set<number>()
    for (let i = 0; i < 90 * 120; i++) {
      advance(run, STEP_SECONDS)
      seen.add(stage(run))
      if (i === 15 * 120) expect(run.speed).toBeGreaterThan(START_SPEED * 1.15)
    }
    expect([...seen]).toEqual([0, 1, 2, 3, 4])
    expect(run.speed).toBe(MAX_SPEED)
    expect(MAX_SPEED).toBe(600)
    for (let index = 1; index < STAGES.length; index++) {
      run.distance = STAGES[index]!.score * 10 - 0.01
      expect(stage(run)).toBe(index - 1)
      run.distance += 0.01
      expect(stage(run)).toBe(index)
    }
  })

  it('unlocks silhouettes gradually without forcing alternation or long repeated sequences', () => {
    const gaps = new Set<number>()
    for (let level = 0; level < STAGES.length; level++) {
      const seen = new Set<ObstacleKind>()
      const run = createRun(741)
      let previous: ObstacleKind | null = null
      let consecutive = 0
      let repeated = 0
      for (let sample = 0; sample < 80; sample++) {
        run.distance = STAGES[level]!.score * 10
        run.nextObstacle = run.distance
        run.obstacles = []
        advance(run, STEP_SECONDS)
        const obstacle = run.obstacles[0]!
        expect(OBSTACLE_TYPES[obstacle.kind].stage).toBeLessThanOrEqual(level)
        consecutive = obstacle.kind === previous ? consecutive + 1 : 1
        if (consecutive === 2) repeated++
        expect(consecutive).toBeLessThanOrEqual(2)
        seen.add(obstacle.kind)
        previous = obstacle.kind
        gaps.add(Math.round(run.nextObstacle - run.distance))
      }
      expect([...seen].sort()).toEqual(Object.entries(OBSTACLE_TYPES)
        .filter(([, spec]) => spec.stage <= level).map(([kind]) => kind).sort())
      expect(repeated).toBeGreaterThan(0)
    }
    expect(gaps.size).toBeGreaterThan(30)
  })

  it('varies the opening position and kind across adjacent seeds while replaying a seed exactly', () => {
    const positions = new Set<number>()
    const firstKinds: ObstacleKind[] = []
    const openings = new Set<string>()
    function opening(seed: number) {
      const run = createRun(seed)
      positions.add(Math.round(run.nextObstacle))
      expect(run.nextObstacle).toBeGreaterThanOrEqual(60)
      expect(run.nextObstacle).toBeLessThan(320)
      const sequence: string[] = []
      let previous = run.nextObstacle
      while (sequence.length < 6) {
        run.over = false
        advance(run, STEP_SECONDS)
        if (previous !== run.nextObstacle) {
          const obstacle = run.obstacles.at(-1)!
          if (sequence.length === 0) firstKinds.push(obstacle.kind)
          sequence.push(`${obstacle.kind}:${Math.round(run.distance)}:${Math.round(run.nextObstacle)}`)
          previous = run.nextObstacle
        }
      }
      return sequence.join('|')
    }
    for (let seed = 1; seed <= 64; seed++) openings.add(opening(seed))
    expect(positions.size).toBeGreaterThan(40)
    expect(openings.size).toBe(64)
    expect(firstKinds.filter(kind => kind === 'crate').length).toBeGreaterThan(10)
    expect(firstKinds.filter(kind => kind === 'barrier').length).toBeGreaterThan(10)
    expect(opening(87)).toBe(opening(87))
  })

  it('progressively crowds obstacles after top speed, retaining random gaps and jumpable spacing', () => {
    const means: number[] = []
    for (const elapsed of [0, 30, 75, 120, EXTREME_AFTER_SECONDS]) {
      const run = createRun(89)
      const gaps: number[] = []
      for (let sample = 0; sample < 500; sample++) {
        run.distance = 100_000 // Same speed: measure density separately from acceleration.
        run.elapsed = elapsed
        run.nextObstacle = run.distance
        run.obstacles = []
        advance(run, STEP_SECONDS)
        const obstacle = run.obstacles[0]!
        expect(obstacle.x).toBe(WORLD_WIDTH) // Never teleport into view.
        const interval = (run.nextObstacle - run.distance - (obstacle.width - 24) / 2) / MAX_SPEED
        expect(interval).toBeGreaterThanOrEqual(JUMP_SECONDS + difficulty(run.elapsed).recovery - 1e-10)
        gaps.push((run.nextObstacle - run.distance - obstacle.width) / MAX_SPEED)
      }
      means.push(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length)
      expect(new Set(gaps.map(gap => gap.toFixed(4))).size).toBeGreaterThan(100)
      if (elapsed === 0) {
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(1)
      } else if (elapsed === EXTREME_AFTER_SECONDS) {
        expect(gaps.filter(gap => gap < 0.65).length).toBeGreaterThan(450)
        expect(Math.min(...gaps)).toBeLessThan(0.55)
        expect(Math.max(...gaps)).toBeLessThan(0.85)
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.15)
      }
    }
    for (let i = 1; i < means.length; i++) expect(means[i]!).toBeLessThan(means[i - 1]!)
    expect(means.at(-1)!).toBeLessThan(means[0]! * 0.45)
  })

  it('bounds late-game pressure, preserves the opening and never increases difficulty while idle', () => {
    expect(difficulty(0)).toEqual(difficulty(12))
    expect(difficulty(EXTREME_AFTER_SECONDS)).toEqual(difficulty(86_400))
    expect(difficulty(EXTREME_AFTER_SECONDS).recovery).toBe(2 * STEP_SECONDS)
    const run = createRun()
    run.bonus = 99_999
    for (const elapsed of [NaN, Infinity, -1, 0]) advance(run, elapsed)
    expect(difficulty(run.elapsed)).toEqual(difficulty(0))
    for (const kind of Object.keys(OBSTACLE_TYPES) as ObstacleKind[]) {
      const { width, height } = OBSTACLE_TYPES[kind]
      expect(obstacleShape(kind, 75)).toEqual({ width, height })
      expect(obstacleShape(kind, EXTREME_AFTER_SECONDS)).toEqual(obstacleShape(kind, 86_400))
    }
  })

  it('gives every pattern a forgiving jump window at its unlock speed and maximum speed', () => {
    for (const [kind, spec] of Object.entries(OBSTACLE_TYPES)) {
      for (const distance of [STAGES[spec.stage]!.score * 10, 100_000]) {
        const successes: number[] = []
        for (let lead = 0.18; lead <= 0.48; lead += 0.01) {
          const run = createRun(19)
          run.distance = distance
          run.speed = Math.min(MAX_SPEED, START_SPEED + distance / ACCELERATION_DISTANCE)
          run.nextObstacle = Infinity
          run.obstacles = [{ kind: kind as ObstacleKind, ...spec,
            x: PLAYER_X + PLAYER_WIDTH / 2 - spec.width / 2 + lead * run.speed }]
          jump(run)
          for (let i = 0; i < 120 && !run.over; i++) advance(run, STEP_SECONDS)
          if (!run.over) successes.push(lead)
        }
        expect(successes.length, `${kind} at distance ${distance}`).toBeGreaterThanOrEqual(12)
      }
    }
  })

  it('allows accurately timed runs through the extreme phase across many seeded combinations', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const run = createRun(seed * 137)
      let mostObstacles = 0
      let mostBytes = 0
      for (let i = 0; i < (EXTREME_AFTER_SECONDS + 30) * 120 && !run.over; i++) {
        jumpAtCenter(run)
        advance(run, STEP_SECONDS)
        mostObstacles = Math.max(mostObstacles, run.obstacles.length)
        mostBytes = Math.max(mostBytes, run.bytes.length)
      }
      expect(run.over, `seed ${seed}, score ${score(run)}`).toBe(false)
      expect(mostObstacles).toBeLessThanOrEqual(MAX_OBSTACLES)
      expect(mostBytes).toBeLessThanOrEqual(MAX_BYTES)
      expect(stage(run)).toBe(4)
      expect(run.speed).toBe(MAX_SPEED)
      // Survival no longer guarantees a pickup above every obstacle. Prizes
      // can be deliberately skipped without affecting the difficulty curve.
      expect(run.bonus).toBeGreaterThanOrEqual(0)
      expect(run.bonus).toBeLessThanOrEqual(run.collected * 30)
      expect(score(run)).toBe(Math.floor(run.distance / 10) + run.bonus)
    }
  })

  it('makes late-game mistakes punishing instead of preserving the opening forgiveness', () => {
    let openingSurvivors = 0
    let extremeSurvivors = 0
    for (let seed = 1; seed <= 40; seed++) {
      for (const late of [false, true]) {
        const run = createRun(seed * 137)
        if (late) Object.assign(run, { distance: 100_000, elapsed: EXTREME_AFTER_SECONDS, nextObstacle: 100_100, speed: MAX_SPEED })
        for (let i = 0; i < 60 * 120 && !run.over; i++) {
          jumpAtCenter(run, 0.26) // Consistently 70ms later than the ideal timing.
          advance(run, STEP_SECONDS)
        }
        if (!run.over) { if (late) extremeSurvivors++; else openingSurvivors++ }
      }
    }
    expect(openingSurvivors).toBe(40)
    expect(extremeSurvivors).toBe(0)
  })

  it('keeps every extreme obstacle pair possible at minimum spacing and common frame rates', () => {
    for (const hz of [30, 60, 144]) {
      for (const first of Object.keys(OBSTACLE_TYPES) as ObstacleKind[]) {
        for (const second of Object.keys(OBSTACLE_TYPES) as ObstacleKind[]) {
          const run = createRun(37)
          Object.assign(run, { distance: 100_000, elapsed: EXTREME_AFTER_SECONDS, speed: MAX_SPEED, nextObstacle: Infinity })
          const a = obstacleShape(first, run.elapsed)
          const b = obstacleShape(second, run.elapsed)
          const x = PLAYER_X + PLAYER_WIDTH / 2 - a.width / 2 + 0.33 * MAX_SPEED
          run.obstacles = [
            { kind: first, ...a, x },
            { kind: second, ...b, x: x + MAX_SPEED * (JUMP_SECONDS + 2 * STEP_SECONDS) + (a.width - b.width) / 2 },
          ]
          for (let frame = 0; frame < hz * 2 && !run.over; frame++) {
            jumpAtCenter(run)
            advance(run, 1 / hz)
          }
          expect(run.over, `${first}/${second} at ${hz}Hz`).toBe(false)
          expect(run.obstacles).toHaveLength(0)
        }
      }
    }
  })

  it('awards each pickup once, caps combo bonuses, and resets the combo after a miss', () => {
    const run = createRun()
    run.nextObstacle = Infinity
    run.y = 60
    const catchOne = () => {
      run.bytes = [{ x: PLAYER_X + 14, y: 90 }]
      advance(run, STEP_SECONDS)
    }
    catchOne()
    expect(run.collected).toBe(1)
    expect(run.bonus).toBe(10)
    expect(run.pickupFeedback).toBeGreaterThan(0)
    expect(run.bytes).toHaveLength(0)
    advance(run, STEP_SECONDS)
    expect(run.collected).toBe(1)
    catchOne(); catchOne(); catchOne()
    expect(run.bonus).toBe(90)
    expect(run.streak).toBe(3)
    run.bytes = [{ x: PLAYER_X - 10, y: 90 }]
    advance(run, STEP_SECONDS)
    expect(run.streak).toBe(0)
    expect(run.over).toBe(false)
    catchOne()
    expect(run.bonus).toBe(100)
    expect(score(run)).toBe(Math.floor(run.distance / 10) + 100)
    expect(stage(run)).toBe(0)
    run.bonus = 99_999
    expect(stage(run)).toBe(0)
  })

  it('keeps collectibles optional and never rewards a collision or a grounded miss', () => {
    const run = createRun()
    run.nextObstacle = Infinity
    run.bytes = [{ x: PLAYER_X + 14, y: 90 }]
    for (let i = 0; i < 120; i++) advance(run, STEP_SECONDS)
    expect(run.collected).toBe(0)
    expect(run.over).toBe(false)
    run.bytes = [{ x: PLAYER_X + 14, y: 20 }]
    run.obstacles = [{ x: PLAYER_X, ...OBSTACLE_TYPES.crate, kind: 'crate' }]
    advance(run, STEP_SECONDS)
    expect(run.over).toBe(true)
    expect(run.collected).toBe(0)
    const before = score(run)
    advance(run, 1)
    expect(score(run)).toBe(before)
    expect(createRun().collected).toBe(0)
  })

  it('collects and scores identically at 30, 60, and 144 Hz', () => {
    const runs = [30, 60, 144].map(hz => {
      const run = createRun(79)
      run.nextObstacle = Infinity
      run.bytes = [{ x: PLAYER_X + 90, y: 90 }]
      jump(run)
      for (let i = 0; i < hz * 2; i++) advance(run, 1 / hz)
      return run
    })
    expect(runs[0]!.collected).toBe(1)
    for (const run of runs.slice(1)) {
      expect(run.collected).toBe(runs[0]!.collected)
      expect(score(run)).toBe(score(runs[0]!))
    }
  })

  it('uses separate solid segments for multi-block patterns', () => {
    const double = { kind: 'double' as const, x: 100, ...OBSTACLE_TYPES.double }
    expect(obstacleParts(double)).toEqual([
      { x: 100, width: 30, height: 28 }, { x: 142, width: 30, height: 28 },
    ])
    const triple = obstacleParts({ kind: 'triple', x: 100, ...OBSTACLE_TYPES.triple })
    expect(triple).toHaveLength(3)
    expect(triple[2]!.x + triple[2]!.width).toBe(208)
  })
})
