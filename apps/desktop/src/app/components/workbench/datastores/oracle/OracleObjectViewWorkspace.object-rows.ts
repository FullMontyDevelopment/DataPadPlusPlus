export type JsonRecord = Record<string, unknown>

export type OracleTableRows = {
  columns: string[]
  rows: string[][]
}

export function oracleObjectRows(kind: string, payload: JsonRecord): OracleTableRows {
  switch (kind) {
    case 'tables':
      return oracleRows(payload.tables, ['Owner', 'Table', 'Status', 'Tablespace'], (row) => [
        row.owner ?? row.schema,
        row.name ?? row.tableName,
        row.status,
        row.tablespace ?? row.tablespaceName,
      ])
    case 'views':
      return oracleRows(payload.views, ['Owner', 'View', 'Text length', 'Status'], (row) => [
        row.owner ?? row.schema,
        row.name ?? row.viewName,
        row.textLength,
        row.status,
      ])
    case 'materialized-views':
      return oracleRows(payload.materializedViews, ['Owner', 'Name', 'Refresh mode', 'Status'], (row) => [
        row.owner ?? row.schema,
        row.name ?? row.mviewName,
        row.refreshMode,
        row.status ?? row.refreshMethod,
      ])
    case 'sequences':
      return oracleRows(payload.sequences, ['Owner', 'Sequence', 'Increment', 'Cache'], (row) => [
        row.owner ?? row.sequenceOwner,
        row.name ?? row.sequenceName,
        row.increment ?? row.incrementBy,
        row.cache ?? row.cacheSize,
      ])
    case 'synonyms':
      return oracleRows(payload.synonyms, ['Owner', 'Synonym', 'Target owner', 'Target object'], (row) => [
        row.owner,
        row.name ?? row.synonymName,
        row.targetOwner ?? row.tableOwner,
        row.targetObject ?? row.tableName,
      ])
    case 'indexes':
      return oracleRows(payload.indexes, ['Owner', 'Index', 'Table', 'Status'], (row) => [
        row.owner,
        row.name ?? row.indexName,
        row.table ?? row.tableName,
        row.status,
      ])
    case 'constraints':
      return oracleRows(payload.constraints, ['Owner', 'Constraint', 'Type', 'Status'], (row) => [
        row.owner,
        row.name ?? row.constraintName,
        row.type ?? row.constraintType,
        row.status,
      ])
    case 'triggers':
      return oracleRows(payload.triggers, ['Owner', 'Trigger', 'Event', 'Status'], (row) => [
        row.owner,
        row.name ?? row.triggerName,
        row.event ?? row.triggeringEvent,
        row.status,
      ])
    case 'packages':
      return oracleRows(payload.packages, ['Owner', 'Package', 'Type', 'Status'], (row) => [
        row.owner,
        row.name ?? row.objectName,
        row.type ?? row.objectType,
        row.status,
      ])
    case 'procedures':
    case 'functions':
      return oracleRows(
        kind === 'procedures' ? payload.procedures : payload.functions,
        ['Owner', kind === 'procedures' ? 'Procedure' : 'Function', 'Status', 'Last DDL'],
        (row) => [row.owner, row.name ?? row.objectName, row.status, row.lastDdlTime],
      )
    case 'types':
      return oracleRows(payload.types, ['Owner', 'Type', 'Kind', 'Status'], (row) => [
        row.owner,
        row.name ?? row.objectName,
        row.type ?? row.objectType,
        row.status,
      ])
    case 'json-collections':
      return oracleRows(payload.jsonCollections, ['Owner', 'Collection / table', 'JSON column', 'Status'], (row) => [
        row.owner,
        row.name ?? row.tableName,
        row.column ?? row.columnName,
        row.status,
      ])
    case 'external-tables':
      return oracleRows(payload.externalTables, ['Owner', 'Table', 'Access type', 'Status'], (row) => [
        row.owner,
        row.name ?? row.tableName,
        row.type ?? row.typeName,
        row.status,
      ])
    case 'database-links':
      return oracleRows(payload.databaseLinks, ['Owner', 'Database link', 'Username', 'Host'], (row) => [
        row.owner,
        row.name ?? row.dbLink,
        row.username,
        row.host,
      ])
    default:
      return oracleRows(payload.objects, ['Owner', 'Object', 'Type', 'Status'], (row) => [
        row.owner ?? row.schema,
        row.name ?? row.objectName,
        row.type ?? row.objectType,
        row.status,
      ])
  }
}

function oracleRows(
  source: unknown,
  columns: string[],
  values: (row: JsonRecord) => unknown[],
): OracleTableRows {
  return {
    columns,
    rows: arrayOfRecords(source).map((row) => values(row).map(stringValue)),
  }
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
