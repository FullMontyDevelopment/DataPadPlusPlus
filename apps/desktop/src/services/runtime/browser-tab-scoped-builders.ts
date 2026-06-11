import type { ConnectionProfile, ScopedQueryTarget } from '@datapadplusplus/shared-types'

export function mongoFindQueryText(collection: string, limit: number, database?: string) {
  const trimmedDatabase = database?.trim()

  return JSON.stringify(
    {
      ...(trimmedDatabase ? { database: trimmedDatabase } : {}),
      collection,
      filter: {},
      limit,
    },
    null,
    2,
  )
}

export function mongoAggregationQueryText(collection: string, limit: number, database?: string) {
  const trimmedDatabase = database?.trim()

  return JSON.stringify(
    {
      ...(trimmedDatabase ? { database: trimmedDatabase } : {}),
      collection,
      operation: 'aggregate',
      pipeline: [{ $match: {} }, { $limit: limit }],
      limit,
    },
    null,
    2,
  )
}

export function mongoScriptFindText(collection: string | undefined) {
  return collection ? `db.${collection}.find({}).limit(20)` : ''
}

export function mongoScriptAggregationText(collection: string | undefined) {
  return collection
    ? `db.${collection}.aggregate([{ $match: {} }, { $limit: 20 }])`
    : ''
}

export function redisKeyBrowserQueryText(
  pattern: string,
  count = 100,
  databaseIndex?: number,
) {
  return JSON.stringify(
    {
      mode: 'redis-key-browser',
      ...(databaseIndex !== undefined ? { database: databaseIndex } : {}),
      pattern,
      type: 'all',
      count,
    },
    null,
    2,
  )
}

export function redisPatternFromTarget(target: ScopedQueryTarget) {
  if (target.kind === 'database' || /^db:\d+(?::|$)/.test(target.scope ?? '')) {
    return '*'
  }

  const scopedPrefix = target.scope?.startsWith('prefix:')
    ? target.scope.replace('prefix:', '')
    : undefined
  const candidate = scopedPrefix || target.label || '*'

  if (candidate.includes('*')) {
    return candidate
  }

  if (candidate.endsWith(':')) {
    return `${candidate}*`
  }

  return candidate
}

export function redisDatabaseIndexFromTarget(target: ScopedQueryTarget) {
  const scopedDatabase = /^db:(\d+)(?::|$)/.exec(target.scope ?? '')?.[1]
  const labelDatabase = /^DB\s+(\d+)$/i.exec(target.label.trim())?.[1]
  const pathDatabase = (target.path ?? [])
    .map((part) => /^DB\s+(\d+)$/i.exec(part.trim())?.[1])
    .find(Boolean)
  const candidate = scopedDatabase ?? labelDatabase ?? pathDatabase

  if (!candidate) return undefined

  const parsed = Number.parseInt(candidate, 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined
}

export function cassandraPartitionKeyFromTarget(target: ScopedQueryTarget) {
  const queryText = target.queryTemplate ?? ''
  const match = /\bwhere\s+"?([A-Za-z_][\w]*)"?\s*=/i.exec(queryText)
  return match?.[1] ?? ''
}

export function cassandraTargetFromTarget(
  target: ScopedQueryTarget,
  connection: ConnectionProfile,
  fallbackTable: string,
) {
  const parsed = cqlTargetFromQueryTemplate(target.queryTemplate)
  return {
    keyspace: parsed.keyspace ?? cassandraKeyspaceFromTarget(target, connection),
    table:
      parsed.table ??
      tableFromScopedIdentity(target.scope) ??
      normalizeOptionalObjectName(fallbackTable) ??
      '',
  }
}

export function dynamoTableNameFromTarget(
  target: ScopedQueryTarget,
  fallbackTable: string,
) {
  const parsed = jsonObjectFromTemplate(target.queryTemplate)
  return (
    normalizeOptionalObjectName(stringField(parsed, 'tableName')) ??
    normalizeOptionalObjectName(stringField(parsed, 'TableName')) ??
    normalizeOptionalObjectName(fallbackTable) ??
    ''
  )
}

export function searchIndexFromTarget(target: ScopedQueryTarget, fallbackIndex: string) {
  const parsed = jsonObjectFromTemplate(target.queryTemplate)
  return (
    normalizeOptionalObjectName(stringField(parsed, 'index')) ??
    normalizeOptionalObjectName(fallbackIndex) ??
    ''
  )
}

function cassandraKeyspaceFromTarget(
  target: ScopedQueryTarget,
  connection: ConnectionProfile,
) {
  const scoped = target.scope?.replace('table:', '')
  const scopedKeyspace = scoped?.includes('.') ? scoped.split('.')[0] : undefined
  const pathKeyspace = target.path?.find(
    (segment) =>
      !['Keyspaces', 'Tables', 'Data', 'Materialized Views'].includes(segment) &&
      segment !== target.label,
  )

  return scopedKeyspace || pathKeyspace || connection.database || ''
}

function jsonObjectFromTemplate(template: string | undefined) {
  if (typeof template !== 'string' || !template.trim().startsWith('{')) {
    return undefined
  }

  try {
    const parsed = JSON.parse(template) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function stringField(object: Record<string, unknown> | undefined, key: string) {
  const value = object?.[key]
  return typeof value === 'string' ? value : undefined
}

function cqlTargetFromQueryTemplate(template: string | undefined) {
  if (typeof template !== 'string') {
    return {}
  }

  const match = /\bfrom\s+((?:"(?:[^"]|"")+"|[A-Za-z_][\w]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_][\w]*))?)/i.exec(template)
  if (!match?.[1]) {
    return {}
  }

  const parts = cqlIdentifierParts(match[1])
  return {
    keyspace: parts.length > 1 ? parts.at(-2) : undefined,
    table: parts.at(-1),
  }
}

function tableFromScopedIdentity(scope: string | undefined) {
  const identity = scope?.split(':').slice(1).join(':')
  if (!identity) {
    return undefined
  }

  const parts = identity.split('.').map((part) => part.trim()).filter(Boolean)
  return normalizeOptionalObjectName(parts.at(-1))
}

function cqlIdentifierParts(value: string) {
  const parts: string[] = []
  const matcher = /"((?:[^"]|"")*)"|([A-Za-z_][\w]*)/g
  let match: RegExpExecArray | null

  while ((match = matcher.exec(value))) {
    parts.push((match[1] ?? match[2] ?? '').replaceAll('""', '"'))
  }

  return parts.filter(Boolean)
}

function normalizeOptionalObjectName(value: string | undefined) {
  const trimmed = typeof value === 'string' ? value.trim() : undefined
  return trimmed ? trimmed : undefined
}
