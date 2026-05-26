export type WorkspacePassphraseStrengthTone =
  | 'empty'
  | 'blocked'
  | 'weak'
  | 'fair'
  | 'strong'
  | 'excellent'

export interface WorkspacePassphraseStrength {
  label: string
  tone: WorkspacePassphraseStrengthTone
  score: number
  hints: string[]
  blockedReason?: string
}

const COMMON_WORKSPACE_PASSPHRASES = new Set([
  '000000',
  '111111',
  '12345',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  'abc123',
  'admin',
  'administrator',
  'changeme',
  'default',
  'dragon',
  'football',
  'iloveyou',
  'letmein',
  'login',
  'monkey',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwerty',
  'qwerty123',
  'secret',
  'welcome',
])

export function getWorkspaceBundlePassphraseBlockReason(value: string) {
  const normalized = normalizePassphrase(value)

  if (!normalized) {
    return 'Enter a workspace backup passphrase.'
  }

  if (isCommonPassphrase(normalized)) {
    return 'Choose a less common workspace backup passphrase.'
  }

  return ''
}

export function canUseWorkspaceBundlePassphrase(value: string) {
  return !getWorkspaceBundlePassphraseBlockReason(value)
}

export function rateWorkspaceBundlePassphrase(value: string): WorkspacePassphraseStrength {
  const normalized = normalizePassphrase(value)
  const blockedReason = getWorkspaceBundlePassphraseBlockReason(value)

  if (!normalized) {
    return {
      label: 'No passphrase',
      tone: 'empty',
      score: 0,
      hints: ['Enter any passphrase to continue.'],
      blockedReason,
    }
  }

  if (blockedReason) {
    return {
      label: 'Blocked',
      tone: 'blocked',
      score: 0,
      hints: [blockedReason],
      blockedReason,
    }
  }

  const length = normalized.length
  const hasSpecial = /[^A-Za-z0-9]/.test(normalized)
  const hasLetters = /[A-Za-z]/.test(normalized)
  const hasDigits = /\d/.test(normalized)
  const hasMixedCase = /[a-z]/.test(normalized) && /[A-Z]/.test(normalized)
  const hasRepeatingRun = /(.)\1{2,}/.test(normalized)
  const uniqueRatio = new Set(normalized.toLowerCase()).size / Math.max(length, 1)
  const isMostlyRepeated = length >= 4 && uniqueRatio <= 0.35
  const hints: string[] = []

  let score = 1

  if (length >= 8) {
    score += 1
  } else {
    hints.push('Short is allowed, but longer is harder to guess.')
  }

  if (length >= 14) {
    score += 1
  }

  if (length >= 20) {
    score += 1
  }

  if (hasSpecial) {
    score += 1
  } else {
    hints.push('Add a symbol for a stronger passphrase.')
  }

  if (hasLetters && hasDigits) {
    score += 1
  }

  if (hasMixedCase) {
    score += 1
  }

  if (hasRepeatingRun || isMostlyRepeated) {
    score -= 2
    hints.push('Avoid repeated characters.')
  }

  score = Math.max(1, Math.min(score, 4))

  if (!hints.length) {
    hints.push('Good choice.')
  }

  return {
    label: strengthLabel(score),
    tone: strengthTone(score),
    score,
    hints,
  }
}

function normalizePassphrase(value: string) {
  return value.trim()
}

function isCommonPassphrase(value: string) {
  const folded = value.toLowerCase()
  const compact = folded.replace(/[\s._-]+/g, '')
  const alphanumeric = folded.replace(/[^a-z0-9]/g, '')

  return (
    COMMON_WORKSPACE_PASSPHRASES.has(folded) ||
    COMMON_WORKSPACE_PASSPHRASES.has(compact) ||
    COMMON_WORKSPACE_PASSPHRASES.has(alphanumeric)
  )
}

function strengthLabel(score: number) {
  if (score >= 4) {
    return 'Very strong'
  }

  if (score === 3) {
    return 'Strong'
  }

  if (score === 2) {
    return 'Okay'
  }

  return 'Weak'
}

function strengthTone(score: number): WorkspacePassphraseStrengthTone {
  if (score >= 4) {
    return 'excellent'
  }

  if (score === 3) {
    return 'strong'
  }

  if (score === 2) {
    return 'fair'
  }

  return 'weak'
}
