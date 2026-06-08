import type {
  AppHealth,
  ConnectionProfile,
  DiagnosticsReport,
  EnvironmentProfile,
  GuardrailDecision,
  ResolvedEnvironment,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { resolveEnvironmentVariablesForPreview } from './environment-variables'

export function resolveEnvironment(
  environments: EnvironmentProfile[],
  environmentId: string,
): ResolvedEnvironment {
  if (!environmentId.trim()) {
    return {
      environmentId: '',
      label: 'No environment',
      risk: 'low',
      variables: {},
      unresolvedKeys: [],
      inheritedChain: [],
      sensitiveKeys: [],
      variableDefinitions: [],
    }
  }

  const fallback =
    environments[0] ??
    ({
      id: 'environment-missing',
      label: 'Missing environment',
      color: '#000000',
      risk: 'low',
      variables: {},
      sensitiveKeys: [],
      variableDefinitions: [],
      requiresConfirmation: false,
      safeMode: false,
      exportable: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies EnvironmentProfile)
  const environmentMap = new Map(
    environments.map((environment) => [environment.id, environment]),
  )
  const resolvedChain: EnvironmentProfile[] = []
  const visited = new Set<string>()
  let current = environmentMap.get(environmentId)

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    resolvedChain.unshift(current)
    current = current.inheritsFrom
      ? environmentMap.get(current.inheritsFrom)
      : undefined
  }

  const activeEnvironment = environmentMap.get(environmentId) ?? fallback
  const inheritedChain: string[] = []

  for (const environment of resolvedChain) {
    inheritedChain.push(environment.label)
  }
  const resolved = resolveEnvironmentVariablesForPreview(resolvedChain)

  return {
    environmentId: activeEnvironment.id,
    label: activeEnvironment.label,
    risk: activeEnvironment.risk,
    variables: resolved.variables,
    unresolvedKeys: resolved.unresolvedKeys,
    inheritedChain,
    sensitiveKeys: resolved.sensitiveKeys,
    variableDefinitions: resolved.variableDefinitions,
  }
}

export function evaluateGuardrails(
  connection: ConnectionProfile,
  environment: EnvironmentProfile,
  resolvedEnvironment: ResolvedEnvironment,
  queryText: string,
  safeModeEnabled: boolean,
): GuardrailDecision {
  const reasons: string[] = []
  const normalized = queryText.toLowerCase()
  const looksWrite = /(insert|update|delete|drop|truncate|alter|create|flushdb|flushall|set )/.test(
    normalized,
  )
  const riskyQuery =
    looksWrite || environment.risk === 'high' || environment.risk === 'critical'

  if (resolvedEnvironment.unresolvedKeys.length > 0) {
    reasons.push('Unresolved environment variables must be fixed before execution.')
    return {
      status: 'block',
      reasons,
      safeModeApplied: safeModeEnabled || environment.safeMode,
    }
  }

  if (connection.readOnly && looksWrite) {
    reasons.push('This connection is marked read-only.')
    return {
      status: 'block',
      reasons,
      safeModeApplied: safeModeEnabled || environment.safeMode,
    }
  }

  if (riskyQuery) {
    if (safeModeEnabled) {
      reasons.push('Global safe mode requires confirmation for risky work.')
    }

    if (environment.safeMode) {
      reasons.push(
        `${environment.label} safe mode requires confirmation for risky work.`,
      )
    }

    if (environment.requiresConfirmation) {
      reasons.push(`${environment.label} requires confirmation for risky work.`)
    }

    if (environment.risk === 'high' || environment.risk === 'critical') {
      reasons.push(`${environment.label} is a ${environment.risk} risk environment.`)
    }
  }

  if (reasons.length > 0) {
    return {
      status: 'confirm',
      reasons,
      safeModeApplied: safeModeEnabled || environment.safeMode,
      requiredConfirmationText: `CONFIRM ${environment.label}`,
    }
  }

  reasons.push('Guardrails cleared for the current query.')

  return {
    status: 'allow',
    reasons,
    safeModeApplied: safeModeEnabled || environment.safeMode,
  }
}

export function buildDiagnosticsReport(
  snapshot: WorkspaceSnapshot,
  health: AppHealth,
): DiagnosticsReport {
  const warnings: string[] = []

  if (snapshot.lockState.isLocked) {
    warnings.push('Application is currently locked.')
  }

  if (snapshot.preferences.telemetry === 'disabled') {
    warnings.push('Crash reporting is disabled.')
  }

  if (
    snapshot.environments.some((environment) => environment.risk === 'critical')
  ) {
    warnings.push('Critical environments are configured in this workspace.')
  }

  return {
    createdAt: new Date().toISOString(),
    runtime: health.runtime,
    platform: health.platform,
    appVersion: '0.1.0',
    logPath: undefined,
    counts: {
      connections: snapshot.connections.length,
      environments: snapshot.environments.length,
      tabs: snapshot.tabs.length,
      savedWork: snapshot.savedWork.length,
      library: snapshot.libraryNodes.length,
    },
    warnings,
  }
}
