import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => { vi.resetModules(); localStorage.clear() })
afterEach(() => vi.restoreAllMocks())

describe('Byte Run device-local best', () => {
  it('persists only a number, survives reload, and never lowers a known best', async () => {
    const store = await import('../../../../../../src/app/components/workbench/results/empty-state/byte-run/best-score')
    expect(store.saveBestScore(123)).toBe(123)
    expect(localStorage.length).toBe(1)
    expect(localStorage.getItem(store.BEST_SCORE_KEY)).toBe('123')
    vi.resetModules()
    const reloaded = await import('../../../../../../src/app/components/workbench/results/empty-state/byte-run/best-score')
    expect(reloaded.readBestScore()).toBe(123)
    expect(reloaded.saveBestScore(4)).toBe(123)
    localStorage.setItem(store.BEST_SCORE_KEY, '200')
    expect(reloaded.readBestScore()).toBe(200)
  })

  it.each(['broken', '-1', '1.5', 'null', '"100"', '{}', '1e100'])('ignores corrupt storage: %s', async raw => {
    const store = await import('../../../../../../src/app/components/workbench/results/empty-state/byte-run/best-score')
    localStorage.setItem(store.BEST_SCORE_KEY, raw)
    expect(store.readBestScore()).toBe(0)
  })

  it('continues in memory when storage is unavailable and retries later', async () => {
    const store = await import('../../../../../../src/app/components/workbench/results/empty-state/byte-run/best-score')
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable') })
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
    expect(store.saveBestScore(456)).toBe(456)
    expect(store.readBestScore()).toBe(456)
    read.mockRestore(); write.mockRestore()
    expect(store.saveBestScore(12)).toBe(456)
    expect(localStorage.getItem(store.BEST_SCORE_KEY)).toBe('456')
    for (const invalid of [-5, NaN, Infinity, 1.1]) expect(store.saveBestScore(invalid)).toBe(456)
  })
})
