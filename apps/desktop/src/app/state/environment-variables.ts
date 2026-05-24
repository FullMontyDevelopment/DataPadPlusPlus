import type {
  EnvironmentProfile,
  EnvironmentVariableDefinition,
  SecretRef,
} from '@datapadplusplus/shared-types'

export const VARIABLE_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/
export const MASKED_SECRET_VALUE = '********'

export function isValidVariableName(value: string) {
  return VARIABLE_NAME_PATTERN.test(value.trim())
}

export function normalizeVariableName(value: string) {
  return value.trim().toUpperCase()
}

export function legacyToBraceVariables(value: string) {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, '{{$1}}')
}

export function secretRefForEnvironmentVariable(
  environmentId: string,
  key: string,
): SecretRef {
  const normalizedKey = normalizeVariableName(key)

  return {
    id: `secret-env-${environmentId}-${normalizedKey}`,
    provider: 'os-keyring',
    service: 'DataPad++',
    account: `environment:${environmentId}:${normalizedKey}`,
    label: `Environment ${environmentId} variable ${normalizedKey}`,
  }
}

export function variableDefinitionsForEnvironment(
  environment: EnvironmentProfile,
): EnvironmentVariableDefinition[] {
  const definitions = new Map<string, EnvironmentVariableDefinition>()

  for (const definition of environment.variableDefinitions ?? []) {
    const key = normalizeVariableName(definition.key)

    if (!isValidVariableName(key)) {
      continue
    }

    definitions.set(key, {
      ...definition,
      key,
      kind: definition.kind === 'secret' ? 'secret' : 'text',
      value:
        definition.kind === 'secret'
          ? undefined
          : legacyToBraceVariables(definition.value ?? ''),
      secretRef:
        definition.kind === 'secret'
          ? definition.secretRef ?? secretRefForEnvironmentVariable(environment.id, key)
          : undefined,
    })
  }

  for (const [rawKey, rawValue] of Object.entries(environment.variables ?? {})) {
    const key = normalizeVariableName(rawKey)

    if (!isValidVariableName(key) || definitions.has(key)) {
      continue
    }

    const secret = environment.sensitiveKeys.some((item) => item.toUpperCase() === key)
    definitions.set(key, {
      key,
      kind: secret ? 'secret' : 'text',
      value: secret ? undefined : legacyToBraceVariables(rawValue),
      secretRef: secret ? secretRefForEnvironmentVariable(environment.id, key) : undefined,
      updatedAt: environment.updatedAt,
    })
  }

  return [...definitions.values()].sort((left, right) => left.key.localeCompare(right.key))
}

export function sanitizeEnvironmentProfile(
  environment: EnvironmentProfile,
): EnvironmentProfile {
  const definitions = variableDefinitionsForEnvironment(environment)
  const variables: Record<string, string> = {}
  const sensitiveKeys: string[] = []

  for (const definition of definitions) {
    if (definition.kind === 'secret') {
      sensitiveKeys.push(definition.key)
      continue
    }

    variables[definition.key] = definition.value ?? ''
  }

  return {
    ...environment,
    variables,
    sensitiveKeys,
    variableDefinitions: definitions.map((definition) =>
      definition.kind === 'secret'
        ? {
            ...definition,
            value: undefined,
            secretRef:
              definition.secretRef ??
              secretRefForEnvironmentVariable(environment.id, definition.key),
          }
        : definition,
    ),
  }
}

export function resolveEnvironmentVariablesForPreview(
  chain: EnvironmentProfile[],
) {
  const variables: Record<string, string> = {}
  const sensitiveKeys = new Set<string>()
  const definitions = new Map<string, EnvironmentVariableDefinition>()

  for (const environment of chain) {
    for (const definition of variableDefinitionsForEnvironment(environment)) {
      definitions.set(definition.key, definition)

      if (definition.kind === 'secret') {
        sensitiveKeys.add(definition.key)
        variables[definition.key] = definition.secretRef
          ? MASKED_SECRET_VALUE
          : ''
        continue
      }

      variables[definition.key] = interpolateEnvironmentVariables(
        definition.value ?? '',
        variables,
      )
    }
  }

  const unresolvedKeys = Object.entries(variables)
    .filter(([, value]) => hasUnresolvedEnvironmentVariables(value))
    .map(([key]) => key)

  for (const [key, definition] of definitions) {
    if (definition.kind === 'secret' && !definition.secretRef) {
      unresolvedKeys.push(key)
    }
  }

  return {
    variables,
    sensitiveKeys: [...sensitiveKeys],
    variableDefinitions: [...definitions.values()],
    unresolvedKeys: [...new Set(unresolvedKeys)],
  }
}

export function interpolateEnvironmentVariables(
  value: string,
  variables: Record<string, string>,
) {
  const migrated = legacyToBraceVariables(value)

  return Object.entries(variables).reduce(
    (current, [key, resolved]) => current.replaceAll(`{{${key}}}`, resolved),
    migrated,
  )
}

export function hasUnresolvedEnvironmentVariables(value: string) {
  return /\{\{[^}]*$|\{\{[^}]+\}\}|\$\{/.test(value)
}
