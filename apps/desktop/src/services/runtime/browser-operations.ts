import type { ConnectionProfile, OperationExecutionRequest, OperationExecutionResponse, OperationPlanRequest, OperationPlanResponse, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { defaultQueryTextForConnection, languageForConnection, resolveEnvironment } from '../../app/state/helpers'
import { buildOperationManifestsForConnection } from './browser-operation-manifests'
import { collectDiagnosticsLocally, inspectPermissionsLocally } from './browser-operation-inspection'
import { findConnection } from './browser-store'

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
    request.operationId.includes('backup') ||
    request.operationId.includes('restore')
  const adminWrite =
    request.operationId.includes('.create') ||
    request.operationId.includes('.update') ||
    request.operationId.includes('.hide') ||
    request.operationId.includes('.unhide') ||
    request.operationId.includes('.user.') ||
    request.operationId.includes('.role.') ||
    request.operationId.includes('validation') ||
    request.operationId.includes('validator') ||
    request.operationId.includes('import-export') ||
    request.operationId.includes('backup') ||
    request.operationId.includes('restore')
  const costly =
    destructive ||
    adminWrite ||
    request.operationId.includes('.profile') ||
    request.operationId.includes('metrics')

  const plan: OperationPlanResponse['plan'] = {
    operationId: request.operationId,
    engine: connection.engine,
    summary: `Preview operation plan prepared for ${connection.name}.`,
    generatedRequest: browserOperationRequest(connection, request),
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
  applyEnvironmentGuardsToPlan(snapshot, request.environmentId, plan, Boolean(
    operation &&
      (['write', 'destructive', 'costly'].includes(operation.risk) ||
        operation.requiresConfirmation),
  ) || destructive || costly || adminWrite)

  return {
    connectionId: request.connectionId,
    environmentId: request.environmentId,
    plan,
  }
}

function browserOperationRequest(
  connection: ConnectionProfile,
  request: OperationPlanRequest,
) {
  if (connection.engine === 'mongodb') {
    return mongoOperationRequest(request)
  }

  if (request.objectName && connection.family === 'sql') {
    return `select * from ${request.objectName} limit 100;`
  }

  return defaultQueryTextForConnection(connection)
}

function mongoOperationRequest(request: OperationPlanRequest) {
  const parameters = request.parameters ?? {}
  const collection = String(parameters.collection ?? request.objectName ?? '<collection>')
  const indexName = String(parameters.indexName ?? '<index>')
  const database = String(parameters.database ?? '<database>')
  const name = String(parameters.name ?? request.objectName ?? '<name>')

  if (request.operationId.endsWith('index.create')) {
    return JSON.stringify({
      database,
      createIndexes: collection,
      indexes: [{
        key: parameters.key ?? { field: 1 },
        name: indexName,
        ...(asRecord(parameters.options)),
      }],
    }, null, 2)
  }

  if (request.operationId.endsWith('index.drop')) {
    return JSON.stringify({
      database,
      dropIndexes: collection,
      index: indexName,
    }, null, 2)
  }

  if (request.operationId.endsWith('validation.update')) {
    return JSON.stringify({
      database,
      collMod: collection,
      validator: parameters.validator ?? {},
    }, null, 2)
  }

  if (request.operationId.endsWith('user.create')) {
    return JSON.stringify({
      database,
      createUser: name,
      pwd: '<secret>',
      roles: parameters.roles ?? [],
    }, null, 2)
  }

  if (request.operationId.endsWith('user.drop')) {
    return JSON.stringify({
      database,
      dropUser: name,
    }, null, 2)
  }

  if (request.operationId.endsWith('role.create')) {
    return JSON.stringify({
      database,
      createRole: name,
      privileges: parameters.privileges ?? [],
      roles: parameters.roles ?? [],
    }, null, 2)
  }

  if (request.operationId.endsWith('role.drop')) {
    return JSON.stringify({
      database,
      dropRole: name,
    }, null, 2)
  }

  return JSON.stringify({
    operation: request.operationId,
    database,
    parameters,
  }, null, 2)
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
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
    warnings.push(`Type \`${confirmationText}\` before executing this operation.`)
  }

  if (environmentHasUnresolvedVariables(snapshot, request.environmentId)) {
    warnings.push('Unresolved environment variables must be fixed before this operation can run.')
  }

  if (executionSupport !== 'live' || warnings.length > planResponse.plan.warnings.length) {
    return {
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      operationId: request.operationId,
      executionSupport,
      executed: false,
      plan: planResponse.plan,
      messages,
      warnings,
    }
  }

  if (request.operationId.endsWith('security.inspect')) {
    const permissionInspection = inspectPermissionsLocally(snapshot, request).inspection
    return {
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      operationId: request.operationId,
      executionSupport,
      executed: true,
      plan: planResponse.plan,
      permissionInspection,
      messages: ['Permission inspection completed.'],
      warnings,
    }
  }

  if (request.operationId.endsWith('diagnostics.metrics')) {
    const diagnostics = collectDiagnosticsLocally(snapshot, request).diagnostics
    return {
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      operationId: request.operationId,
      executionSupport,
      executed: true,
      plan: planResponse.plan,
      diagnostics,
      messages: ['Adapter diagnostics collected.'],
      warnings,
    }
  }

  return {
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
  }
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

function pushWarning(warnings: string[], warning: string) {
  if (!warnings.includes(warning)) {
    warnings.push(warning)
  }
}
