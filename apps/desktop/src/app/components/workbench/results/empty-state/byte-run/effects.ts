import type { Run } from './engine'

export type PowerKind = 'reverse' | 'boost' | 'barriers'
// A trail is one pickup with a visible, continuous ground-level footprint.
// x is its leading icon center; span extends toward the trailing icon.
export interface Powerup { x: number; y: number; kind: PowerKind; span?: number }
export const POWER_RADIUS = 10
export const POWER_TRAIL_CHANCE = 0.18
export const MAX_POWERUPS = 2
export const BOOST_SECONDS = 8
export const BARRIER_SECONDS = 10
export const BOOST_MULTIPLIER = 1.35
export const REVERSE_PENALTY = 50
export const TURN_SECONDS = 0.3

export function choosePowerup(random: number, reversed: boolean): PowerKind {
  if (reversed) return random < 0.85 ? 'reverse' : random < 0.925 ? 'boost' : 'barriers'
  return random < 1 / 3 ? 'reverse' : random < 2 / 3 ? 'boost' : 'barriers'
}

export function activeEffects(run: Run) {
  return [run.direction === -1 ? 'Reverse' : '', run.boostRemaining > 0 ? 'Speed boost' : '',
    run.barriersRemaining > 0 ? 'Tall barriers' : ''].filter(Boolean).join(' · ')
}
