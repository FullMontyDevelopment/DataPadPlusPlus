import type { EnvironmentProfile } from '@datapadplusplus/shared-types'

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

  const variables: Record<string, string> = {}
  const inheritedChain: string[] = []
  const sensitiveKeys = new Set<string>()

  for (const environment of resolvedChain) {
    inheritedChain.push(environment.label)
    Object.assign(variables, environment.variables)

    for (const key of environment.sensitiveKeys) {
      sensitiveKeys.add(key)
    }
  }

  const unresolvedKeys = Object.entries(variables)
    .filter(([, value]) => value.includes('${'))
    .map(([key]) => key)

  return {
    variables,
    sensitiveKeys: [...sensitiveKeys],
    unresolvedKeys,
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
    sensitiveKeys: [...environment.sensitiveKeys].sort(),
    variables: Object.fromEntries(
      Object.entries(environment.variables).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  })
}
