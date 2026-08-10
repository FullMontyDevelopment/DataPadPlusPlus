import type {
  CqlBuilderValueType,
  CqlConditionOperator,
  CqlConditionRow,
  CqlPartitionBuilderState,
  QueryBuilderState,
} from '@datapadplusplus/shared-types'
import { parseQueryBuilderValue } from './query-value-codec'

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
  if (!conditions) {
    return undefined
  }
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
  return cqlParsedValue(parseQueryBuilderValue(value, type), type)
}

function csvValues(value: string, type: CqlBuilderValueType) {
  const parsed = parseQueryBuilderValue(value, type, { operator: 'in' })
  return (parsed as unknown[]).map((item) => cqlParsedValue(item, type))
}

function cqlParsedValue(value: unknown, type: CqlBuilderValueType) {
  if (value === null) return 'null'
  if (type === 'boolean' || type === 'number' || type === 'uuid') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
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

function parseWhereConditions(whereClause: string): CqlConditionRow[] | undefined {
  if (!whereClause.trim()) {
    return []
  }
  if (containsTopLevelCqlKeyword(whereClause, 'or')) {
    return undefined
  }

  const parts = splitCqlConjunctions(whereClause)
  if (!parts) {
    return undefined
  }

  const conditions: CqlConditionRow[] = []
  for (const part of parts) {
    const condition = parseCondition(part)
    if (!condition) {
      return undefined
    }
    conditions.push(condition)
  }
  return conditions
}

function containsTopLevelCqlKeyword(value: string, keyword: string) {
  let depth = 0
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (quoted) {
      continue
    }
    if (character === '(') {
      depth += 1
      continue
    }
    if (character === ')') {
      depth -= 1
      continue
    }
    if (
      depth === 0 &&
      value.slice(index, index + keyword.length).toLowerCase() === keyword &&
      /\s/.test(value[index - 1] ?? '') &&
      /\s/.test(value[index + keyword.length] ?? '')
    ) {
      return true
    }
  }
  return false
}

function splitCqlConjunctions(whereClause: string): string[] | undefined {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let quoted = false

  for (let index = 0; index < whereClause.length; index += 1) {
    const character = whereClause[index]
    if (character === "'") {
      if (quoted && whereClause[index + 1] === "'") {
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (quoted) {
      continue
    }
    if (character === '(') {
      depth += 1
      continue
    }
    if (character === ')') {
      depth -= 1
      if (depth < 0) {
        return undefined
      }
      continue
    }
    if (
      depth === 0 &&
      whereClause.slice(index, index + 3).toLowerCase() === 'and' &&
      /\s/.test(whereClause[index - 1] ?? '') &&
      /\s/.test(whereClause[index + 3] ?? '')
    ) {
      const part = whereClause.slice(start, index).trim()
      if (!part) {
        return undefined
      }
      parts.push(part)
      index += 2
      start = index + 1
    }
  }

  const finalPart = whereClause.slice(start).trim()
  if (quoted || depth !== 0 || !finalPart) {
    return undefined
  }
  parts.push(finalPart)
  return parts
}

function parseCondition(condition: string): CqlConditionRow | undefined {
  const match = /^("[^"]+"|[\w.]+)\s*(=|>=|<=|>|<|in|contains)\s*(.+)$/i.exec(condition)
  if (!match?.[1] || !match[2]) {
    return undefined
  }

  const operator = operatorFromToken(match[2])
  if (operator === 'in') {
    const values = parseCqlInValues(match[3] ?? '')
    if (!values) {
      return undefined
    }
    const valueTypes = values.map(inferValueType)
    if (new Set(valueTypes).size !== 1) {
      return undefined
    }
    const cleanedValues = values.map(cleanCqlValue)
    if (cleanedValues.some((value) => value.includes(','))) {
      return undefined
    }
    return {
      ...newCqlCondition(unquoteCqlIdentifier(match[1]), operator),
      value: cleanedValues.join(', '),
      valueType: valueTypes[0] ?? 'string',
    }
  }
  return {
    ...newCqlCondition(unquoteCqlIdentifier(match[1]), operator),
    value: cleanCqlValue(match[3] ?? ''),
    valueType: inferValueType(match[3] ?? ''),
  }
}

function parseCqlInValues(value: string): string[] | undefined {
  const trimmed = value.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
    return undefined
  }

  const content = trimmed.slice(1, -1)
  const values: string[] = []
  let start = 0
  let quoted = false
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "'") {
      if (quoted && content[index + 1] === "'") {
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (!quoted && content[index] === ',') {
      const item = content.slice(start, index).trim()
      if (!item) {
        return undefined
      }
      values.push(item)
      start = index + 1
    }
  }

  if (quoted) {
    return undefined
  }
  const last = content.slice(start).trim()
  if (!last) {
    return undefined
  }
  values.push(last)
  return values
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
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned)) {
    return 'uuid'
  }
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? 'number' : 'string'
}

function unquoteCqlIdentifier(identifier: string) {
  return identifier.startsWith('"') && identifier.endsWith('"')
    ? identifier.slice(1, -1).replaceAll('""', '"')
    : identifier
}
