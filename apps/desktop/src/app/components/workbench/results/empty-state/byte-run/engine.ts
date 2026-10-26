// Pure, deterministic simulation. No browser, application state, or datastore imports.
import { BARRIER_SECONDS, BOOST_MULTIPLIER, BOOST_SECONDS, choosePowerup, MAX_POWERUPS, POWER_RADIUS, POWER_TRAIL_CHANCE, REVERSE_PENALTY, TURN_SECONDS } from './effects'
import type { PowerKind, Powerup } from './effects'
export const WORLD_WIDTH = 720
export const WORLD_HEIGHT = 180
export const GROUND = 148
export const PLAYER_X = 54
export const PLAYER_WIDTH = 28
export const PLAYER_HEIGHT = 34
export const START_SPEED = 240
export const MAX_SPEED = 600
export const ACCELERATION_DISTANCE = 85
export const STEP_SECONDS = 1 / 120
export const MAX_OBSTACLES = 5
export const MAX_BYTES = 5
export const BYTE_RADIUS = 6
export const MIN_BYTE_INTERVAL = 4
export const MAX_BYTE_INTERVAL = 11
export const PICKUP_FEEDBACK_SECONDS = 0.45
export const JUMP_SPEED = 430
export const GRAVITY = 1300
export const JUMP_SECONDS = 2 * JUMP_SPEED / GRAVITY
export const EXTREME_AFTER_SECONDS = 180

export const STAGES = [
  { score: 0 }, { score: 300 }, { score: 750 }, { score: 1400 }, { score: 2200 },
] as const

// Each silhouette has a different timing window, but every pattern is cleared
// with one jump. Wider patterns unlock only once the running speed permits it.
export const OBSTACLE_TYPES = {
  crate: { width: 28, height: 28, stage: 0 },
  barrier: { width: 54, height: 22, stage: 0 },
  tower: { width: 24, height: 46, stage: 1 },
  double: { width: 72, height: 28, stage: 2 },
  triple: { width: 108, height: 24, stage: 3 },
} as const
export type ObstacleKind = keyof typeof OBSTACLE_TYPES
const EXTREME_SHAPES: Record<ObstacleKind, { width: number; height: number }> = {
  crate: { width: 44, height: 52 },
  barrier: { width: 90, height: 40 },
  tower: { width: 28, height: 68 },
  double: { width: 110, height: 48 },
  triple: { width: 148, height: 38 },
}
const MAX_OBSTACLE_HEIGHT = Math.max(...Object.values(EXTREME_SHAPES).map(shape => shape.height))
export interface Obstacle { x: number; width: number; height: number; kind: ObstacleKind }
export interface CollectibleByte { x: number; y: number }
export interface Run {
  y: number
  velocity: number
  distance: number
  // distance is total travel for difficulty; retreat tracks the return trip.
  retreat: number
  direction: 1 | -1
  screenShift: number
  penalty: number
  peakScore: number
  falling: boolean
  boostRemaining: number
  barriersRemaining: number
  effectFeedback: number
  effectMessage: string
  powerups: Powerup[]
  nextPowerAt: number
  powerSeed: number
  speed: number
  remainder: number
  nextObstacle: number
  obstacles: Obstacle[]
  lastObstacle: ObstacleKind | null
  obstacleRepeats: number
  bytes: CollectibleByte[]
  nextByteAt: number
  byteSeed: number
  collected: number
  streak: number
  bonus: number
  pickupFeedback: number
  lastBonus: number
  landed: number
  elapsed: number
  seed: number
  over: boolean
}

function mixSeed(seed: number) {
  // Diffuse adjacent seeds before the first draw: small seed changes must not
  // produce almost identical openings. Explicit seeds still replay exactly.
  let mixed = seed >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad)
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97)
  mixed ^= mixed >>> 15
  return mixed >>> 0 || 1
}

export function createRun(seed = 1): Run {
  const run: Run = { y: 0, velocity: 0, distance: 0, speed: START_SPEED, remainder: 0,
    nextObstacle: 0, obstacles: [], lastObstacle: null, obstacleRepeats: 0, bytes: [], collected: 0, streak: 0,
    nextByteAt: 0, byteSeed: mixSeed(seed ^ 0xa5a5a5a5),
    retreat: 0, direction: 1, screenShift: 0, penalty: 0, peakScore: 0, falling: false,
    boostRemaining: 0, barriersRemaining: 0, effectFeedback: 0, effectMessage: '',
    powerups: [], nextPowerAt: 0, powerSeed: mixSeed(seed ^ 0x6c8e9cf5),
    bonus: 0, pickupFeedback: 0, lastBonus: 0, landed: 0, elapsed: 0, seed: mixSeed(seed), over: false }
  run.nextObstacle = 60 + random(run) * 260
  scheduleByte(run)
  schedulePower(run)
  return run
}

export function jump(run: Run) {
  if (!run.over && !run.falling && run.y === 0 && run.velocity === 0) run.velocity = JUMP_SPEED
}

// Game time advances only during play, never while paused. Spacing keeps
// tightening after speed and silhouette unlocks have reached their ceilings.
export function difficulty(elapsed: number) {
  const pressure = Math.max(0, Math.min(1, (elapsed - 12) / 63))
  const precision = Math.max(0, Math.min(1, (elapsed - 75) / (EXTREME_AFTER_SECONDS - 75)))
  return {
    precision,
    recovery: 0.45 * (1 - pressure) + 0.08 * pressure * (1 - precision) + 2 * STEP_SECONDS * precision,
    tightChance: 0.4 + 0.5 * pressure + 0.08 * precision,
    variationScale: 1 - 0.8 * pressure - 0.17 * precision,
  }
}

export function obstacleShape(kind: ObstacleKind, elapsed: number) {
  const { precision } = difficulty(elapsed)
  const base = OBSTACLE_TYPES[kind]
  const extreme = EXTREME_SHAPES[kind]
  return {
    width: base.width + (extreme.width - base.width) * precision,
    height: base.height + (extreme.height - base.height) * precision,
  }
}

export function worldPosition(run: Run) { return Math.max(0, run.distance - 2 * run.retreat) }
export function score(run: Run) { return Math.max(0, Math.floor(worldPosition(run) / 10) + run.bonus - run.penalty) }
export function stage(run: Run) {
  let index = 0
  // Pickups reward precision, never accelerate the difficulty curve.
  while (index + 1 < STAGES.length && run.distance / 10 >= STAGES[index + 1]!.score) index++
  return index
}

export function advance(run: Run, elapsed: number) {
  if (run.over || !Number.isFinite(elapsed) || elapsed <= 0) return
  // A suspended/slow frame cannot teleport the player through an obstacle or
  // create an unbounded catch-up loop. Background play is paused by the host.
  run.remainder += Math.min(elapsed, 0.1)
  while (run.remainder + 1e-10 >= STEP_SECONDS && !run.over) {
    run.remainder = Math.max(0, run.remainder - STEP_SECONDS)
    step(run)
  }
}

function step(run: Run) {
  if (run.falling) {
    run.velocity -= GRAVITY * STEP_SECONDS
    run.y += run.velocity * STEP_SECONDS
    if (run.y < -WORLD_HEIGHT) run.over = true
    return
  }
  run.boostRemaining = Math.max(0, run.boostRemaining - STEP_SECONDS)
  run.barriersRemaining = Math.max(0, run.barriersRemaining - STEP_SECONDS)
  run.effectFeedback = Math.max(0, run.effectFeedback - STEP_SECONDS)
  run.screenShift = run.direction === -1 ? Math.min(1, run.screenShift + STEP_SECONDS / TURN_SECONDS)
    : Math.max(0, run.screenShift - STEP_SECONDS / TURN_SECONDS)
  // Continuous acceleration to a higher ceiling, reached in about 80 seconds.
  const boost = run.boostRemaining > 0 ? BOOST_MULTIPLIER : 1
  run.speed = Math.min(MAX_SPEED, START_SPEED + run.distance / ACCELERATION_DISTANCE) * boost
  const travel = run.speed * STEP_SECONDS
  run.distance += travel
  if (run.direction === -1) {
    run.retreat += travel
    if (worldPosition(run) === 0) {
      run.falling = true
      run.velocity = 0
      run.effectMessage = 'End of the world'
      return
    }
  }
  run.elapsed += STEP_SECONDS
  run.pickupFeedback = Math.max(0, run.pickupFeedback - STEP_SECONDS)
  run.landed = Math.max(0, run.landed - STEP_SECONDS)
  if (run.y > 0 || run.velocity > 0) {
    // Boost accelerates the whole run, including the jump clock. Keeping the
    // same jump height/distance avoids turning existing close pairs into an
    // impossible sequence merely because a boost was collected mid-jump.
    run.velocity -= GRAVITY * STEP_SECONDS * boost
    run.y = Math.max(0, run.y + run.velocity * STEP_SECONDS * boost)
    if (run.y === 0) { run.velocity = 0; run.landed = 0.12 }
  }
  for (const obstacle of run.obstacles) obstacle.x -= travel
  for (const byte of run.bytes) byte.x -= travel
  for (const power of run.powerups) power.x -= travel
  run.powerups = run.powerups.filter(power => power.x + (power.span ?? 0) + POWER_RADIUS > 0)
  run.obstacles = run.obstacles.filter(obstacle => obstacle.x + obstacle.width > 0)
  const edge = run.direction === -1 ? PLAYER_X + PLAYER_WIDTH / 2 + worldPosition(run) : Infinity
  if (run.distance >= run.nextObstacle && run.obstacles.length < MAX_OBSTACLES && edge > WORLD_WIDTH + 150) {
    const level = stage(run)
    const choices = (Object.keys(OBSTACLE_TYPES) as ObstacleKind[])
      .filter(kind => OBSTACLE_TYPES[kind].stage <= level && (kind !== run.lastObstacle || run.obstacleRepeats < 2))
    const kind = run.barriersRemaining > 0 ? 'tower' : choices[Math.floor(random(run) * choices.length)]!
    const { width, height } = run.barriersRemaining > 0
      ? { width: Math.min(24, 12 + (run.speed - START_SPEED) / 30), height: Math.min(68, 64 + (run.speed - START_SPEED) / 100) }
      : obstacleShape(kind, run.elapsed)
    run.obstacles.push({ x: WORLD_WIDTH, kind, width, height })
    run.obstacleRepeats = kind === run.lastObstacle ? run.obstacleRepeats + 1 : 1
    run.lastObstacle = kind
    // Budget center-to-center jump timing, not an entire extra jump of empty
    // space AFTER each obstacle. At the extreme end just two simulation steps
    // of recovery remain. The narrowest possible next shape is conservative:
    // a wider next obstacle can only add time between the two centers.
    const arrivalSpeed = Math.min(MAX_SPEED * boost, run.speed + WORLD_WIDTH / ACCELERATION_DISTANCE * boost)
    const { recovery, tightChance, variationScale } = difficulty(run.elapsed)
    const narrowestNext = run.barriersRemaining > 0 ? 12 : 24
    // Tight bursts become the norm; rare longer gaps still break the rhythm
    // so surviving is about reading hazards, not repeating a fixed beat.
    const cadence = random(run)
    const variation = cadence < tightChance ? random(run) * 0.22 * variationScale
      : cadence < tightChance + (1 - tightChance) * 0.75 ? (0.25 + random(run) * 0.45) * variationScale
      : 0.12 + (0.73 + random(run) * 0.5) * variationScale
    run.nextObstacle = run.distance + arrivalSpeed * (JUMP_SECONDS + recovery + variation) / boost + (width - narrowestNext) / 2
  }
  run.over = run.obstacles.some(obstacle => obstacleParts(obstacle).some(part =>
    PLAYER_X + PLAYER_WIDTH - 3 > part.x && PLAYER_X + 3 < part.x + part.width &&
    run.y + 3 < part.height))
  if (!run.over) {
    if (run.elapsed >= run.nextByteAt) {
      if (edge > WORLD_WIDTH + 150) spawnByte(run)
      scheduleByte(run)
    }
    collectBytes(run)
    if (run.elapsed >= run.nextPowerAt) {
      if (edge > WORLD_WIDTH + 150) spawnPower(run, edge)
      schedulePower(run)
    }
    const caught = run.powerups.find(power => touches(run, power, POWER_RADIUS))
    if (caught) {
      run.powerups = run.powerups.filter(power => power !== caught)
      applyPowerup(run, caught.kind)
    }
    run.peakScore = Math.max(run.peakScore, score(run))
  }
}

function schedulePower(run: Run) {
  run.nextPowerAt = run.elapsed + (run.direction === -1 ? 1.5 + randomPower(run) * 2 : 12 + randomPower(run) * 12)
}

function spawnPower(run: Run, edge: number) {
  if (run.powerups.length >= MAX_POWERUPS) return
  const kind = choosePowerup(randomPower(run), run.direction === -1)
  const y = POWER_RADIUS
  // Most are single icons that can be jumped. Rare continuous trails exceed
  // one jump's travel, forcing one effect on landing, not repeated effects.
  // Budget acceleration until the entire trail passes; boost also accelerates
  // the jump clock, so it does not increase the distance a jump can clear.
  const approachDistance = WORLD_WIDTH + MAX_SPEED * JUMP_SECONDS + PLAYER_WIDTH + 2 * POWER_RADIUS + 40
  const arrivalSpeed = Math.min(MAX_SPEED, START_SPEED + (run.distance + approachDistance) / ACCELERATION_DISTANCE)
  let span = randomPower(run) < POWER_TRAIL_CHANCE ? Math.ceil(arrivalSpeed * JUMP_SECONDS + PLAYER_WIDTH + 24) : 0
  let x = WORLD_WIDTH + POWER_RADIUS
  for (const obstacle of run.obstacles) {
    if (x + span + POWER_RADIUS > obstacle.x && x - POWER_RADIUS < obstacle.x + obstacle.width) {
      x = obstacle.x + obstacle.width + POWER_RADIUS + 30
    }
  }
  // Never bury a trail in the next obstacle or extend it beyond the world edge.
  // When a long trail cannot fit, retain an ordinary, avoidable ground pickup.
  const available = Math.min(WORLD_WIDTH + run.nextObstacle - run.distance, edge) - x - POWER_RADIUS - 30
  if (available < 0) return
  if (span > available) span = 0
  run.powerups.push({ x, y, kind, span })
}

export function applyPowerup(run: Run, kind: PowerKind) {
  if (run.over || run.falling) return
  run.peakScore = Math.max(run.peakScore, score(run))
  run.effectFeedback = 1.5
  if (kind === 'reverse') {
    run.direction = run.direction === 1 ? -1 : 1
    if (run.direction === -1) run.penalty += REVERSE_PENALTY
    run.effectMessage = run.direction === -1 ? `Reverse −${REVERSE_PENALTY}` : 'Forward again'
    // Turn the local scene around the player, so approaching hazards move
    // behind them instead of being teleported into the new approach lane.
    const pivot = 2 * PLAYER_X + PLAYER_WIDTH
    for (const obstacle of run.obstacles) obstacle.x = pivot - obstacle.x - obstacle.width
    for (const byte of run.bytes) byte.x = pivot - byte.x
    for (const power of run.powerups) power.x = pivot - power.x - (power.span ?? 0)
    run.obstacles = run.obstacles.filter(obstacle => obstacle.x + obstacle.width > 0)
    run.bytes = run.bytes.filter(byte => byte.x + BYTE_RADIUS > 0)
    run.powerups = run.powerups.filter(power => power.x + (power.span ?? 0) + POWER_RADIUS > 0)
    run.nextObstacle = run.distance + run.speed * 0.8
    schedulePower(run)
  } else if (kind === 'boost') {
    run.boostRemaining = BOOST_SECONDS
    run.effectMessage = 'Speed boost'
  } else {
    run.barriersRemaining = BARRIER_SECONDS
    run.effectMessage = 'Tall barriers'
  }
}

function touches(run: Run, item: { x: number; y: number; span?: number }, radius: number) {
  return item.x + (item.span ?? 0) + radius > PLAYER_X + 3 && item.x - radius < PLAYER_X + PLAYER_WIDTH - 3 &&
    item.y + radius > run.y + 3 && item.y - radius < run.y + PLAYER_HEIGHT - 2
}

function scheduleByte(run: Run) {
  // Time-based rarity does not turn into a reward on every obstacle as pace
  // increases. Separate entropy keeps bonus decisions out of hazard generation.
  run.nextByteAt = run.elapsed + MIN_BYTE_INTERVAL + randomByte(run) * (MAX_BYTE_INTERVAL - MIN_BYTE_INTERVAL)
}

function spawnByte(run: Run) {
  if (run.bytes.length >= MAX_BYTES) return
  // Ground prizes can tempt a late jump; airborne prizes can tempt an early
  // one. Height and timing are NOT promises of a safe route through hazards.
  const placement = randomByte(run)
  const y = placement < 0.4 ? BYTE_RADIUS + 3 + randomByte(run) * 12
    : placement < 0.75 ? 50 + randomByte(run) * 28 : 82 + randomByte(run) * 18
  let x = WORLD_WIDTH + BYTE_RADIUS
  // Keep the prize visible rather than burying it inside a solid obstacle.
  // Placing it just behind that obstacle still makes chasing it risky.
  for (const obstacle of run.obstacles) {
    if (x + BYTE_RADIUS > obstacle.x && x - BYTE_RADIUS < obstacle.x + obstacle.width && y - BYTE_RADIUS < obstacle.height) {
      x = obstacle.x + obstacle.width + BYTE_RADIUS + 8 + randomByte(run) * 28
    }
  }
  // A forthcoming obstacle must not materialize on top of a low prize. This
  // is an offscreen-only rejection, never a moved/disappearing visible pickup.
  if (y - BYTE_RADIUS < MAX_OBSTACLE_HEIGHT && run.nextObstacle - run.distance < x + BYTE_RADIUS - WORLD_WIDTH) return
  run.bytes.push({ x, y })
}

function collectBytes(run: Run) {
  run.bytes = run.bytes.filter(byte => {
    const caught = touches(run, byte, BYTE_RADIUS)
    if (caught) {
      run.collected++
      run.streak = Math.min(3, run.streak + 1)
      run.lastBonus = run.streak * 10
      run.bonus += run.lastBonus
      run.pickupFeedback = PICKUP_FEEDBACK_SECONDS
      return false
    }
    if (byte.x + BYTE_RADIUS < PLAYER_X) { run.streak = 0; return false }
    return true
  })
}

// Drawing and collision share the same segments: gaps between blocks are not
// invisible walls, and decoration never extends the collision bounds.
export function obstacleParts(obstacle: Obstacle) {
  const count = obstacle.kind === 'double' ? 2 : obstacle.kind === 'triple' ? 3 : 1
  const gap = count === 1 ? 0 : 12
  const width = (obstacle.width - gap * (count - 1)) / count
  return Array.from({ length: count }, (_, index) => ({
    x: obstacle.x + index * (width + gap), width, height: obstacle.height,
  }))
}

function random(run: Run) {
  run.seed = nextSeed(run.seed)
  return run.seed / 4294967296
}

function randomByte(run: Run) {
  run.byteSeed = nextSeed(run.byteSeed)
  return run.byteSeed / 4294967296
}

function randomPower(run: Run) {
  run.powerSeed = nextSeed(run.powerSeed)
  return run.powerSeed / 4294967296
}

function nextSeed(seed: number) {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return seed >>> 0
}
