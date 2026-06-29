import type {
  DataEditPlanResponse,
  DataEditPlanRequest,
  ResolvedEnvironment,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { referencedSensitiveEnvironmentVariableKeys } from '../../app/state/environment-variables'
import { resolveEnvironment } from '../../app/state/helpers'

export function browserEnvironmentHasUnresolvedVariables(
  snapshot: WorkspaceSnapshot,
  environmentId: string,
) {
  return browserResolvedEnvironment(snapshot, environmentId).unresolvedKeys.length > 0
}

export function browserResolvedEnvironment(
  snapshot: WorkspaceSnapshot,
  environmentId: string,
): ResolvedEnvironment {
  return resolveEnvironment(snapshot.environments, environmentId)
}

export function dataEditSecretReferences(
  request: DataEditPlanRequest,
  sensitiveKeys: string[],
) {
  return referencedSensitiveEnvironmentVariableKeys(
    JSON.stringify({
      target: request.target,
      changes: request.changes,
    }),
    sensitiveKeys,
  )
}

export function pushUniqueWarning(warnings: string[], warning: string) {
  if (!warnings.includes(warning)) {
    warnings.push(warning)
  }
}

export function applyEnvironmentGuardsToDataEditPlan(
  snapshot: WorkspaceSnapshot,
  environmentId: string,
  plan: DataEditPlanResponse['plan'],
) {
  const environment = snapshot.environments.find((item) => item.id === environmentId)

  if (!environment) {
    return
  }

  const resolved = browserResolvedEnvironment(snapshot, environmentId)
  if (resolved.unresolvedKeys.length > 0) {
    pushUniqueWarning(plan.warnings, 'Unresolved environment variables must be fixed before execution.')
    return
  }

  for (const reason of dataEditSafeModeBlockReasons(snapshot, environmentId)) {
    pushUniqueWarning(plan.warnings, reason)
  }
  if (dataEditSafeModeBlocked(snapshot, environmentId)) {
    plan.confirmationText = undefined
    return
  }

  const reasons = [
    environment.requiresConfirmation
      ? `${environment.label} requires confirmation for risky work.`
      : '',
    environment.risk === 'high' || environment.risk === 'critical'
      ? `${environment.label} is a ${environment.risk} risk environment.`
      : '',
  ].filter(Boolean)

  for (const reason of reasons) {
    pushUniqueWarning(plan.warnings, reason)
  }

  if (reasons.length > 0 && !plan.confirmationText) {
    plan.confirmationText = `CONFIRM ${environment.label}`
  }
}

export function dataEditSafeModeBlocked(
  snapshot: WorkspaceSnapshot,
  environmentId: string,
) {
  const environment = snapshot.environments.find((item) => item.id === environmentId)
  return Boolean(snapshot.preferences.safeModeEnabled || environment?.safeMode)
}

export function dataEditSafeModeBlockReasons(
  snapshot: WorkspaceSnapshot,
  environmentId: string,
) {
  const environment = snapshot.environments.find((item) => item.id === environmentId)
  return [
    snapshot.preferences.safeModeEnabled
      ? 'Global safe mode blocks inline result edits.'
      : '',
    environment?.safeMode
      ? `${environment.label} safe mode blocks inline result edits.`
      : '',
  ].filter(Boolean)
}
