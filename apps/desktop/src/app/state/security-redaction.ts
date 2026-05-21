const SECRET_REPLACEMENT = '********'

const SECRET_ASSIGNMENT =
  /\b(password|pwd|pass|access[_ -]?token|auth[_ -]?token|sharedaccesskey|shared access key|secret(?:key)?|api[_ -]?key|token)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^;,\s}]+)/gi

const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)([^/?#@\s]+)@/gi

const BEARER_TOKEN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi

export function redactSensitiveText(value: string) {
  return value
    .replace(URL_CREDENTIALS, (_match, scheme: string) => `${scheme}${SECRET_REPLACEMENT}@`)
    .replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=${SECRET_REPLACEMENT}`)
    .replace(BEARER_TOKEN, (_match, scheme: string) => `${scheme} ${SECRET_REPLACEMENT}`)
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
