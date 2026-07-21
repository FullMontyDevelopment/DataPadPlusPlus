export const MAX_ID_LENGTH = 160
export const MAX_SCOPE_LENGTH = 512
export const MAX_OBJECT_NAME_LENGTH = 512
export const MAX_DATA_EDIT_CHANGES = 100
export const MAX_REDIS_DATABASE = 1024
export const MAX_ROW_LIMIT = 10_000
export const MAX_EXPLORER_LIMIT = 500
export const MAX_STRUCTURE_LIMIT = 1_000
export const MAX_REDIS_COUNT = 1_000
export const MAX_REDIS_PAGE_SIZE = 1_000
export const MAX_REDIS_SAMPLE_SIZE = 5_000
export const MAX_LOCAL_SAVE_PATH_LENGTH = 32_768
export const MAX_RESULT_PAGE_SIZE = 1000
export const MAX_RESULT_PAGE_INDEX = 100_000

const MAX_JSON_BYTES = 64 * 1024
const MAX_PATH_SEGMENTS = 64
const MAX_PATH_SEGMENT_LENGTH = 256
const MAX_QUERY_TEXT_BYTES = 1024 * 1024

export const DATA_EDIT_KINDS = new Set([
  'insert-row',
  'update-row',
  'delete-row',
  'set-field',
  'unset-field',
  'rename-field',
  'change-field-type',
  'insert-document',
  'set-key-value',
  'set-ttl',
  'delete-key',
  'rename-key',
  'persist-ttl',
  'hash-set-field',
  'hash-delete-field',
  'list-push',
  'list-set-index',
  'list-remove-value',
  'set-add-member',
  'set-remove-member',
  'zset-add-member',
  'zset-remove-member',
  'stream-add-entry',
  'stream-delete-entry',
  'json-set-path',
  'json-delete-path',
  'timeseries-add-sample',
  'timeseries-delete-sample',
  'vector-add-member',
  'vector-remove-member',
  'vector-set-attributes',
  'put-item',
  'update-item',
  'delete-item',
  'index-document',
  'update-document',
  'delete-document',
])

export const RESULT_RENDERERS = new Set([
  'table',
  'json',
  'document',
  'keyvalue',
  'raw',
  'resp',
  'schema',
  'graph',
  'chart',
  'diff',
  'plan',
  'metrics',
  'series',
  'searchHits',
  'profile',
  'costEstimate',
  'batch',
])

export const QUERY_LANGUAGES = new Set([
  'sql',
  'mongodb',
  'redis',
  'cypher',
  'flux',
  'text',
  'json',
  'cql',
  'aql',
  'gremlin',
  'sparql',
  'promql',
  'influxql',
  'opentsdb',
  'query-dsl',
  'esql',
  'google-sql',
  'snowflake-sql',
  'clickhouse-sql',
])

export function validateOperationId(value: string) {
  validateRequiredText(value, 'Operation id', MAX_ID_LENGTH)
  if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value)) {
    throw new Error('Operation id contains unsupported characters.')
  }
}

export function validateRequiredId(value: string | null | undefined, label: string) {
  validateRequiredText(value, label, MAX_ID_LENGTH)
  if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value ?? '')) {
    throw new Error(`${label} contains unsupported characters.`)
  }
}

export function validateOptionalId(value: string | null | undefined, label: string) {
  if (value !== undefined && value !== null) {
    validateRequiredId(value, label)
  }
}

export function validateRequiredText(
  value: string | null | undefined,
  label: string,
  maxLength: number,
) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  validateOptionalText(value, label, maxLength)
}

export function validateOptionalText(
  value: string | null | undefined,
  label: string,
  maxLength: number,
) {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text.`)
  }
  if (value.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`)
  }
  if (containsControlCharacter(value)) {
    throw new Error(`${label} cannot contain control characters.`)
  }
  return value
}

export function validatePath(path: string[] | null | undefined, label: string) {
  if (!Array.isArray(path)) {
    throw new Error(`${label} must be an array.`)
  }
  if (path.length > MAX_PATH_SEGMENTS) {
    throw new Error(`${label} can contain at most ${MAX_PATH_SEGMENTS} segments.`)
  }
  for (const segment of path) {
    validateRequiredText(segment, `${label} segment`, MAX_PATH_SEGMENT_LENGTH)
  }
}

export function clampOptionalInteger(
  value: number | undefined,
  label: string,
  min: number,
  max: number,
) {
  if (value === undefined) {
    return value
  }
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }
  const integer = Math.trunc(value)
  return Math.min(Math.max(integer, min), max)
}

export function assertJsonSize(value: unknown, label: string) {
  if (value === undefined) {
    return
  }
  const size = new TextEncoder().encode(JSON.stringify(value)).byteLength
  if (size > MAX_JSON_BYTES) {
    throw new Error(`${label} is too large for a desktop command.`)
  }
}

export function validateQueryText(
  value: string | null | undefined,
  label: string,
) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text.`)
  }
  if (new TextEncoder().encode(value).byteLength > MAX_QUERY_TEXT_BYTES) {
    throw new Error(`${label} is too large for a desktop command.`)
  }
  if (value.includes('\0')) {
    throw new Error(`${label} cannot contain null bytes.`)
  }
}

export function isAbsolutePath(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/')
}

export function stripWindowsDrivePrefix(path: string) {
  return path.replace(/^[A-Za-z]:/, '')
}

function containsControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
}
