import { afterEach, describe, expect, it, vi } from 'vitest'
import { newRunSeed } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/random-seed'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('fresh game seeds', () => {
  it('requests fresh local entropy on every run, even with a frozen clock', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    const entropy = vi.fn((buffer: Uint32Array) => { buffer[0] = 7654; return buffer })
    vi.stubGlobal('crypto', { getRandomValues: entropy })
    const seeds = Array.from({ length: 20 }, () => newRunSeed())
    expect(entropy).toHaveBeenCalledTimes(20)
    expect(new Set(seeds).size).toBe(20)
    expect(seeds.every(seed => Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff)).toBe(true)
  })

  it('keeps retries distinct when native entropy is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues: () => { throw new Error('unavailable') } })
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const seeds = Array.from({ length: 20 }, () => newRunSeed())
    expect(new Set(seeds).size).toBe(20)
    vi.stubGlobal('crypto', undefined)
    expect(Number.isInteger(newRunSeed())).toBe(true)
  })
})
