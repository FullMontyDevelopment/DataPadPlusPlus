import { describe, expect, it } from 'vitest'
import {
  canUseWorkspaceBundlePassphrase,
  getWorkspaceBundlePassphraseBlockReason,
  rateWorkspaceBundlePassphrase,
} from './workspace-passphrase'

describe('workspace passphrase helpers', () => {
  it('allows short user-chosen passphrases', () => {
    expect(canUseWorkspaceBundlePassphrase('x')).toBe(true)
    expect(rateWorkspaceBundlePassphrase('x')).toMatchObject({
      label: 'Weak',
      score: 1,
    })
  })

  it('blocks common guessed passwords regardless of simple decoration', () => {
    expect(canUseWorkspaceBundlePassphrase('password')).toBe(false)
    expect(canUseWorkspaceBundlePassphrase('password!')).toBe(false)
    expect(canUseWorkspaceBundlePassphrase('12345')).toBe(false)
    expect(getWorkspaceBundlePassphraseBlockReason('qwerty')).toBe(
      'Choose a less common workspace backup passphrase.',
    )
  })

  it('penalizes repeating characters and rewards length plus symbols', () => {
    expect(rateWorkspaceBundlePassphrase('aaaaaaaaaaaa')).toMatchObject({
      tone: 'weak',
    })
    expect(rateWorkspaceBundlePassphrase('Correct-Horse-2026!')).toMatchObject({
      tone: 'excellent',
      score: 4,
    })
  })
})
