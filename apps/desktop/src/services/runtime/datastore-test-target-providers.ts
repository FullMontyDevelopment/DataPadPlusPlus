import type {
  ConnectionProfile,
  DatastoreEngine,
  QueryLanguage,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { languageForConnection } from '../../app/state/helpers'

export interface DatastoreTestTargetProvider {
  engine: DatastoreEngine
  selectableLevelIds: ReadonlySet<string>
  acceptedTargetKinds: ReadonlySet<string>
  connectionTarget?(connection: ConnectionProfile): ScopedQueryTarget
  starterQuery(
    connection: ConnectionProfile,
    target: ScopedQueryTarget,
  ): string
}

function provider(
  engine: DatastoreEngine,
  selectableLevelIds: string[],
  acceptedTargetKinds: string[],
  starterQuery: (
    connection: ConnectionProfile,
    target: ScopedQueryTarget,
  ) => string,
  connectionTarget?: (connection: ConnectionProfile) => ScopedQueryTarget,
): DatastoreTestTargetProvider {
  return {
    engine,
    selectableLevelIds: new Set(selectableLevelIds),
    acceptedTargetKinds: new Set(acceptedTargetKinds.map(normalizeTargetKind)),
    connectionTarget,
    starterQuery,
  }
}

function databaseTarget(connection: ConnectionProfile): ScopedQueryTarget {
  const label = connection.database?.trim() || connection.name
  return {
    kind: 'database',
    label,
    path: [label],
    scope: `database:${label}`,
  }
}

function redisDatabaseTarget(connection: ConnectionProfile): ScopedQueryTarget {
  const databaseIndex = connection.redisOptions?.databaseIndex ?? 0
  const label = `DB ${databaseIndex}`
  return {
    kind: 'database',
    label,
    path: [label],
    scope: `db:${databaseIndex}`,
    preferredBuilder: 'redis-key-browser',
  }
}

export const DATASTORE_TEST_TARGET_PROVIDERS: Partial<
  Record<DatastoreEngine, DatastoreTestTargetProvider>
> = {
  postgresql: provider(
    'postgresql',
    ['database', 'relation'],
    ['database', 'table', 'base-table', 'view', 'materialized-view'],
    sqlStarterQuery,
    databaseTarget,
  ),
  sqlite: provider(
    'sqlite',
    ['database', 'relation'],
    ['database', 'table', 'base-table', 'view'],
    sqlStarterQuery,
    databaseTarget,
  ),
  mongodb: provider(
    'mongodb',
    ['database', 'collection'],
    ['database', 'collection', 'gridfs-collection', 'view'],
    mongoStarterQuery,
    databaseTarget,
  ),
  redis: provider(
    'redis',
    ['database', 'pattern'],
    ['database', 'prefix'],
    redisStarterQuery,
    redisDatabaseTarget,
  ),
  valkey: provider(
    'valkey',
    ['database', 'pattern'],
    ['database', 'prefix'],
    redisStarterQuery,
    redisDatabaseTarget,
  ),
  dynamodb: provider(
    'dynamodb',
    ['table'],
    ['table'],
    dynamoStarterQuery,
  ),
}

export function datastoreTestTargetProviderForConnection(
  connection: ConnectionProfile,
) {
  return DATASTORE_TEST_TARGET_PROVIDERS[connection.engine]
}

export function validateDatastoreTestTarget(
  connection: ConnectionProfile,
  target: ScopedQueryTarget | undefined,
) {
  const provider = datastoreTestTargetProviderForConnection(connection)
  if (!provider) {
    return `${connection.name} does not expose a validated datastore test target provider.`
  }
  if (!target) {
    return 'Choose a database or datastore object before creating the test suite.'
  }
  if (!provider.acceptedTargetKinds.has(normalizeTargetKind(target.kind))) {
    return `${target.kind} is not a supported test-suite target for ${connection.name}.`
  }
  return undefined
}

export function inferredDatastoreTestLanguage(
  connection: ConnectionProfile,
): QueryLanguage {
  return languageForConnection(connection)
}

export function datastoreTestStarterQuery(
  connection: ConnectionProfile,
  target: ScopedQueryTarget,
) {
  return (
    target.queryTemplate?.trim() ||
    datastoreTestTargetProviderForConnection(connection)?.starterQuery(
      connection,
      target,
    ) ||
    ''
  )
}

function sqlStarterQuery(
  _connection: ConnectionProfile,
  target: ScopedQueryTarget,
) {
  if (normalizeTargetKind(target.kind) === 'database') {
    return 'select 1;'
  }

  const parts = [...(target.path ?? []), target.label]
    .map((part) => part.trim())
    .filter((part, index, all) => part && all.indexOf(part) === index)
  return `select * from ${parts.map(quoteIdentifier).join('.')} limit 1;`
}

function mongoStarterQuery(
  connection: ConnectionProfile,
  target: ScopedQueryTarget,
) {
  if (normalizeTargetKind(target.kind) === 'database') {
    return JSON.stringify(
      {
        database: target.label,
        operation: 'runCommand',
        command: { ping: 1 },
      },
      null,
      2,
    )
  }

  return JSON.stringify(
    {
      database: targetDatabase(target, connection),
      collection: target.label,
      filter: {},
      limit: 1,
    },
    null,
    2,
  )
}

function redisStarterQuery(
  _connection: ConnectionProfile,
  target: ScopedQueryTarget,
) {
  return normalizeTargetKind(target.kind) === 'prefix'
    ? `SCAN 0 MATCH ${target.label}* COUNT 25`
    : 'PING'
}

function dynamoStarterQuery(
  _connection: ConnectionProfile,
  target: ScopedQueryTarget,
) {
  return JSON.stringify(
    { operation: 'Scan', tableName: target.label, limit: 1 },
    null,
    2,
  )
}

function targetDatabase(
  target: ScopedQueryTarget,
  connection: ConnectionProfile,
) {
  return (
    target.path?.find(
      (part) =>
        part.trim() &&
        part !== target.label &&
        !['collections', 'views'].includes(part.trim().toLowerCase()),
    ) ??
    connection.database ??
    ''
  )
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function normalizeTargetKind(value: string) {
  return value.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')
}
