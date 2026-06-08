import type { ConnectionProfile, OperationExecutionRequest, OperationExecutionResponse, OperationPlanRequest, OperationPlanResponse, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { referencedSensitiveEnvironmentVariableKeys } from '../../app/state/environment-variables'
import { defaultQueryTextForConnection, languageForConnection, resolveEnvironment } from '../../app/state/helpers'
import { redactSensitiveText } from '../../app/state/security-redaction'
import { buildOperationManifestsForConnection } from './browser-operation-manifests'
import { collectDiagnosticsLocally, inspectPermissionsLocally } from './browser-operation-inspection'
import { cosmosOperationRequest } from './browser-cosmos-operations'
import { mongoOperationRequest } from './browser-mongo-operations'
import { liteDbOperationRequest } from './browser-litedb-operations'
import { memcachedOperationRequest } from './browser-memcached-operations'
import { redisOperationRequest } from './browser-redis-operations'
import { redactOperationPlanForEnvironment, redactOperationResponseForEnvironment } from './browser-response-redaction'
import { searchOperationRequest } from './browser-search-operations'
import { sqlOperationRequest } from './browser-sql-operations'
import { findConnection } from './browser-store'
import { timeSeriesOperationRequest } from './browser-timeseries-operations'
import { wideColumnOperationRequest } from './browser-widecolumn-operations'
import { graphOperationRequest } from './browser-graph-operations'
import { warehouseOperationRequest } from './browser-warehouse-operations'

export { buildOperationManifestsForConnection } from './browser-operation-manifests'
export { collectDiagnosticsLocally, inspectPermissionsLocally } from './browser-operation-inspection'

export function planOperationLocally(
  snapshot: WorkspaceSnapshot,
  request: OperationPlanRequest,
): OperationPlanResponse {
  const connection = findConnection(snapshot, request.connectionId)

  if (!connection) {
    throw new Error('Connection was not found.')
  }

  const destructive =
    request.operationId.includes('.drop') ||
    request.operationId.includes('.session.terminate') ||
    request.operationId.includes('retention-policy') ||
    request.operationId.includes('backup') ||
    request.operationId.includes('restore') ||
    request.operationId.includes('.key.delete') ||
    request.operationId.includes('.repair') ||
    request.operationId.includes('.flush')
  const adminWrite =
    request.operationId.includes('.create') ||
    request.operationId.includes('.update') ||
    request.operationId.includes('.hide') ||
    request.operationId.includes('.unhide') ||
    request.operationId.includes('.put-mapping') ||
    request.operationId.includes('.force-merge') ||
    request.operationId.includes('.clear-cache') ||
    request.operationId.includes('.reindex') ||
    request.operationId.includes('.close') ||
    request.operationId.includes('.open') ||
    request.operationId.includes('.alias.') ||
    request.operationId.includes('.data-stream.rollover') ||
    request.operationId.includes('.lifecycle.put') ||
    request.operationId.includes('.task.cancel') ||
    request.operationId.includes('.pipeline.put') ||
    request.operationId.includes('.pipeline.simulate') ||
    request.operationId.includes('.user.') ||
    request.operationId.includes('.role.') ||
    request.operationId.includes('.routine.execute') ||
    request.operationId.includes('.session.cancel') ||
    request.operationId.includes('.key.set') ||
    request.operationId.includes('.key.touch') ||
    request.operationId.includes('.key.increment') ||
    request.operationId.includes('.key.decrement') ||
    request.operationId.includes('.extension.') ||
    request.operationId.includes('.file.import') ||
    request.operationId.includes('.collection.import') ||
    request.operationId.includes('.gridfs.upload') ||
    request.operationId.includes('.key.import') ||
    request.operationId.includes('.table.import') ||
    request.operationId.includes('.cockroach.import') ||
    request.operationId.includes('.zone-configs') ||
    request.operationId.includes('.event.') ||
    request.operationId.includes('validation') ||
    request.operationId.includes('validator') ||
    request.operationId.includes('import-export') ||
    request.operationId.includes('backup') ||
    request.operationId.includes('restore') ||
    request.operationId.includes('.checkpoint') ||
    request.operationId.includes('.vacuum') ||
    request.operationId.includes('.reindex') ||
    request.operationId.includes('.rebuild') ||
    request.operationId.includes('.reorganize') ||
    request.operationId.includes('.disable') ||
    request.operationId.includes('.enable') ||
    request.operationId.includes('.compact') ||
    request.operationId.includes('.reset') ||
    request.operationId.includes('.clone') ||
    request.operationId.includes('.copy') ||
    request.operationId.includes('.optimize') ||
    request.operationId.includes('.materialize') ||
    request.operationId.includes('.freeze') ||
    request.operationId.includes('.suspend') ||
    request.operationId.includes('.resume') ||
    request.operationId.includes('.job-control') ||
    request.operationId.includes('.repair') ||
    request.operationId.includes('.analyze') ||
    request.operationId.includes('compression-policy') ||
    request.operationId.includes('refresh-continuous-aggregate')
  const costly =
    destructive ||
    adminWrite ||
    request.operationId.includes('.collection.export') ||
    request.operationId.includes('.gridfs.export') ||
    request.operationId.includes('.gridfs.validate') ||
    request.operationId.includes('.key.export') ||
    request.operationId.includes('.table.export') ||
    request.operationId.includes('.cockroach.export') ||
    request.operationId.includes('.profile') ||
    request.operationId.includes('.cardinality.') ||
    request.operationId.includes('metrics')

  const plan: OperationPlanResponse['plan'] = {
    operationId: request.operationId,
    engine: connection.engine,
    summary: `Preview operation plan prepared for ${connection.name}.`,
    generatedRequest: redactSensitiveText(browserOperationRequest(connection, request)),
    requestLanguage: languageForConnection(connection),
    destructive,
    estimatedCost: costly
      ? 'Unknown until a live dry run/profile is available.'
      : 'No material cost expected in preview mode.',
    estimatedScanImpact: costly
      ? 'May scan data or execute workload depending on the engine.'
      : 'Metadata/read preview only.',
    requiredPermissions: destructive
      ? ['owner/admin role or equivalent destructive privilege']
      : adminWrite
        ? ['write/admin privilege for the target object']
      : ['read metadata/query privilege'],
    confirmationText: destructive || costly ? `CONFIRM ${connection.engine.toUpperCase()}` : undefined,
    warnings: [
      'Preview mode generates guarded operation plans without mutating the datastore.',
    ],
  }
  const operation = buildOperationManifestsForConnection(connection).find(
    (item) => item.id === request.operationId,
  )
  const resolvedEnvironment = resolveEnvironment(snapshot.environments, request.environmentId)
  const referencedSecrets = operationSecretReferences(request, resolvedEnvironment.sensitiveKeys)
  if (referencedSecrets.length > 0) {
    pushWarning(
      plan.warnings,
      `Secret variable ${referencedSecrets[0]} is resolved only by the desktop secret store.`,
    )
  }
  applyEnvironmentGuardsToPlan(snapshot, request.environmentId, plan, Boolean(
    operation &&
      (['write', 'destructive', 'costly'].includes(operation.risk) ||
        operation.requiresConfirmation),
  ) || destructive || costly || adminWrite)

  return redactOperationPlanForEnvironment({
    connectionId: request.connectionId,
    environmentId: request.environmentId,
    plan,
  }, resolvedEnvironment)
}

function browserOperationRequest(
  connection: ConnectionProfile,
  request: OperationPlanRequest,
) {
  if (connection.engine === 'mongodb') {
    return mongoOperationRequest(request)
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return redisOperationRequest(request)
  }

  if (connection.engine === 'cosmosdb') {
    return cosmosOperationRequest(request)
  }

  if (connection.engine === 'litedb') {
    return liteDbOperationRequest(request)
  }

  if (connection.engine === 'memcached') {
    return memcachedOperationRequest(request)
  }

  if (connection.family === 'graph') {
    return graphOperationRequest(connection, request)
  }

  if (connection.family === 'warehouse') {
    return warehouseOperationRequest(connection, request)
  }

  if (connection.family === 'sql' || connection.family === 'embedded-olap') {
    return sqlOperationRequest(connection, request)
  }

  if (connection.family === 'search') {
    return searchOperationRequest(connection, request)
  }

  if (connection.family === 'timeseries') {
    return timeSeriesOperationRequest(connection, request)
  }

  if (connection.family === 'widecolumn') {
    return wideColumnOperationRequest(connection, request)
  }

  return defaultQueryTextForConnection(connection)
}

export function executeOperationLocally(
  snapshot: WorkspaceSnapshot,
  request: OperationExecutionRequest,
): OperationExecutionResponse {
  const planResponse = planOperationLocally(snapshot, request)
  const connection = findConnection(snapshot, request.connectionId)
  const operation = connection
    ? buildOperationManifestsForConnection(connection).find(
        (item) => item.id === request.operationId,
      )
    : undefined
  const executionSupport = operation?.executionSupport ?? 'unsupported'
  const warnings = [...planResponse.plan.warnings]
  const messages: string[] = []

  if (!connection) {
    throw new Error('Connection was not found.')
  }

  if (
    connection.readOnly &&
    operation &&
    ['write', 'destructive'].includes(operation.risk)
  ) {
    warnings.push('Live execution was blocked because this connection is read-only.')
  }

  const confirmationText = planResponse.plan.confirmationText
  if (confirmationText && request.confirmationText !== confirmationText) {
    warnings.push('This operation needs confirmation before it can run.')
  }

  if (environmentHasUnresolvedVariables(snapshot, request.environmentId)) {
    warnings.push('Unresolved environment variables must be fixed before this operation can run.')
  }
  const secretReferences = operationSecretReferences(
    request,
    resolveEnvironment(snapshot.environments, request.environmentId).sensitiveKeys,
  )
  if (secretReferences.length > 0) {
    warnings.push(
      `Secret variable ${secretReferences[0]} cannot be resolved in browser preview.`,
    )
  }

  if (executionSupport !== 'live' || warnings.length > planResponse.plan.warnings.length) {
    return redactOperationResponseForEnvironment({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      operationId: request.operationId,
      executionSupport,
      executed: false,
      plan: planResponse.plan,
      messages,
      warnings,
    }, resolveEnvironment(snapshot.environments, request.environmentId))
  }

  if (request.operationId.endsWith('security.inspect')) {
    const permissionInspection = inspectPermissionsLocally(snapshot, request).inspection
    return redactOperationResponseForEnvironment({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      operationId: request.operationId,
      executionSupport,
      executed: true,
      plan: planResponse.plan,
      permissionInspection,
      messages: ['Permission inspection completed.'],
      warnings,
    }, resolveEnvironment(snapshot.environments, request.environmentId))
  }

  if (request.operationId.endsWith('diagnostics.metrics')) {
    const diagnostics = collectDiagnosticsLocally(snapshot, request).diagnostics
    return redactOperationResponseForEnvironment({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      operationId: request.operationId,
      executionSupport,
      executed: true,
      plan: planResponse.plan,
      diagnostics,
      messages: ['Adapter diagnostics collected.'],
      warnings,
    }, resolveEnvironment(snapshot.environments, request.environmentId))
  }

  return redactOperationResponseForEnvironment({
    connectionId: request.connectionId,
    environmentId: request.environmentId,
    operationId: request.operationId,
    executionSupport,
    executed: true,
    plan: planResponse.plan,
    metadata: {
      summary: `Preview operation ${request.operationId} executed in browser mode.`,
    },
    messages: ['Preview operation completed.'],
    warnings,
  }, resolveEnvironment(snapshot.environments, request.environmentId))
}

function applyEnvironmentGuardsToPlan(
  snapshot: WorkspaceSnapshot,
  environmentId: string,
  plan: OperationPlanResponse['plan'],
  risky: boolean,
) {
  const environment = snapshot.environments.find((item) => item.id === environmentId)

  if (!environment) {
    return
  }

  const resolved = resolveEnvironment(snapshot.environments, environmentId)
  if (resolved.unresolvedKeys.length > 0) {
    pushWarning(plan.warnings, 'Unresolved environment variables must be fixed before execution.')
    return
  }

  if (!risky) {
    return
  }

  const reasons = [
    snapshot.preferences.safeModeEnabled
      ? 'Global safe mode requires confirmation for risky work.'
      : '',
    environment.safeMode
      ? `${environment.label} safe mode requires confirmation for risky work.`
      : '',
    environment.requiresConfirmation
      ? `${environment.label} requires confirmation for risky work.`
      : '',
    environment.risk === 'high' || environment.risk === 'critical'
      ? `${environment.label} is a ${environment.risk} risk environment.`
      : '',
  ].filter(Boolean)

  for (const reason of reasons) {
    pushWarning(plan.warnings, reason)
  }

  if (reasons.length > 0 && !plan.confirmationText) {
    plan.confirmationText = `CONFIRM ${environment.label}`
  }
}

function environmentHasUnresolvedVariables(
  snapshot: WorkspaceSnapshot,
  environmentId: string,
) {
  return resolveEnvironment(snapshot.environments, environmentId).unresolvedKeys.length > 0
}

function operationSecretReferences(
  request: OperationPlanRequest,
  sensitiveKeys: string[],
) {
  return referencedSensitiveEnvironmentVariableKeys(
    JSON.stringify({
      objectName: request.objectName,
      parameters: request.parameters,
    }),
    sensitiveKeys,
  )
}

function pushWarning(warnings: string[], warning: string) {
  if (!warnings.includes(warning)) {
    warnings.push(warning)
  }
}
