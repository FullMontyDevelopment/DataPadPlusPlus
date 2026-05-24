import type { EnvironmentProfile } from '@datapadplusplus/shared-types'
import {
  resolveEnvironmentVariablesForPreview,
  sanitizeEnvironmentProfile,
} from '../../state/environment-variables'

export function resolveEnvironmentPreview(
  environments: EnvironmentProfile[],
  draft: EnvironmentProfile,
) {
  const environmentMap = new Map(
    environments.map((environment) => [environment.id, environment]),
  )
  environmentMap.set(draft.id, draft)

  const resolvedChain: EnvironmentProfile[] = []
  const visited = new Set<string>()
  let current: EnvironmentProfile | undefined = draft

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    resolvedChain.unshift(current)
    current = current.inheritsFrom
      ? environmentMap.get(current.inheritsFrom)
      : undefined
  }

  const inheritedChain: string[] = []

  for (const environment of resolvedChain) {
    inheritedChain.push(environment.label)
  }
  const resolved = resolveEnvironmentVariablesForPreview(resolvedChain)

  return {
    ...resolved,
    inheritedChain,
  }
}

export function normalizeColor(value: string | undefined) {
  return /^#[0-9a-f]{6}$/i.test(value ?? '') ? value! : '#2dbf9b'
}

export function comparableEnvironment(environment: EnvironmentProfile | undefined) {
  if (!environment) {
    return ''
  }

  return JSON.stringify({
    color: environment.color,
    exportable: environment.exportable,
    inheritsFrom: environment.inheritsFrom ?? '',
    label: environment.label,
    requiresConfirmation: environment.requiresConfirmation,
    risk: environment.risk,
    safeMode: environment.safeMode,
    ...comparableVariables(environment),
  })
}

function comparableVariables(environment: EnvironmentProfile) {
  const sanitized = sanitizeEnvironmentProfile(environment)

  return {
    sensitiveKeys: [...sanitized.sensitiveKeys].sort(),
    variables: Object.fromEntries(
      Object.entries(sanitized.variables).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    variableDefinitions: [...(sanitized.variableDefinitions ?? [])]
      .map((definition) => ({
        key: definition.key,
        kind: definition.kind,
        value: definition.kind === 'secret' ? undefined : definition.value ?? '',
        secretRef: definition.secretRef?.id ?? '',
      }))
      .sort((left, right) => left.key.localeCompare(right.key)),
  }
}
