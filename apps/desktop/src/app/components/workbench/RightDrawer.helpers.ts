import type { CSSProperties } from 'react'
import type { ConnectionProfile, EnvironmentProfile } from '@datapadplusplus/shared-types'
import {
  DATASTORE_FAMILIES,
  DATASTORE_FEATURE_BACKLOG,
} from '@datapadplusplus/shared-types'

export const ENGINE_OPTIONS = DATASTORE_FEATURE_BACKLOG.map((entry) => ({
  value: entry.engine,
  label: entry.displayName,
  family: entry.family,
  maturity: entry.maturity,
  defaultPort: entry.defaultPort,
  connectionMode: entry.connectionModes[0],
  connectionModes: entry.connectionModes,
  primaryConnectionMechanisms: entry.primaryConnectionMechanisms,
  localDatabase: entry.localDatabase,
}))

const ENGINE_FAMILY_LABELS: Record<ConnectionProfile['family'], string> = {
  sql: 'SQL',
  document: 'Document',
  keyvalue: 'Key-Value',
  graph: 'Graph',
  timeseries: 'Time-Series',
  widecolumn: 'Wide-Column',
  search: 'Search',
  warehouse: 'Warehouse',
  'embedded-olap': 'Embedded OLAP',
}

export const ENGINE_GROUPS = DATASTORE_FAMILIES.map((family) => ({
  label: ENGINE_FAMILY_LABELS[family],
  options: ENGINE_OPTIONS.filter((option) => option.family === family),
})).filter((group) => group.options.length > 0)

export const SHORTCUTS = [
  ['Save query', 'Ctrl S'],
  ['Run query', 'Ctrl Enter'],
  ['Explain query', 'Ctrl Shift E'],
  ['Refresh active view', 'F5'],
  ['Toggle panel', 'Ctrl J'],
  ['Toggle sidebar', 'Ctrl B'],
  ['New query tab', 'Ctrl N'],
  ['Close tab', 'Ctrl W'],
  ['Reopen closed tab', 'Ctrl Shift T'],
] as const

export function engineFamily(engine: ConnectionProfile['engine']): ConnectionProfile['family'] {
  return engineOption(engine)?.family ?? 'sql'
}

export function engineLabel(engine: ConnectionProfile['engine']) {
  return engineOption(engine)?.label ?? engine
}

export function engineOption(engine: ConnectionProfile['engine']) {
  return ENGINE_OPTIONS.find((option) => option.value === engine)
}

export function isCustomConnectionName(profile: ConnectionProfile) {
  const name = profile.name.trim()

  if (!name) {
    return false
  }

  return ![
    `New ${engineLabel(profile.engine)} connection`,
    `${engineLabel(profile.engine)} connection`,
    inferConnectionName(profile),
  ].includes(name)
}

export function inferConnectionName(profile: ConnectionProfile) {
  const database = profile.database?.trim() ?? ''
  const host = profile.host.trim()

  if (profile.engine === 'sqlite') {
    const path = database || host
    return path.includes('${') ? 'SQLite connection' : fileStem(path) || 'SQLite connection'
  }

  if (database && !database.includes('${')) {
    return database
  }

  if (host && host !== 'localhost' && !host.includes('${')) {
    return `${engineLabel(profile.engine)} ${host}`
  }

  return `${engineLabel(profile.engine)} connection`
}

export function environmentAccentVariables(
  environment?: EnvironmentProfile,
): CSSProperties | undefined {
  const color = normalizeHexColor(environment?.color)

  if (!color) {
    return undefined
  }

  return {
    '--connection-env-color': color,
    '--connection-env-tint': hexToRgba(color, 0.1),
    '--connection-env-border': hexToRgba(color, 0.45),
  } as CSSProperties
}

export function defaultPortForEngine(engine: ConnectionProfile['engine']) {
  return engineOption(engine)?.defaultPort
}

export function redactEnvironmentSecrets(
  value: string,
  environmentId: string,
  environments: EnvironmentProfile[],
) {
  if (!environmentId) {
    return value
  }

  const environmentMap = new Map(
    environments.map((environment) => [environment.id, environment]),
  )
  const variables: Record<string, string> = {}
  const sensitiveKeys = new Set<string>()
  const resolvedChain: EnvironmentProfile[] = []
  const visited = new Set<string>()
  let current = environmentMap.get(environmentId)

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    resolvedChain.unshift(current)
    current = current.inheritsFrom ? environmentMap.get(current.inheritsFrom) : undefined
  }

  for (const environment of resolvedChain) {
    Object.assign(variables, environment.variables)

    for (const key of environment.sensitiveKeys) {
      sensitiveKeys.add(key)
    }
  }

  return [...sensitiveKeys].reduce((redacted, key) => {
    const secretValue = variables[key]

    if (!secretValue) {
      return redacted
    }

    return redacted.split(secretValue).join('********')
  }, value)
}

function fileStem(path: string) {
  const fileName = path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  return fileName.replace(/\.[^.]+$/, '')
}

function normalizeHexColor(color?: string) {
  if (!color) {
    return undefined
  }

  const trimmed = color.trim()

  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed
  }

  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, red, green, blue] = trimmed
    return `#${red}${red}${green}${green}${blue}${blue}`
  }

  return undefined
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
