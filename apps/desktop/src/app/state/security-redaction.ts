const SECRET_REPLACEMENT = '********'

const SECRET_ASSIGNMENT =
  /(["']?)(\b(?:password|pwd|pass|access[_ -]?token|auth[_ -]?token|refresh[_ -]?token|sharedaccesskey|shared access key|client[_ -]?secret|secret(?:key)?|api[_ -]?key|private[_ -]?key|token)\b)\1(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s;&,}\][{][^;&,\s}\]]*)/gi

const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)([^/?#@\s]+)@/gi

const BEARER_TOKEN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi

export function redactSensitiveText(value: string) {
  return value
    .replace(URL_CREDENTIALS, (_match, scheme: string) => `${scheme}${SECRET_REPLACEMENT}@`)
    .replace(
      SECRET_ASSIGNMENT,
      (
        _match,
        quote: string,
        key: string,
        separator: string,
        rawValue: string,
      ) => `${quote}${key}${quote}${separator}${redactedReplacementForValue(rawValue)}`,
    )
    .replace(BEARER_TOKEN, (_match, scheme: string) => `${scheme} ${SECRET_REPLACEMENT}`)
}

function redactedReplacementForValue(value: string) {
  return value.startsWith('"')
    ? `"${SECRET_REPLACEMENT}"`
    : value.startsWith("'")
      ? `'${SECRET_REPLACEMENT}'`
      : SECRET_REPLACEMENT
}

export function redactErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return redactSensitiveText(error.message)
  }

  if (typeof error === 'string') {
    return redactSensitiveText(error)
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message

    if (typeof message === 'string' && message.length > 0) {
      return redactSensitiveText(message)
    }
  }

  return fallback
}

export function connectionStringContainsPlainSecret(connectionString: unknown) {
  if (typeof connectionString !== 'string') {
    return false
  }

  return (
    urlConnectionStringContainsSecret(connectionString) ||
    keyValueConnectionStringContainsSecret(connectionString) ||
    queryParameterContainsSecret(connectionString)
  )
}

function urlConnectionStringContainsSecret(value: string) {
  const schemeIndex = value.indexOf('://')
  if (schemeIndex < 0) {
    return false
  }

  const authorityStart = schemeIndex + 3
  const authorityEndCandidates = ['/', '?', '#']
    .map((character) => value.indexOf(character, authorityStart))
    .filter((index) => index >= 0)
  const authorityEnd = authorityEndCandidates.length
    ? Math.min(...authorityEndCandidates)
    : value.length
  const authority = value.slice(authorityStart, authorityEnd)
  const userInfoEnd = authority.lastIndexOf('@')

  if (userInfoEnd < 0) {
    return false
  }

  const [, password] = authority.slice(0, userInfoEnd).split(':', 2)
  return isPlainSecretLiteral(password)
}

function keyValueConnectionStringContainsSecret(value: string) {
  return value.split(';').some((part) => {
    const [key, rawValue] = part.split('=', 2)
    if (!key || rawValue === undefined || !isPlainSecretLiteral(rawValue)) {
      return false
    }

    return secretAssignmentKeys.has(normalizeSecretAssignmentKey(key))
  })
}

function queryParameterContainsSecret(value: string) {
  const queryStart = value.indexOf('?')
  if (queryStart < 0) {
    return false
  }

  return value.slice(queryStart + 1).split('&').some((part) => {
    const [key, rawValue] = part.split('=', 2)
    if (!key || rawValue === undefined || !isPlainSecretLiteral(rawValue)) {
      return false
    }

    return secretAssignmentKeys.has(normalizeSecretAssignmentKey(key))
  })
}

function normalizeSecretAssignmentKey(value: string) {
  return value.trim().toLowerCase().replaceAll('-', '_')
}

const secretAssignmentKeys = new Set([
  'password',
  'pwd',
  'pass',
  'access token',
  'access_token',
  'auth_token',
  'client secret',
  'client_secret',
  'private key',
  'private_key',
  'refresh token',
  'refresh_token',
  'sharedaccesskey',
  'shared access key',
  'secret',
  'secretkey',
  'secret key',
  'apikey',
  'api key',
  'api_key',
  'token',
])

function isPlainSecretLiteral(value: unknown) {
  const trimmed = typeof value === 'string' ? value.trim() : undefined
  return Boolean(
    trimmed &&
      !(trimmed.startsWith('${') && trimmed.endsWith('}')) &&
      !(trimmed.startsWith('{{') && trimmed.endsWith('}}')) &&
      !['****', '***', '<secret>', '<redacted>'].includes(trimmed),
  )
}
