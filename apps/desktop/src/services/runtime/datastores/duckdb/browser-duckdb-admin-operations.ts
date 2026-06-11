import {
  duckDbExtensionName,
  duckDbImportFileRequest,
} from '../common/sql/browser-sql-operation-format'

export function duckDbOperationRequest(
  operationId: string,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  if (operationId.endsWith('table.analyze')) {
    return duckDbAdminOperationRequest(
      'duckdb.table.analyze-preview',
      'analyze-table',
      'table',
      objectName,
      `analyze ${objectName};`,
      false,
      true,
    )
  }

  if (operationId.endsWith('database.analyze')) {
    return duckDbAdminOperationRequest(
      'duckdb.database.analyze-preview',
      'analyze-database',
      'database',
      'database',
      'analyze;',
      false,
      true,
    )
  }

  if (operationId.endsWith('database.checkpoint')) {
    return duckDbAdminOperationRequest(
      'duckdb.database.checkpoint-preview',
      'checkpoint',
      'database',
      'database',
      'checkpoint;',
      false,
      true,
    )
  }

  if (operationId.endsWith('object.create')) {
    return duckDbAdminOperationRequest(
      'duckdb.object.create-preview',
      'create-object',
      'schema',
      objectName,
      `create table ${objectName} (\n  id text primary key,\n  created_at timestamp default current_timestamp\n);`,
      true,
      true,
    )
  }

  if (operationId.endsWith('object.drop')) {
    return duckDbAdminOperationRequest(
      'duckdb.object.drop-preview',
      'drop-object',
      'schema',
      objectName,
      `drop table ${objectName};`,
      true,
      true,
    )
  }

  if (operationId.endsWith('extension.install')) {
    return duckDbExtensionOperationRequest('install', parameters.extensionName ?? objectName)
  }

  if (operationId.endsWith('extension.load')) {
    return duckDbExtensionOperationRequest('load', parameters.extensionName ?? objectName)
  }

  if (operationId.endsWith('file.import')) {
    return duckDbImportFileRequest(String(parameters.tableName ?? objectName), parameters)
  }

  return undefined
}

function duckDbAdminOperationRequest(
  workflow: string,
  operation: string,
  targetKind: string,
  targetName: string,
  statement: string,
  dataOrCatalogMutation: boolean,
  requiresWriteAccess: boolean,
) {
  return JSON.stringify({
    workflow,
    operation,
    target: {
      kind: targetKind,
      name: targetName,
    },
    statement,
    adminScope: {
      executionPolicy: 'plan-only',
      dataOrCatalogMutation,
      requiresWriteAccess,
      rollbackRequiredBeforePromotion: dataOrCatalogMutation,
      scopedClaim: 'excluded-until-live-admin-guard',
    },
    adminExecutionBoundary: duckDbAdminExecutionBoundary(
      operation,
      targetKind,
      targetName,
      dataOrCatalogMutation,
      requiresWriteAccess,
    ),
    executionGate: {
      owner: 'duckdb-adapter',
      defaultSupport: 'plan-only',
      requiresConfirmation: true,
      guards: [
        'database file write/open preflight',
        'cross-process lock probe',
        'object identity and diff preview',
        'rollback or backup boundary review',
        'read-only connection blocked for executable promotion',
        'confirmation required before live admin promotion',
      ],
      residualRisk: 'DuckDB admin and DDL execution can mutate local analytics files; execution remains scoped out until lock, rollback, and identity boundaries are live',
    },
  }, null, 2)
}

function duckDbExtensionOperationRequest(operation: 'install' | 'load', rawExtensionName: unknown) {
  const extensionName = duckDbExtensionName(rawExtensionName)

  return JSON.stringify({
    workflow: `duckdb.extension.${operation}-preview`,
    operation,
    extensionName,
    statement: `${operation} ${extensionName};`,
    extensionPreflight: {
      extensionName,
      catalogProbe: 'duckdb_extensions()',
      installedState: 'desktop-preflight-required',
      loadedState: 'desktop-preflight-required',
      extensionDirectory: 'controlled by connection tempDirectory or database parent',
      networkAccess: operation === 'install' ? 'blocked-by-default' : 'not-required-when-already-installed',
      nativeCodeExecution: 'blocked-until-explicit-live-gate',
    },
    extensionExecutionBoundary: duckDbExtensionExecutionBoundary(operation, extensionName),
    executionGate: {
      owner: 'duckdb-adapter',
      defaultSupport: 'plan-only',
      requiresConfirmation: true,
      guards: [
        'sanitized extension name',
        'duckdb_extensions catalog probe',
        'controlled extension_directory',
        'no network auto-install in default workflows',
        'installed-before-load check',
        'native extension code execution review',
        'read-only connection blocked for executable promotion',
      ],
      residualRisk: 'DuckDB extensions can download or execute native code; install/load execution remains scoped out until offline source and native-code trust gates are live',
    },
  }, null, 2)
}

function duckDbAdminExecutionBoundary(
  operation: string,
  targetKind: string,
  targetName: string,
  dataOrCatalogMutation: boolean,
  requiresWriteAccess: boolean,
) {
  return {
    executionPolicy: 'scoped-out',
    nativeClaim: 'admin-preview-only',
    operation,
    target: {
      kind: targetKind,
      name: targetName,
    },
    dataOrCatalogMutation,
    requiresWriteAccess,
    localDatabaseMayChange: requiresWriteAccess,
    manualExecutionOutsideScopedClaim: true,
    excludedFromLiveFixtureClaim: true,
    previewValidated: 'contract-only',
    promotionRequires: [
      'exclusive DuckDB writer lock evidence',
      'target snapshot or rollback artifact before data/catalog mutation',
      'object identity and before/after diff preview',
      'post-operation catalog or statistics validation',
      'explicit admin confirmation',
      'read-only connection promotion block',
    ],
    blockedReasons: [
      'duckdb-admin-execution-scoped-out',
      ...(dataOrCatalogMutation ? ['data-or-catalog-mutation-scoped-out'] : []),
      ...(requiresWriteAccess ? ['requires-write-access'] : []),
    ],
  }
}

function duckDbExtensionExecutionBoundary(operation: 'install' | 'load', extensionName: string) {
  return {
    executionPolicy: 'scoped-out',
    nativeClaim: 'extension-preflight-only',
    operation,
    extensionName,
    nativeCodeExecution: true,
    networkAccess: operation === 'install' ? 'blocked-by-default' : 'not-required-when-already-installed',
    manualExecutionOutsideScopedClaim: true,
    excludedFromLiveFixtureClaim: true,
    previewValidated: 'contract-only',
    promotionRequires: [
      'offline extension source provenance',
      'controlled extension_directory evidence',
      'installed-state evidence before load',
      'native-code trust review',
      'explicit extension execution confirmation',
      'read-only connection promotion block',
    ],
    blockedReasons: [
      'duckdb-extension-execution-scoped-out',
      'native-code-trust-gate-missing',
      operation === 'install' ? 'network-install-scoped-out' : 'installed-state-live-check-required',
    ],
  }
}
