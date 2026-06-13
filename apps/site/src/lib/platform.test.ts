import { describe, expect, it } from 'vitest'
import { detectPlatform, normalizePlatform } from './platform'

describe('platform detection', () => {
  it('normalizes common platform strings', () => {
    expect(normalizePlatform('Win32')).toBe('windows')
    expect(normalizePlatform('MacIntel')).toBe('macos')
    expect(normalizePlatform('Linux x86_64')).toBe('linux')
    expect(normalizePlatform('SomethingElse')).toBe('unknown')
  })

  it('prefers userAgentData platform when available', () => {
    const platform = detectPlatform({
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0',
      userAgentData: { platform: 'Windows' },
    } as Navigator & { userAgentData: { platform: string } })

    expect(platform).toBe('windows')
  })
})
