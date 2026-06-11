export function postgresImportExportRequest(
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const mode = String(parameters.mode ?? 'export').toLowerCase()
  const format = String(parameters.format ?? 'csv').toLowerCase()
  const { schema, table } = postgresObjectParts(objectName, parameters)
  const importing = ['import', 'append', 'insert', 'validate', 'validate-only'].includes(mode)

  return JSON.stringify({
    workflow: importing ? 'postgresql.table.import' : 'postgresql.table.export',
    mode,
    schema,
    table,
    format,
    [importing ? 'source' : 'target']: {
      path: `<selected-file>.${format}`,
      overwrite: false,
    },
    rowLimit: numericParameter(parameters, 'rowLimit') ?? 10_000,
    executionGate: {
      owner: 'postgresql-adapter',
      defaultSupport: 'live',
      requiresConfirmation: true,
      guards: [
        'concrete absolute file path',
        'read-only connection check for import',
        'row limit',
        'type-aware target column validation',
      ],
    },
  }, null, 2)
}

export function postgresBackupRestoreRequest(
  objectName: string,
  parameters: Record<string, unknown> = {},
) {
  const mode = String(parameters.mode ?? 'backup').toLowerCase()
  const format = String(parameters.format ?? 'json').toLowerCase()
  const { schema } = postgresObjectParts(objectName, parameters)

  return JSON.stringify({
    workflow: mode === 'restore' ? 'postgresql.database.restore-preview' : 'postgresql.database.backup',
    mode,
    format,
    schema,
    target: {
      path: `<selected-file>.${format}`,
      overwrite: false,
    },
    rowLimit: numericParameter(parameters, 'rowLimit') ?? 1_000,
    tableLimit: numericParameter(parameters, 'tableLimit') ?? 25,
    includeData: booleanParameter(parameters, 'includeData') ?? true,
    executionGate: {
      owner: 'postgresql-adapter',
      defaultSupport: mode === 'restore' ? 'plan-only' : 'live',
      requiresConfirmation: true,
      residualRisk:
        'bounded logical DataPad++ backup package; full pg_dump/pg_restore restore execution remains preview-first',
    },
  }, null, 2)
}

function postgresObjectParts(
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const objectParts = objectName
    .split('.')
    .map((part) => stripSqlIdentifierWrapper(part))
    .filter(Boolean)
  const table = stringParameter(parameters, 'table')
    ?? stringParameter(parameters, 'tableName')
    ?? objectParts[objectParts.length - 1]
    ?? '<table>'
  const schema = stringParameter(parameters, 'schema')
    ?? (objectParts.length > 1 ? objectParts[0] : undefined)
    ?? 'public'

  return { schema, table }
}

function stringParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function booleanParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'boolean' ? value : undefined
}

function numericParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function stripSqlIdentifierWrapper(value: string) {
  const trimmed = value.trim()
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if (
    (first === '[' && last === ']') ||
    (first === '"' && last === '"') ||
    (first === '`' && last === '`')
  ) {
    return trimmed.slice(1, -1).replace(/""/g, '"')
  }

  return trimmed
}
