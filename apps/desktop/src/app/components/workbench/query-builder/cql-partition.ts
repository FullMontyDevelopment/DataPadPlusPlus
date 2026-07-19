import type {
  CqlBuilderValueType,
  CqlConditionOperator,
  CqlConditionRow,
  CqlPartitionBuilderState,
  QueryBuilderState,
} from '@datapadplusplus/shared-types'

const OPERATORS: Record<CqlConditionOperator, string> = {
  eq: '=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  in: 'IN',
  contains: 'CONTAINS',
}

export function createDefaultCqlPartitionBuilderState(
  table = '',
  keyspace = '',
  limit = 20,
): CqlPartitionBuilderState {
  const state: CqlPartitionBuilderState = {
    kind: 'cql-partition',
    keyspace,
    table,
    projectionFields: [],
    partitionKeys: [newCqlCondition()],
    clusteringKeys: [],
    filters: [],
    allowFiltering: false,
    limit,
  }

  return {
    ...state,
    lastAppliedQueryText: buildCqlPartitionQueryText(state),
  }
}

export function isCqlPartitionBuilderState(
  state: QueryBuilderState | undefined,
): state is CqlPartitionBuilderState {
  return state?.kind === 'cql-partition'
}

export function buildCqlPartitionQueryText(state: CqlPartitionBuilderState) {
  const columns = state.projectionFields
    .map((field) => field.field.trim())
    .filter(Boolean)
    .map(quoteCqlIdentifier)
  const target = cqlTarget(state.keyspace, state.table)
  const predicates = [
    ...state.partitionKeys,
    ...state.clusteringKeys,
    ...state.filters,
  ]
    .filter((row) => row.enabled ?? true)
    .map(cqlCondition)
    .filter(Boolean)
  const lines = [
    `select ${columns.length ? columns.join(', ') : '*'}`,
    `from ${target}`,
  ]

  if (predicates.length > 0) {
    lines.push(`where ${predicates.join(' and ')}`)
  }

  if (state.limit && state.limit > 0) {
    lines.push(`limit ${Math.floor(state.limit)}`)
  }

  if (state.allowFiltering) {
    lines.push('allow filtering')
  }

  return `${lines.join('\n')};`
}

export function buildCqlPartitionCountQueryText(state: CqlPartitionBuilderState) {
  const target = cqlTarget(state.keyspace, state.table)
  const predicates = [
    ...state.partitionKeys,
    ...state.clusteringKeys,
    ...state.filters,
  ]
    .filter((row) => row.enabled ?? true)
    .map(cqlCondition)
    .filter(Boolean)
  const lines = ['select count(*) as count', `from ${target}`]

  if (predicates.length > 0) {
    lines.push(`where ${predicates.join(' and ')}`)
  }
  if (state.allowFiltering) {
    lines.push('allow filtering')
  }

  return `${lines.join('\n')};`
}

export function parseCqlPartitionQueryText(
  queryText: string,
): CqlPartitionBuilderState | undefined {
  const normalized = queryText.replace(/--.*$/gm, ' ').replace(/;+\s*$/g, '').trim()
  const limit = /\blimit\s+(\d+)\b/i.exec(normalized)?.[1]
  const allowFiltering = /\ballow\s+filtering\b/i.test(normalized)
  const statement = normalized
    .replace(/\ballow\s+filtering\b/ig, ' ')
    .replace(/\blimit\s+\d+\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const match = /^select\s+(.+?)\s+from\s+(.+?)(?:\s+where\s+(.+))?$/i.exec(statement)

  if (!match) {
    return undefined
  }

  const target = parseCqlTarget(match[2] ?? '')
  const conditions = parseWhereConditions(match[3] ?? '')
  const state: CqlPartitionBuilderState = {
    kind: 'cql-partition',
    keyspace: target.keyspace,
    table: target.table,
    projectionFields: parseProjectionFields(match[1] ?? '*'),
    partitionKeys: conditions.slice(0, 1),
    clusteringKeys: [],
    filters: conditions.slice(1),
    allowFiltering,
    limit: limit ? Number(limit) : 20,
  }

  if (state.partitionKeys.length === 0) {
    state.partitionKeys = [newCqlCondition()]
  }

  return {
    ...state,
    lastAppliedQueryText: buildCqlPartitionQueryText(state),
  }
}

export function cqlBuilderRowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function newCqlCondition(
  field = '',
  operator: CqlConditionOperator = 'eq',
): CqlConditionRow {
  return {
    id: cqlBuilderRowId('cql-condition'),
    enabled: true,
    field,
    operator,
    value: '',
    valueType: 'string',
  }
}

function cqlCondition(row: CqlConditionRow) {
  const field = row.field.trim()
  if (!field) {
    return ''
  }

  const identifier = quoteCqlIdentifier(field)
  if (row.operator === 'in') {
    return `${identifier} IN (${csvValues(row.value, row.valueType).join(', ')})`
  }
  if (row.operator === 'contains') {
    return `${identifier} CONTAINS ${cqlValue(row.value, row.valueType)}`
  }

  return `${identifier} ${OPERATORS[row.operator]} ${cqlValue(row.value, row.valueType)}`
}

function cqlValue(value: string, type: CqlBuilderValueType) {
  const trimmed = value.trim()
  if (type === 'null') {
    return 'null'
  }
  if (type === 'boolean') {
    return ['true', '1', 'yes'].includes(trimmed.toLowerCase()) ? 'true' : 'false'
  }
  if (type === 'number') {
    return Number.isFinite(Number(trimmed)) ? String(Number(trimmed)) : '0'
  }

  return `'${value.replaceAll("'", "''")}'`
}

function csvValues(value: string, type: CqlBuilderValueType) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => cqlValue(item, type))
}

function cqlTarget(keyspace: string | undefined, table: string) {
  const tableName = table.trim() || 'table'
  return keyspace?.trim()
    ? `${quoteCqlIdentifier(keyspace)}.${quoteCqlIdentifier(tableName)}`
    : quoteCqlIdentifier(tableName)
}

function quoteCqlIdentifier(identifier: string) {
  return /^[a-z][a-z0-9_]*$/.test(identifier)
    ? identifier
    : `"${identifier.replaceAll('"', '""')}"`
}

function parseCqlTarget(target: string) {
  const parts = target
    .split('.')
    .map((part) => unquoteCqlIdentifier(part.trim()))
    .filter(Boolean)

  return {
    keyspace: parts.length > 1 ? parts.at(-2) : undefined,
    table: parts.at(-1) ?? '',
  }
}

function parseProjectionFields(selectList: string) {
  if (selectList.trim() === '*') {
    return []
  }

  return selectList
    .split(',')
    .map((field) => unquoteCqlIdentifier(field.trim()))
    .filter(Boolean)
    .map((field) => ({ id: cqlBuilderRowId('cql-projection'), field }))
}

function parseWhereConditions(whereClause: string) {
  return whereClause
    .split(/\s+and\s+/i)
    .map((part) => parseCondition(part.trim()))
    .filter((condition): condition is CqlConditionRow => Boolean(condition))
}

function parseCondition(condition: string): CqlConditionRow | undefined {
  const match = /^("[^"]+"|[\w.]+)\s*(=|>=|<=|>|<|in|contains)\s*(.+)$/i.exec(condition)
  if (!match?.[1] || !match[2]) {
    return undefined
  }

  const operator = operatorFromToken(match[2])
  return {
    ...newCqlCondition(unquoteCqlIdentifier(match[1]), operator),
    value: cleanCqlValue(match[3] ?? ''),
    valueType: inferValueType(match[3] ?? ''),
  }
}

function operatorFromToken(token: string): CqlConditionOperator {
  switch (token.toLowerCase()) {
    case '>':
      return 'gt'
    case '>=':
      return 'gte'
    case '<':
      return 'lt'
    case '<=':
      return 'lte'
    case 'in':
      return 'in'
    case 'contains':
      return 'contains'
    default:
      return 'eq'
  }
}

function cleanCqlValue(value: string) {
  const trimmed = value.trim().replace(/^\((.*)\)$/s, '$1')
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }
  return trimmed
}

function inferValueType(value: string): CqlBuilderValueType {
  const cleaned = cleanCqlValue(value)
  if (cleaned.toLowerCase() === 'null') {
    return 'null'
  }
  if (cleaned.toLowerCase() === 'true' || cleaned.toLowerCase() === 'false') {
    return 'boolean'
  }
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? 'number' : 'string'
}

function unquoteCqlIdentifier(identifier: string) {
  return identifier.startsWith('"') && identifier.endsWith('"')
    ? identifier.slice(1, -1).replaceAll('""', '"')
    : identifier
}
