import type {
  DataEditExecutionRequest,
  DataEditPlanRequest,
  AdapterDiagnosticsRequest,
  CreateObjectViewTabRequest,
  ExplorerInspectRequest,
  ExecutionRequest,
  ExplorerRequest,
  OperationExecutionRequest,
  OperationManifestRequest,
  OperationPlanRequest,
  PermissionInspectionRequest,
  RedisKeyInspectRequest,
  RedisKeyScanRequest,
  ResultPageRequest,
  SaveQueryTabToLocalFileRequest,
  StructureRequest,
} from '@datapadplusplus/shared-types'
import {
  assertJsonSize,
  clampOptionalInteger,
  DATA_EDIT_KINDS,
  isAbsolutePath,
  MAX_DATA_EDIT_CHANGES,
  MAX_EXPLORER_LIMIT,
  MAX_ID_LENGTH,
  MAX_LOCAL_SAVE_PATH_LENGTH,
  MAX_OBJECT_NAME_LENGTH,
  MAX_REDIS_COUNT,
  MAX_REDIS_DATABASE,
  MAX_REDIS_PAGE_SIZE,
  MAX_REDIS_SAMPLE_SIZE,
  MAX_RESULT_PAGE_INDEX,
  MAX_RESULT_PAGE_SIZE,
  MAX_ROW_LIMIT,
  MAX_SCOPE_LENGTH,
  MAX_STRUCTURE_LIMIT,
  RESULT_RENDERERS,
  stripWindowsDrivePrefix,
  validateOperationId,
  validateOptionalId,
  validateOptionalText,
  validatePath,
  validateQueryText,
  validateRequiredId,
  validateRequiredText,
} from './request-validation-core'
export * from './request-validation-library'
export * from './request-validation-workspace'

export function validateExplorerRequest(request: ExplorerRequest): ExplorerRequest {
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  return {
    ...request,
    scope: validateOptionalText(request.scope, 'Explorer scope', MAX_SCOPE_LENGTH),
    limit: clampOptionalInteger(request.limit, 'Explorer limit', 1, MAX_EXPLORER_LIMIT),
  }
}

export function validateStructureRequest(request: StructureRequest): StructureRequest {
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  return {
    ...request,
    scope: validateOptionalText(request.scope, 'Structure scope', MAX_SCOPE_LENGTH),
    limit: clampOptionalInteger(request.limit, 'Structure limit', 1, MAX_STRUCTURE_LIMIT),
  }
}

export function validateExplorerInspectRequest(
  request: ExplorerInspectRequest,
): ExplorerInspectRequest {
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  validateRequiredId(request.nodeId, 'Explorer node id')
  return request
}

export function validateCreateObjectViewTabRequest(
  request: CreateObjectViewTabRequest,
): CreateObjectViewTabRequest {
  validateRequiredId(request.connectionId, 'Connection id')
  validateOptionalId(request.environmentId, 'Environment id')
  validateRequiredId(request.nodeId, 'Object view node id')
  validateRequiredText(request.label, 'Object view label', MAX_OBJECT_NAME_LENGTH)
  validateRequiredText(request.kind, 'Object view kind', 80)
  validatePath(request.path ?? [], 'Object view path')
  return request
}

export function validateRedisKeyScanRequest(request: RedisKeyScanRequest): RedisKeyScanRequest {
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  return {
    ...request,
    tabId: validateOptionalText(request.tabId, 'Tab id', MAX_ID_LENGTH),
    databaseIndex: clampOptionalInteger(
      request.databaseIndex,
      'Redis database index',
      0,
      MAX_REDIS_DATABASE,
    ),
    delimiter: validateOptionalText(request.delimiter, 'Redis delimiter', 8),
    pattern: validateOptionalText(request.pattern, 'Redis key pattern', MAX_SCOPE_LENGTH),
    typeFilter: validateOptionalText(request.typeFilter, 'Redis type filter', 64),
    cursor: validateOptionalText(request.cursor, 'Redis cursor', 128),
    count: clampOptionalInteger(request.count, 'Redis scan count', 1, MAX_REDIS_COUNT),
    pageSize: clampOptionalInteger(request.pageSize, 'Redis page size', 1, MAX_REDIS_PAGE_SIZE),
  }
}

export function validateRedisKeyInspectRequest(
  request: RedisKeyInspectRequest,
): RedisKeyInspectRequest {
  validateRequiredId(request.tabId, 'Tab id')
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  validateRequiredText(request.key, 'Redis key', MAX_SCOPE_LENGTH)
  return {
    ...request,
    sampleSize: clampOptionalInteger(
      request.sampleSize,
      'Redis inspect sample size',
      1,
      MAX_REDIS_SAMPLE_SIZE,
    ),
  }
}

export function validateOperationManifestRequest(
  request: OperationManifestRequest,
): OperationManifestRequest {
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  return {
    ...request,
    scope: validateOptionalText(request.scope, 'Operation scope', MAX_SCOPE_LENGTH),
  }
}

export function validateOperationPlanRequest(request: OperationPlanRequest): OperationPlanRequest {
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  validateOperationId(request.operationId)
  assertJsonSize(request.parameters, 'Operation parameters')
  return {
    ...request,
    objectName: validateOptionalText(
      request.objectName,
      'Operation object name',
      MAX_OBJECT_NAME_LENGTH,
    ),
  }
}

export function validateOperationExecutionRequest(
  request: OperationExecutionRequest,
): OperationExecutionRequest {
  const normalizedPlan = validateOperationPlanRequest(request)
  return {
    ...request,
    ...normalizedPlan,
    confirmationText: validateOptionalText(
      request.confirmationText,
      'Confirmation text',
      MAX_OBJECT_NAME_LENGTH,
    ),
    rowLimit: clampOptionalInteger(request.rowLimit, 'Operation row limit', 1, MAX_ROW_LIMIT),
    tabId: validateOptionalText(request.tabId, 'Tab id', MAX_ID_LENGTH),
  }
}

export function validatePermissionInspectionRequest(
  request: PermissionInspectionRequest,
): PermissionInspectionRequest {
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  return request
}

export function validateAdapterDiagnosticsRequest(
  request: AdapterDiagnosticsRequest,
): AdapterDiagnosticsRequest {
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  return {
    ...request,
    scope: validateOptionalText(request.scope, 'Diagnostics scope', MAX_SCOPE_LENGTH),
  }
}

export function validateDataEditPlanRequest(request: DataEditPlanRequest): DataEditPlanRequest {
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  if (!DATA_EDIT_KINDS.has(request.editKind)) {
    throw new Error(`Unsupported data edit kind: ${request.editKind || '(empty)'}.`)
  }
  validateRequiredText(request.target?.objectKind, 'Data edit object kind', 80)
  validatePath(request.target?.path ?? [], 'Data edit target path')
  validateOptionalText(request.target?.database, 'Database name', MAX_OBJECT_NAME_LENGTH)
  validateOptionalText(request.target?.schema, 'Schema name', MAX_OBJECT_NAME_LENGTH)
  validateOptionalText(request.target?.table, 'Table name', MAX_OBJECT_NAME_LENGTH)
  validateOptionalText(request.target?.collection, 'Collection name', MAX_OBJECT_NAME_LENGTH)
  validateOptionalText(request.target?.key, 'Key name', MAX_OBJECT_NAME_LENGTH)
  assertJsonSize(request.target, 'Data edit target')
  if (request.changes.length > MAX_DATA_EDIT_CHANGES) {
    throw new Error(`Data edits may include at most ${MAX_DATA_EDIT_CHANGES} changes.`)
  }
  for (const change of request.changes) {
    validateOptionalText(change.field, 'Data edit field', MAX_OBJECT_NAME_LENGTH)
    validateOptionalText(change.newName, 'Data edit new field name', MAX_OBJECT_NAME_LENGTH)
    validateOptionalText(change.valueType, 'Data edit value type', 80)
    validatePath(change.path ?? [], 'Data edit change path')
    assertJsonSize(change, 'Data edit change')
  }
  return request
}

export function validateDataEditExecutionRequest(
  request: DataEditExecutionRequest,
): DataEditExecutionRequest {
  validateDataEditPlanRequest(request)
  return {
    ...request,
    confirmationText: validateOptionalText(
      request.confirmationText,
      'Confirmation text',
      MAX_OBJECT_NAME_LENGTH,
    ),
  }
}

export function validateExecutionRequest(request: ExecutionRequest): ExecutionRequest {
  validateOptionalText(request.executionId, 'Execution id', MAX_ID_LENGTH)
  validateRequiredId(request.tabId, 'Tab id')
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  validateRequiredText(request.language, 'Query language', 80)
  validateQueryText(request.queryText, 'Query text')
  validateOptionalText(request.executionInputMode, 'Execution input mode', 32)
  if (request.scriptText !== undefined) {
    validateQueryText(request.scriptText, 'Script text')
  }
  if (request.selectedText !== undefined) {
    validateQueryText(request.selectedText, 'Selected text')
  }
  validateOptionalText(request.mode, 'Execution mode', 32)
  validateOptionalText(request.confirmedGuardrailId, 'Guardrail confirmation id', MAX_ID_LENGTH)
  return {
    ...request,
    rowLimit: clampOptionalInteger(request.rowLimit, 'Execution row limit', 1, MAX_ROW_LIMIT),
  }
}

export function validateResultPageRequest(request: ResultPageRequest): ResultPageRequest {
  validateRequiredId(request.tabId, 'Tab id')
  validateRequiredId(request.connectionId, 'Connection id')
  validateRequiredId(request.environmentId, 'Environment id')
  validateRequiredText(request.language, 'Query language', 80)
  validateQueryText(request.queryText, 'Query text')
  if (request.selectedText !== undefined) {
    validateQueryText(request.selectedText, 'Selected text')
  }
  validateRequiredText(request.renderer, 'Result renderer', 80)
  if (!RESULT_RENDERERS.has(request.renderer)) {
    throw new Error(`Unsupported result renderer: ${request.renderer}.`)
  }
  validateOptionalText(request.cursor, 'Result cursor', MAX_SCOPE_LENGTH)
  return {
    ...request,
    pageSize: clampOptionalInteger(
      request.pageSize,
      'Result page size',
      1,
      MAX_RESULT_PAGE_SIZE,
    ),
    pageIndex: clampOptionalInteger(
      request.pageIndex,
      'Result page index',
      0,
      MAX_RESULT_PAGE_INDEX,
    ),
  }
}

export function validateCancelExecutionRequest(request: { executionId: string; tabId?: string }) {
  validateRequiredId(request.executionId, 'Execution id')
  validateOptionalText(request.tabId, 'Tab id', MAX_ID_LENGTH)
  return request
}

export function validateRequiredTabId(tabId: string) {
  validateRequiredId(tabId, 'Tab id')
}

export function validateSaveQueryTabToLocalFileRequest(
  request: SaveQueryTabToLocalFileRequest,
): SaveQueryTabToLocalFileRequest {
  validateRequiredId(request.tabId, 'Tab id')
  const path = request.path?.trim()
  validateRequiredText(path, 'Local file path', MAX_LOCAL_SAVE_PATH_LENGTH)
  if (!path || !isAbsolutePath(path)) {
    throw new Error('Local file saves require an absolute file path selected by the save dialog.')
  }
  if (/[<>:"|?*]/.test(stripWindowsDrivePrefix(path).split(/[\\/]/).pop() ?? '')) {
    throw new Error('Local file name contains unsupported characters.')
  }
  return {
    ...request,
    path,
  }
}
