import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldRunStartupUpdateCheck } from '../../../src/app/state/use-startup-update-check'

describe('shouldRunStartupUpdateCheck', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('checks immediately when the effective update channel changed', () => {
    expect(
      shouldRunStartupUpdateCheck({
        includePrereleases: true,
        lastCheckedAt: new Date().toISOString(),
        lastResult: {
          status: 'current',
          channel: 'stable',
          checkedAt: new Date().toISOString(),
        },
      }),
    ).toBe(true)
  })

  it('retains the daily interval after checking the effective channel', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'))

    expect(
      shouldRunStartupUpdateCheck({
        includePrereleases: true,
        lastCheckedAt: '2026-07-26T11:00:00.000Z',
        lastResult: {
          status: 'current',
          channel: 'prerelease',
          checkedAt: '2026-07-26T11:00:00.000Z',
        },
      }),
    ).toBe(false)
    expect(
      shouldRunStartupUpdateCheck({
        includePrereleases: true,
        lastCheckedAt: '2026-07-25T11:00:00.000Z',
        lastResult: {
          status: 'current',
          channel: 'prerelease',
          checkedAt: '2026-07-25T11:00:00.000Z',
        },
      }),
    ).toBe(true)
  })

  it('checks when there is no valid prior check time', () => {
    expect(
      shouldRunStartupUpdateCheck({
        includePrereleases: false,
        lastCheckedAt: 'not-a-date',
        lastResult: {
          status: 'current',
          channel: 'stable',
          checkedAt: 'not-a-date',
        },
      }),
    ).toBe(true)
  })
})
