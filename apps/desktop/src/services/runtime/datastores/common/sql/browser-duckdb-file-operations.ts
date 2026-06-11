export function duckDbImportExportRequest(objectName: string, parameters: Record<string, unknown>) {
  const mode = String(parameters.mode ?? 'export').toLowerCase()
  const importLike = ['import', 'append', 'insert', 'replace', 'create', 'validate', 'validate-only'].includes(mode)
  const format = String(importLike ? parameters.sourceFormat ?? parameters.format ?? 'csv' : parameters.format ?? 'csv').toLowerCase()
  const { schema, table } = duckDbObjectParts(objectName, parameters)
  const rowLimit = numericParameter(parameters, 'rowLimit') ?? numericParameter(parameters, 'limit') ?? 10000

  if (importLike) {
    return JSON.stringify({
      workflow: 'duckdb.table.import',
      mode,
      schema,
      table,
      format,
      source: {
        path: stringParameter(parameters, 'sourcePath') ?? stringParameter(parameters, 'inputPath') ?? `<selected-file>.${duckDbFileExtension(format)}`,
      },
      rowLimit,
      databaseLockBoundary: duckDbDatabaseLockBoundaryContract('duckdb.table.import', !['validate', 'validate-only'].includes(mode)),
      formatPreflight: duckDbFormatPreflightContract(format, 'import'),
      executionGate: {
        owner: 'duckdb-adapter',
        defaultSupport: 'live',
        requiresConfirmation: true,
        guards: [
          'desktop adapter execution only',
          'absolute source path',
          'CSV/JSON/Parquet format allowlist',
          'bounded row import',
          'read-only connection blocked',
          'database file access/read-only preflight',
          'format capability preflight',
          'JSON/Parquet extension catalog probe',
          'replace/append mode review',
        ],
        residualRisk: 'extension installation, arbitrary DDL, restore execution, and broader local OLAP mutations remain preview-first',
      },
    }, null, 2)
  }

  return JSON.stringify({
    workflow: 'duckdb.table.export',
    schema,
    table,
    format,
    target: {
      path: stringParameter(parameters, 'targetPath') ?? stringParameter(parameters, 'outputPath') ?? `<selected-file>.${duckDbFileExtension(format)}`,
      overwrite: booleanParameter(parameters, 'overwrite') ?? false,
    },
    rowLimit,
    statement: `copy (select * from ${duckDbQualifiedIdentifier(schema, table)} limit ${rowLimit}) to '<selected-file>.${duckDbFileExtension(format)}' (format ${duckDbFormatKeyword(format)});`,
    databaseLockBoundary: duckDbDatabaseLockBoundaryContract('duckdb.table.export', false),
    formatPreflight: duckDbFormatPreflightContract(format, 'export'),
    executionGate: {
      owner: 'duckdb-adapter',
      defaultSupport: 'live',
      requiresConfirmation: true,
      guards: [
        'desktop adapter execution only',
        'absolute target path',
        'parent folder exists',
        'overwrite opt-in',
        'bounded row export',
        'database file read/open preflight',
        'format capability preflight',
        'JSON/Parquet extension catalog probe',
      ],
      residualRisk: 'remote filesystem, encrypted files, restore execution, and arbitrary extension management remain optional validation paths',
    },
  }, null, 2)
}

export function duckDbBackupRestoreRequest(parameters: Record<string, unknown>) {
  const mode = String(parameters.mode ?? 'backup').toLowerCase()
  const format = String(parameters.format ?? 'csv').toLowerCase()

  if (['restore', 'recover', 'import'].includes(mode)) {
    return JSON.stringify({
      workflow: 'duckdb.database.restore-preview',
      mode,
      format,
      source: {
        path: stringParameter(parameters, 'sourcePath')
          ?? stringParameter(parameters, 'inputPath')
          ?? stringParameter(parameters, 'sourceFolder')
          ?? stringParameter(parameters, 'inputFolder')
          ?? '<selected-folder>',
      },
      restorePreflight: duckDbRestorePreflightContract(format),
      databaseLockBoundary: duckDbDatabaseLockBoundaryContract('duckdb.database.restore-preview', true),
      restoreExecutionBoundary: duckDbRestoreExecutionBoundaryContract(mode),
      executionGate: {
        owner: 'duckdb-adapter',
        defaultSupport: 'plan-only',
        requiresConfirmation: true,
        guards: [
          'absolute restore source folder',
          'source folder readability preflight',
          'schema.sql/load.sql package marker check',
          'target database write/open preflight',
          'target snapshot or rollback artifact required before live promotion',
          'exclusive DuckDB writer lock evidence required before live promotion',
          'restore execution explicitly scoped out of native claim',
          'manual IMPORT DATABASE run outside the scoped claim',
        ],
        residualRisk: 'IMPORT DATABASE can replace local schemas; execution is explicitly scoped out until rollback/snapshot, exclusive writer-lock, post-restore validation, and confirmation semantics are native',
      },
    }, null, 2)
  }

  return JSON.stringify({
    workflow: 'duckdb.database.backup',
    mode,
    format,
    target: {
      path: stringParameter(parameters, 'targetPath')
        ?? stringParameter(parameters, 'outputPath')
        ?? stringParameter(parameters, 'targetFolder')
        ?? stringParameter(parameters, 'outputFolder')
        ?? '<selected-folder>',
    },
    statement: `export database '<selected-folder>' (format ${duckDbFormatKeyword(format)});`,
    databaseLockBoundary: duckDbDatabaseLockBoundaryContract('duckdb.database.backup', false),
    formatPreflight: duckDbFormatPreflightContract(format, 'backup'),
    executionGate: {
      owner: 'duckdb-adapter',
      defaultSupport: 'live',
      requiresConfirmation: true,
      guards: [
        'desktop adapter execution only',
        'absolute backup folder',
        'empty target folder',
        'parquet/csv backup format allowlist',
        'database file read/open preflight',
        'format capability preflight',
      ],
      residualRisk: 'IMPORT DATABASE restore execution remains preview-first',
    },
  }, null, 2)
}

function duckDbObjectParts(objectName: string, parameters: Record<string, unknown>): { schema: string; table: string } {
  const explicitTable = stringParameter(parameters, 'targetTable')
    ?? stringParameter(parameters, 'tableName')
    ?? stringParameter(parameters, 'table')
  if (explicitTable) {
    const explicitSchema = stringParameter(parameters, 'schema')
    const parts = explicitTable
      .split('.')
      .map((part) => cleanDuckDbIdentifier(part))
      .filter(Boolean)
    if (parts.length >= 2) {
      return { schema: explicitSchema ?? parts[0] ?? 'main', table: parts[1] ?? '<table>' }
    }

    return { schema: explicitSchema ?? 'main', table: parts[0] ?? '<table>' }
  }

  const parts = objectName
    .split('.')
    .map((part) => cleanDuckDbIdentifier(part))
    .filter(Boolean)

  if (parts.length >= 2) {
    return { schema: parts[0] ?? 'main', table: parts[1] ?? '<table>' }
  }

  return { schema: 'main', table: parts[0] ?? '<table>' }
}

function cleanDuckDbIdentifier(value: string) {
  const trimmed = value.trim()
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if (
    (first === '"' && last === '"') ||
    (first === '`' && last === '`') ||
    (first === '[' && last === ']')
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function duckDbQualifiedIdentifier(schema: string, table: string) {
  return `"${cleanDuckDbIdentifier(schema).replace(/"/g, '""')}"."${cleanDuckDbIdentifier(table).replace(/"/g, '""')}"`
}

function duckDbFileExtension(format: string) {
  if (format === 'csv') return 'csv'
  if (format === 'json' || format === 'jsonl' || format === 'ndjson') return 'json'
  return 'parquet'
}

function duckDbFormatKeyword(format: string) {
  if (format === 'csv') return 'csv'
  if (format === 'json' || format === 'jsonl' || format === 'ndjson') return 'json'
  return 'parquet'
}

function duckDbFormatPreflightContract(format: string, workflow: string) {
  const requiredExtension = format === 'parquet'
    ? 'parquet'
    : (format === 'json' || format === 'jsonl' || format === 'ndjson') ? 'json' : null

  return {
    format,
    workflow,
    extensionBacked: requiredExtension !== null,
    requiredExtension,
    extensionExecutionBoundary: duckDbFormatExtensionExecutionBoundary(format, workflow, requiredExtension),
    checks: requiredExtension
      ? ['duckdb_extensions catalog probe', 'operation-level read/write validation']
      : ['bundled DuckDB CSV reader/writer'],
  }
}

function duckDbFormatExtensionExecutionBoundary(
  format: string,
  workflow: string,
  requiredExtension: string | null,
) {
  if (!requiredExtension) {
    return {
      executionPolicy: 'bundled-native',
      nativeClaim: 'bundled-csv-reader-writer',
      format,
      workflow,
      extensionBacked: false,
      operationValidated: 'desktop-runtime-required',
      networkAutoloadAllowed: false,
      extensionInstallExecutionIncluded: false,
      blockedReasons: [],
    }
  }

  return {
    executionPolicy: 'preloaded-extension-required',
    nativeClaim: 'preloaded-extension-only',
    format,
    workflow,
    extensionBacked: true,
    requiredExtension,
    installedValidated: 'desktop-runtime-required',
    loadedValidated: 'desktop-runtime-required',
    operationValidated: 'desktop-runtime-required',
    networkAutoloadAllowed: false,
    extensionInstallExecutionIncluded: false,
    manualInstallLoadOutsideScopedClaim: true,
    promotionRequires: [
      'preloaded DuckDB extension evidence',
      'offline extension source provenance',
      'controlled extension_directory evidence',
      'extension-backed operation fixture',
      'no network autoload or install during file workflow',
    ],
    blockedReasons: [
      'extension-backed-format-requires-runtime-preflight',
      'extension-install-load-scoped-out',
    ],
  }
}

function duckDbDatabaseLockBoundaryContract(workflow: string, requiresWriteAccess: boolean) {
  return {
    policy: 'desktop-preflight-required',
    workflow,
    scope: 'local-duckdb-file',
    requiresWriteAccess,
    checks: [
      'parent folder exists',
      'database file exists',
      'filesystem read-open probe',
      ...(requiresWriteAccess ? ['filesystem write-open probe'] : []),
      'DuckDB adapter open probe',
      'read-only disk guard',
    ],
    crossProcessContentionValidated: 'desktop-fixture-required',
    exclusiveWriterLockValidated: false,
    promotionRequires: [
      'external-process contention fixture',
      'exclusive DuckDB writer lock acquisition evidence',
      'operation-scoped transaction or rollback artifact',
      'post-operation catalog validation',
      'read-only connection promotion block',
    ],
    scopedResiduals: [
      'external process contention is not part of the default fixture claim',
      'exclusive writer-lock evidence is required before admin or restore execution promotion',
    ],
  }
}

function duckDbRestorePreflightContract(format: string) {
  return {
    format,
    sourcePackageValidated: 'desktop-preflight-required',
    operationValidated: false,
    checks: [
      'absolute source folder',
      'folder readable',
      'schema.sql marker',
      'load.sql marker',
      'backup file count and byte summary',
      'target database write/open preflight',
    ],
    expectedFormats: ['csv', 'parquet'],
  }
}

function duckDbRestoreExecutionBoundaryContract(mode: string) {
  return {
    executionPolicy: 'scoped-out',
    mode,
    nativeClaim: 'restore-preflight-only',
    destructive: true,
    targetMayReplaceCatalog: true,
    manualExecutionOutsideScopedClaim: true,
    excludedFromLiveFixtureClaim: true,
    sourcePackageValidated: 'desktop-preflight-required',
    targetWriteOpenValidated: 'desktop-preflight-required',
    previewValidated: 'desktop-preflight-required',
    promotionRequires: [
      'exclusive DuckDB writer lock evidence',
      'target snapshot or rollback artifact before IMPORT DATABASE',
      'post-restore catalog diff and validation',
      'explicit destructive restore confirmation',
      'read-only connection promotion block',
    ],
    blockedReasons: ['restore-execution-scoped-out'],
  }
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
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}
