import type {
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'

export type JsonRecord = Record<string, unknown>
export type OracleTableRows = {
  columns: string[]
  rows: string[][]
}

export function oracleObjectRows(kind: string, payload: JsonRecord): OracleTableRows {
  const rowSources: Record<string, [unknown, string[]]> = {
    tables: [payload.tables, ['Owner', 'Table', 'Status', 'Tablespace']],
    views: [payload.views, ['Owner', 'View', 'Text length', 'Status']],
    'materialized-views': [payload.materializedViews, ['Owner', 'Name', 'Refresh mode', 'Status']],
    sequences: [payload.sequences, ['Owner', 'Sequence', 'Increment', 'Cache']],
    synonyms: [payload.synonyms, ['Owner', 'Synonym', 'Target owner', 'Target object']],
    indexes: [payload.indexes, ['Owner', 'Index', 'Table', 'Status']],
    constraints: [payload.constraints, ['Owner', 'Constraint', 'Type', 'Status']],
    triggers: [payload.triggers, ['Owner', 'Trigger', 'Event', 'Status']],
    packages: [payload.packages, ['Owner', 'Package', 'Type', 'Status']],
    procedures: [payload.procedures, ['Owner', 'Procedure', 'Status', 'Last DDL']],
    functions: [payload.functions, ['Owner', 'Function', 'Status', 'Last DDL']],
    types: [payload.types, ['Owner', 'Type', 'Kind', 'Status']],
  }
  const [source, columns] = rowSources[kind] ?? [payload.objects, ['Owner', 'Object', 'Type', 'Status']]
  const records = arrayOfRecords(source)

  return {
    columns,
    rows: records.map((row) => [
      stringValue(row.owner ?? row.schema),
      stringValue(row.name ?? row.objectName ?? row.tableName ?? row.viewName ?? row.indexName ?? row.sequenceName),
      stringValue(row.status ?? row.type ?? row.objectType ?? row.refreshMode ?? row.increment),
      stringValue(row.tablespace ?? row.tablespaceName ?? row.target ?? row.detail ?? row.lastDdlTime),
    ]),
  }
}

export function oracleSecurityRows(kind: string, payload: JsonRecord): OracleTableRows {
  if (kind === 'roles') {
    return {
      columns: ['Role', 'Source', 'Default', 'Admin option'],
      rows: arrayOfRecords(payload.roles).map((role) => [
        stringValue(role.role),
        stringValue(role.source ?? role.owner),
        stringValue(role.defaultRole ?? role.default),
        stringValue(role.adminOption),
      ]),
    }
  }

  if (kind === 'profiles') {
    return {
      columns: ['Profile', 'Resource', 'Limit', 'Type'],
      rows: arrayOfRecords(payload.profiles).map((profile) => [
        stringValue(profile.profile),
        stringValue(profile.resourceName ?? profile.resource),
        stringValue(profile.limit),
        stringValue(profile.resourceType ?? profile.type),
      ]),
    }
  }

  if (kind === 'privileges' || kind === 'permissions') {
    return {
      columns: ['Grantee', 'Privilege', 'Object', 'Grantable'],
      rows: arrayOfRecords(payload.grants ?? payload.privileges).map((grant) => [
        stringValue(grant.grantee ?? grant.owner),
        stringValue(grant.privilege),
        stringValue(grant.objectName ?? grant.object ?? grant.tableName),
        stringValue(grant.grantable),
      ]),
    }
  }

  return {
    columns: ['User', 'Account status', 'Default tablespace', 'Profile'],
    rows: arrayOfRecords(payload.users).map((user) => [
      stringValue(user.username ?? user.user),
      stringValue(user.accountStatus ?? user.status),
      stringValue(user.defaultTablespace),
      stringValue(user.profile),
    ]),
  }
}

export function oracleStorageRows(kind: string, payload: JsonRecord): OracleTableRows {
  if (kind === 'segments') {
    return {
      columns: ['Owner', 'Segment', 'Type', 'Size'],
      rows: arrayOfRecords(payload.segments).map((segment) => [
        stringValue(segment.owner),
        stringValue(segment.name ?? segment.segmentName),
        stringValue(segment.type ?? segment.segmentType),
        bytesText(segment.bytes),
      ]),
    }
  }

  if (kind === 'data-files') {
    return {
      columns: ['Tablespace', 'File', 'Size', 'Status'],
      rows: arrayOfRecords(payload.dataFiles).map((file) => [
        stringValue(file.tablespaceName ?? file.tablespace),
        stringValue(file.fileName ?? file.name),
        bytesText(file.bytes),
        stringValue(file.status),
      ]),
    }
  }

  if (kind === 'quotas') {
    return {
      columns: ['Tablespace', 'Used', 'Limit', 'Blocks'],
      rows: arrayOfRecords(payload.quotas).map((quota) => [
        stringValue(quota.tablespaceName ?? quota.tablespace),
        bytesText(quota.bytes),
        bytesText(quota.maxBytes),
        stringValue(quota.blocks),
      ]),
    }
  }

  return {
    columns: ['Tablespace', 'Status', 'Contents', 'Extent management'],
    rows: arrayOfRecords(payload.tablespaces).map((tablespace) => [
      stringValue(tablespace.name ?? tablespace.tablespaceName),
      stringValue(tablespace.status),
      stringValue(tablespace.contents),
      stringValue(tablespace.extentManagement),
    ]),
  }
}

export function oraclePerformanceRows(kind: string, payload: JsonRecord): OracleTableRows {
  if (kind === 'execution-plan') {
    return {
      columns: ['Id', 'Operation', 'Object', 'Rows', 'Cost'],
      rows: arrayOfRecords(payload.planLines).map((line) => [
        stringValue(line.id),
        stringValue(line.operation),
        stringValue(line.objectName ?? line.object),
        stringValue(line.rows),
        stringValue(line.cost),
      ]),
    }
  }

  if (kind === 'locks') {
    return {
      columns: ['SID', 'Type', 'Mode held', 'Request', 'Blocking'],
      rows: arrayOfRecords(payload.locks).map((lock) => [
        stringValue(lock.sid),
        stringValue(lock.type),
        stringValue(lock.modeHeld ?? lock.lmode),
        stringValue(lock.request),
        stringValue(lock.blocking),
      ]),
    }
  }

  if (kind === 'invalid-objects') {
    return {
      columns: ['Owner', 'Object', 'Type', 'Status'],
      rows: arrayOfRecords(payload.invalidObjects).map((item) => [
        stringValue(item.owner),
        stringValue(item.name ?? item.objectName),
        stringValue(item.type ?? item.objectType),
        stringValue(item.status),
      ]),
    }
  }

  if (kind === 'sql-monitor') {
    return {
      columns: ['SQL ID', 'Status', 'Elapsed', 'SQL text'],
      rows: arrayOfRecords(payload.topSql ?? payload.sqlMonitor).map((sql) => [
        stringValue(sql.sqlId),
        stringValue(sql.status),
        stringValue(sql.elapsedMs),
        sqlTextSummary(sql.sqlText),
      ]),
    }
  }

  return {
    columns: ['SID', 'User', 'Status', 'Wait / Event'],
    rows: arrayOfRecords(payload.sessions).map((session) => [
      stringValue(session.sid),
      stringValue(session.username),
      stringValue(session.status),
      stringValue(session.waitClass ?? session.event),
    ]),
  }
}

export function oracleQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state?.queryTemplate) {
    return undefined
  }

  return {
    kind: state.kind,
    label: state.label,
    path: state.path,
    queryTemplate: state.queryTemplate,
    preferredBuilder: state.kind === 'table' ? 'sql-select' : undefined,
  }
}

export function sourceLinesFromPayload(payload: JsonRecord) {
  const lines = payload.sourceLines
  if (!Array.isArray(lines)) {
    return []
  }

  return lines.map((line, index) => {
    if (typeof line === 'string') {
      return { line: String(index + 1), text: line }
    }

    const record = asRecord(line)
    return {
      line: stringValue(record.line ?? index + 1),
      text: stringValue(record.text ?? record.source),
    }
  }).filter((line) => line.text)
}

export function oracleSourceOutline(sourceLines: Array<{ line: string; text: string }>) {
  const declarationPattern = /\b(package|procedure|function|type|trigger|cursor)\b/i
  const declarations = sourceLines
    .map((line) => ({
      line: line.line,
      text: line.text.trim().replace(/\s+/g, ' '),
    }))
    .filter((line) => declarationPattern.test(line.text))

  return declarations.slice(0, 12).map((line) => [
    line.line,
    oracleDeclarationSummary(line.text),
  ])
}

export function objectUnit(kind: string, payload: JsonRecord, rowCount: number) {
  if (payload.objectName) {
    return stringValue(payload.objectName)
  }

  if (rowCount > 0) {
    return `${rowCount} row(s)`
  }

  return kind
}

export function objectViewWarnings(tab: QueryTabState, payload: JsonRecord) {
  const payloadWarnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter((item): item is string => typeof item === 'string')
    : []

  return [
    ...(tab.objectViewState?.warnings ?? []),
    ...(tab.error?.message ? [tab.error.message] : []),
    ...(typeof payload.warning === 'string' ? [payload.warning] : []),
    ...payloadWarnings,
  ].filter(Boolean)
}

export function cardRowsFromPayload(payload: JsonRecord, keys: string[]) {
  return keys
    .map((key) => [humanize(key), stringValue(payload[key])])
    .filter(([, value]) => value)
}

export function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function stringValue(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

export function bytesText(value: unknown) {
  if (typeof value !== 'number') {
    return stringValue(value)
  }

  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function normalizeOracleObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

function sqlTextSummary(value: unknown) {
  const text = stringValue(value).replace(/\s+/g, ' ').trim()
  if (!text) {
    return ''
  }

  const keyword = text.match(/\b(select|insert|update|delete|merge|create|alter|drop|exec|execute|with)\b/i)?.[1]
  const label = keyword ? `${keyword.toUpperCase()} statement` : 'SQL text'
  return text.length > 80 ? `${label} (${text.length.toLocaleString()} chars)` : `${label}: ${text}`
}

function oracleDeclarationSummary(text: string) {
  const normalized = text.replace(/^create\s+(or\s+replace\s+)?/i, '').trim()
  const match = /\b(package\s+body|package|procedure|function|type\s+body|type|trigger|cursor)\s+([A-Za-z0-9_$#"]+)/i.exec(normalized)
  if (!match) {
    return 'PL/SQL declaration'
  }

  const declarationKind = match[1]
  const declarationName = match[2]
  if (!declarationKind || !declarationName) {
    return 'PL/SQL declaration'
  }

  const kind = humanize(declarationKind.toLowerCase())
  const name = declarationName.replace(/"/g, '')
  return `${kind}: ${name}`
}

function humanize(value: string) {
  return value
    .replace(/[_.$-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
