import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

const SECRET_REPLACEMENT = '********'

export function redisStreamEditRequest(request: DataEditPlanRequest) {
  const key = request.target.key ?? '<key>'

  if (request.editKind === 'stream-add-entry') {
    const fields = redisStreamEntryFields(request)
    return `XADD ${key} ${redisStreamAddEntryId(request)} ${fields || '<field> <value>'}`
  }

  if (request.editKind === 'stream-delete-entry') {
    const ids = redisStreamDeleteEntryIds(request)
    return `XDEL ${key} ${ids.length ? ids.join(' ') : '<entry-id>'}`
  }

  return undefined
}

function redisStreamAddEntryId(request: DataEditPlanRequest) {
  return commandArg(request.target.documentId ?? request.changes[0]?.newName ?? '*')
}

function redisStreamDeleteEntryIds(request: DataEditPlanRequest) {
  return [
    request.target.documentId === undefined ? undefined : commandArg(request.target.documentId),
    ...request.changes.map((change) => change.field ?? change.path?.[0]),
  ].filter((value): value is string => Boolean(value?.trim()))
}

function redisStreamEntryFields(request: DataEditPlanRequest) {
  const firstValue = request.changes[0]?.value
  if (
    request.changes.length === 1 &&
    firstValue &&
    typeof firstValue === 'object' &&
    !Array.isArray(firstValue)
  ) {
    return Object.entries(firstValue as Record<string, unknown>)
      .map(([field, value]) => `${field} ${secretAwareCommandValue(field, value)}`)
      .join(' ')
  }

  return request.changes
    .map((change) => {
      const field = change.field ?? change.path?.[0]
      return field ? `${field} ${secretAwareCommandValue(field, change.value ?? '<value>')}` : ''
    })
    .filter(Boolean)
    .join(' ')
}

function secretAwareCommandValue(name: string, value: unknown) {
  return isSecretLikeName(name) ? SECRET_REPLACEMENT : commandArg(value)
}

function commandArg(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function isSecretLikeName(value: string) {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')
  return /(^|_)(password|pwd|pass|token|secret|secretkey|apikey|api_key|authtoken|auth_token|accesstoken|access_token)($|_)/.test(normalized)
}
