import { describe, expect, it } from 'vitest'
import { canOpenExternalLink } from '../../../src/services/runtime/external-links'

describe('external link runtime helper', () => {
  it('allows DataPad++ GitHub repository links', () => {
    expect(canOpenExternalLink('https://github.com/FullMontyDevelopment/DataPadPlusPlus')).toBe(true)
    expect(canOpenExternalLink('https://github.com/FullMontyDevelopment/DataPadPlusPlus/releases')).toBe(true)
    expect(canOpenExternalLink('https://github.com/FullMontyDevelopment/DataPadPlusPlus/issues')).toBe(true)
  })

  it('rejects non-repository and non-https links', () => {
    expect(canOpenExternalLink('https://github.com/FullMontyDevelopment/OtherProject')).toBe(false)
    expect(canOpenExternalLink('http://github.com/FullMontyDevelopment/DataPadPlusPlus')).toBe(false)
    expect(canOpenExternalLink('javascript:alert(1)')).toBe(false)
  })
})
