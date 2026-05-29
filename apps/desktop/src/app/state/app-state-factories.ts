import type {
  BootstrapPayload,
  ConnectionProfile,
  EnvironmentProfile,
  SecretRef,
} from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import { createId } from './helpers'

export function ensureWorkspaceUnlocked(payload: BootstrapPayload | undefined) {
  if (payload?.snapshot.lockState.isLocked) {
    throw new Error('Unlock the workspace before using privileged desktop commands.')
  }
}

export function secretRefForConnection(profile: ConnectionProfile): SecretRef {
  return {
    id: `secret-${profile.id}`,
    provider: 'os-keyring',
    service: 'DataPad++',
    account: profile.id,
    label: `${profile.name} password`,
  }
}

function iconForEngine(engine: ConnectionProfile['engine']) {
  return engine
    .split('')
    .filter((character) => /[a-z0-9]/i.test(character))
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function familyForEngine(engine: ConnectionProfile['engine']): ConnectionProfile['family'] {
  return datastoreBacklogByEngine(engine)?.family ?? 'sql'
}

function defaultPortForEngine(engine: ConnectionProfile['engine']) {
  return datastoreBacklogByEngine(engine)?.defaultPort
}

function defaultConnectionModeForEngine(engine: ConnectionProfile['engine']) {
  return datastoreBacklogByEngine(engine)?.connectionModes[0]
}

export function createConnectionProfile(
  environmentId: string,
  source?: ConnectionProfile,
): ConnectionProfile {
  const timestamp = new Date().toISOString()
  const id = createId('conn')
  const engine = source?.engine ?? 'postgresql'
  const family = source?.family ?? familyForEngine(engine)

  return {
    id,
    name: source ? `Copy of ${source.name}` : 'New PostgreSQL connection',
    engine,
    family,
    host: source?.host ?? 'localhost',
    port: source?.port ?? defaultPortForEngine(engine),
    database: source?.database ?? '',
    connectionString: source?.connectionString,
    connectionMode: source?.connectionMode ?? defaultConnectionModeForEngine(engine),
    environmentIds: source?.environmentIds?.length ? [...source.environmentIds] : [environmentId],
    tags: source ? [...source.tags] : [],
    favorite: false,
    readOnly: source?.readOnly ?? false,
    icon: source?.icon ?? iconForEngine(engine),
    color: source?.color,
    group: source?.group ?? 'Connections',
    notes: source?.notes,
    auth: {
      ...source?.auth,
      secretRef: source?.auth.secretRef,
    },
    redisOptions: source?.redisOptions ? { ...source.redisOptions } : undefined,
    sqliteOptions: source?.sqliteOptions ? { ...source.sqliteOptions } : undefined,
    sqlServerOptions: source?.sqlServerOptions ? { ...source.sqlServerOptions } : undefined,
    oracleOptions: source?.oracleOptions ? { ...source.oracleOptions } : undefined,
    dynamoDbOptions: source?.dynamoDbOptions ? { ...source.dynamoDbOptions } : undefined,
    cassandraOptions: source?.cassandraOptions ? { ...source.cassandraOptions } : undefined,
    cosmosDbOptions: source?.cosmosDbOptions ? { ...source.cosmosDbOptions } : undefined,
    searchOptions: source?.searchOptions ? { ...source.searchOptions } : undefined,
    timeSeriesOptions: source?.timeSeriesOptions ? { ...source.timeSeriesOptions } : undefined,
    graphOptions: source?.graphOptions ? { ...source.graphOptions } : undefined,
    warehouseOptions: source?.warehouseOptions ? { ...source.warehouseOptions } : undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createEnvironmentProfile(source?: Partial<EnvironmentProfile>): EnvironmentProfile {
  const timestamp = new Date().toISOString()

  return {
    id: createId('env'),
    label: source?.label ?? 'Local',
    color: source?.color ?? '#2dbf9b',
    risk: source?.risk ?? 'low',
    inheritsFrom: source?.inheritsFrom,
    variables: source?.variables ?? {},
    sensitiveKeys: source?.sensitiveKeys ?? [],
    variableDefinitions: source?.variableDefinitions ?? [],
    requiresConfirmation: source?.requiresConfirmation ?? false,
    safeMode: source?.safeMode ?? false,
    exportable: source?.exportable ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
