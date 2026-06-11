import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

const SECRET_REPLACEMENT = '********'

export function redisJsonPath(change?: DataEditPlanRequest['changes'][number]) {
  if (change?.field) {
    return isRedisJsonPath(change.field)
      ? change.field
      : redisJsonPathFromSegments([change.field])
  }

  if (!change?.path?.length) {
    return '$'
  }

  if (change.path.length === 1 && isRedisJsonPath(change.path[0] ?? '')) {
    return change.path[0] ?? '$'
  }

  return redisJsonPathFromSegments(change.path)
}

export function secretAwareRedisJsonCommandValue(path: string, value: unknown) {
  return isSecretLikeName(path) ? JSON.stringify(SECRET_REPLACEMENT) : redisJsonValueArg(value)
}

function redisJsonPathFromSegments(segments: string[]) {
  return segments.reduce((path, segment) => {
    if (/^\d+$/.test(segment)) {
      return `${path}[${segment}]`
    }

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
      return `${path}.${segment}`
    }

    return `${path}[${JSON.stringify(segment)}]`
  }, '$')
}

function isRedisJsonPath(value: string) {
  return value === '$' || value.startsWith('$.') || value.startsWith('$[')
}

function redisJsonValueArg(value: unknown) {
  return value === '<json>' ? '<json>' : JSON.stringify(value) ?? 'null'
}

function isSecretLikeName(value: string) {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')
  return /(^|_)(password|pwd|pass|token|secret|secretkey|apikey|api_key|authtoken|auth_token|accesstoken|access_token)($|_)/.test(normalized)
}
