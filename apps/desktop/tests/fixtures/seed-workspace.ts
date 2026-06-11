import type {
  AppHealth,
  AppPreferences,
  BootstrapPayload,
  ConnectionProfile,
  DiagnosticsReport,
  EnvironmentProfile,
  ExplorerNode,
  GuardrailDecision,
  QueryTabState,
  ResolvedEnvironment,
  SavedWorkItem,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { DATAPADPLUSPLUS_ADAPTER_MANIFESTS } from '@datapadplusplus/shared-types'
import { buildDiagnosticsReport, resolveEnvironment } from '../../src/app/state/helpers'

const adapterManifests = DATAPADPLUSPLUS_ADAPTER_MANIFESTS

const timestamp = '2026-04-23T18:30:00.000Z'

const preferences: AppPreferences = {
  theme: 'dark',
  telemetry: 'opt-in',
  lockAfterMinutes: 15,
  safeModeEnabled: true,
}

const connections: ConnectionProfile[] = [
  {
    id: 'conn-analytics',
    name: 'Analytics Postgres',
    engine: 'postgresql',
    family: 'sql',
    host: '${DB_HOST}',
    port: 5432,
    database: '${DB_NAME}',
    environmentIds: ['env-dev', 'env-prod'],
    tags: ['analytics', 'primary'],
    favorite: true,
    readOnly: false,
    icon: 'PG',
    group: 'Platform',
    auth: {
      username: '${USERNAME}',
      sslMode: 'require',
      secretRef: {
        id: 'secret-postgres-prod',
        provider: 'os-keyring',
        service: 'DataPad++',
        account: 'analytics-prod',
        label: 'Analytics prod credential',
      },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'conn-orders',
    name: 'Orders SQL Server',
    engine: 'sqlserver',
    family: 'sql',
    host: '${ORDERS_HOST}',
    port: 1433,
    database: 'orders',
    environmentIds: ['env-uat'],
    tags: ['orders', 'support'],
    favorite: false,
    readOnly: true,
    icon: 'MS',
    group: 'Operations',
    auth: {
      username: '${USERNAME}',
      sslMode: 'require',
      secretRef: {
        id: 'secret-orders-uat',
        provider: 'os-keyring',
        service: 'DataPad++',
        account: 'orders-uat',
        label: 'Orders UAT credential',
      },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'conn-catalog',
    name: 'Catalog Mongo',
    engine: 'mongodb',
    family: 'document',
    host: '${MONGO_HOST}',
    port: 27017,
    database: 'catalog',
    environmentIds: ['env-dev'],
    tags: ['catalog', 'documents'],
    favorite: true,
    readOnly: false,
    icon: 'MG',
    group: 'Applications',
    auth: {
      username: '${USERNAME}',
      authMechanism: 'SCRAM-SHA-256',
      secretRef: {
        id: 'secret-mongo-dev',
        provider: 'os-keyring',
        service: 'DataPad++',
        account: 'catalog-dev',
        label: 'Catalog dev credential',
      },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'conn-commerce',
    name: 'Commerce MySQL',
    engine: 'mysql',
    family: 'sql',
    host: '${MYSQL_HOST}',
    port: 3306,
    database: 'commerce',
    environmentIds: ['env-dev'],
    tags: ['commerce', 'mysql'],
    favorite: false,
    readOnly: false,
    icon: 'MY',
    group: 'Applications',
    auth: {
      username: '${USERNAME}',
      secretRef: {
        id: 'secret-mysql-dev',
        provider: 'os-keyring',
        service: 'DataPad++',
        account: 'commerce-dev',
        label: 'Commerce dev credential',
      },
    },
    mysqlOptions: {
      connectMode: 'tcp',
      authMode: 'password',
      sslMode: 'preferred',
      serverFlavor: 'mysql',
      charset: 'utf8mb4',
      collation: 'utf8mb4_0900_ai_ci',
      timeZone: '+00:00',
      sqlMode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION',
      defaultStorageEngine: 'InnoDB',
      allowLocalInfile: false,
      connectTimeoutMs: 5000,
      commandTimeoutMs: 30000,
      statementCacheCapacity: 100,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'conn-local-sqlite',
    name: 'Local SQLite',
    engine: 'sqlite',
    family: 'sql',
    host: '${SQLITE_PATH}',
    database: '${SQLITE_PATH}',
    environmentIds: ['env-dev'],
    tags: ['local', 'sqlite'],
    favorite: true,
    readOnly: false,
    icon: 'SQ',
    group: 'Local',
    auth: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'conn-cache',
    name: 'Session Redis',
    engine: 'redis',
    family: 'keyvalue',
    host: '${REDIS_HOST}',
    port: 6379,
    environmentIds: ['env-prod'],
    tags: ['cache', 'sessions'],
    favorite: true,
    readOnly: true,
    icon: 'RD',
    group: 'Platform',
    auth: {
      username: 'default',
      secretRef: {
        id: 'secret-redis-prod',
        provider: 'os-keyring',
        service: 'DataPad++',
        account: 'redis-prod',
        label: 'Redis prod credential',
      },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  },
]

const environments: EnvironmentProfile[] = [
  {
    id: 'env-dev',
    label: 'Dev',
    color: '#2dbf9b',
    risk: 'low',
    variables: {
      DB_HOST: 'analytics-dev.internal',
      DB_NAME: 'datapadplusplus_dev',
      USERNAME: 'developer',
      MONGO_HOST: 'catalog-dev.internal',
      MYSQL_HOST: 'commerce-dev.internal',
      SQLITE_PATH:
        'C:\\Users\\gmont\\source\\repos\\DataPad++\\tests\\fixtures\\sqlite\\datapadplusplus.sqlite3',
    },
    sensitiveKeys: [],
    requiresConfirmation: false,
    safeMode: false,
    exportable: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'env-uat',
    label: 'UAT',
    color: '#f3a952',
    risk: 'medium',
    inheritsFrom: 'env-dev',
    variables: {
      ORDERS_HOST: 'orders-uat.internal',
    },
    sensitiveKeys: [],
    requiresConfirmation: true,
    safeMode: true,
    exportable: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'env-prod',
    label: 'Prod',
    color: '#ec7b7b',
    risk: 'critical',
    inheritsFrom: 'env-dev',
    variables: {
      DB_HOST: 'analytics-prod.internal',
      REDIS_HOST: 'session-prod.internal',
      PASSWORD_REF: 'keyring://datapadplusplus/prod',
    },
    sensitiveKeys: ['PASSWORD_REF'],
    requiresConfirmation: true,
    safeMode: true,
    exportable: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
]

const explorerNodes: ExplorerNode[] = [
  {
    id: 'explorer-history',
    family: 'shared',
    label: 'Recent executions',
    kind: 'timeline',
    detail: 'Last 24 runs across all tabs',
    scope: 'shared:history',
    path: ['Workspace'],
  },
  {
    id: 'explorer-postgres-schema',
    family: 'sql',
    label: 'public',
    kind: 'schema',
    detail: '32 tables | 14 views | 6 functions',
    scope: 'schema:public',
    path: ['Analytics Postgres'],
    expandable: true,
    queryTemplate: 'select table_name from information_schema.tables where table_schema = \'public\' order by table_name;',
  },
  {
    id: 'explorer-postgres-index',
    family: 'sql',
    label: 'Indexes',
    kind: 'metadata',
    detail: 'Hot paths, constraints, and plans',
    scope: 'metadata:indexes',
    path: ['Analytics Postgres'],
  },
  {
    id: 'explorer-mongo-products',
    family: 'document',
    label: 'products',
    kind: 'collection',
    detail: 'Validators, samples, and indexes',
    scope: 'collection:products',
    path: ['Catalog Mongo'],
    expandable: true,
    queryTemplate:
      '{\n  "collection": "products",\n  "filter": {},\n  "limit": 100\n}',
  },
  {
    id: 'explorer-redis-sessions',
    family: 'keyvalue',
    label: 'session:*',
    kind: 'prefix',
    detail: '91 active keys with TTL visibility',
    scope: 'prefix:session:*',
    path: ['Session Redis'],
    expandable: true,
    queryTemplate: 'SCAN 0 MATCH session:* COUNT 50',
  },
  {
    id: 'explorer-mysql-commerce',
    family: 'sql',
    label: 'commerce',
    kind: 'schema',
    detail: 'MySQL catalog tables',
    scope: 'schema:commerce',
    path: ['Commerce MySQL'],
    expandable: true,
    queryTemplate:
      "select table_name from information_schema.tables where table_schema = 'commerce';",
  },
  {
    id: 'explorer-sqlite-main',
    family: 'sql',
    label: 'main',
    kind: 'schema',
    detail: 'SQLite tables and views',
    scope: 'table:users',
    path: ['Local SQLite'],
    expandable: true,
    queryTemplate:
      "select name from sqlite_master where type = 'table' order by name;",
  },
]

const tabs: QueryTabState[] = [
  {
    id: 'tab-sql-ops',
    title: 'Ops dashboard',
    connectionId: 'conn-analytics',
    environmentId: 'env-prod',
    family: 'sql',
    language: 'sql',
    pinned: true,
    editorLabel: 'SQL editor',
    queryText: `select
  table_name,
  rows_estimate,
  last_vacuum
from observability.table_health
order by rows_estimate desc
limit 20;`,
    status: 'idle',
    dirty: false,
    history: [],
  },
  {
    id: 'tab-orders-audit',
    title: 'Orders audit',
    connectionId: 'conn-orders',
    environmentId: 'env-uat',
    family: 'sql',
    language: 'sql',
    editorLabel: 'SQL editor',
    queryText: `select top 50
  order_id,
  status,
  updated_at
from dbo.orders
where updated_at >= dateadd(hour, -12, sysutcdatetime())
order by updated_at desc;`,
    status: 'idle',
    dirty: false,
    history: [],
  },
  {
    id: 'tab-mongo-catalog',
    title: 'Catalog inventory',
    connectionId: 'conn-catalog',
    environmentId: 'env-dev',
    family: 'document',
    language: 'mongodb',
    editorLabel: 'Document query',
    queryText: `{
  "collection": "products",
  "pipeline": [
    { "$match": { "channels": "web" } },
    { "$project": { "sku": 1, "inventory": 1, "channels": 1 } },
    { "$limit": 50 }
  ]
}`,
    status: 'idle',
    dirty: false,
    history: [],
  },
  {
    id: 'tab-commerce-mysql',
    title: 'Commerce inventory',
    connectionId: 'conn-commerce',
    environmentId: 'env-dev',
    family: 'sql',
    language: 'sql',
    editorLabel: 'SQL editor',
    queryText:
      'select sku, inventory_available, updated_at from inventory_items order by updated_at desc limit 50;',
    status: 'idle',
    dirty: false,
    history: [],
  },
  {
    id: 'tab-local-sqlite',
    title: 'SQLite scratch',
    connectionId: 'conn-local-sqlite',
    environmentId: 'env-dev',
    family: 'sql',
    language: 'sql',
    editorLabel: 'SQL editor',
    queryText:
      "select name from sqlite_master where type = 'table' order by name;",
    status: 'idle',
    dirty: false,
    history: [],
  },
  {
    id: 'tab-redis-session',
    title: 'Session inspector',
    connectionId: 'conn-cache',
    environmentId: 'env-prod',
    family: 'keyvalue',
    language: 'redis',
    editorLabel: 'Redis console',
    queryText: `SCAN 0 MATCH session:* COUNT 25
HGETALL session:9f2d7e1a
TTL session:9f2d7e1a`,
    status: 'idle',
    dirty: false,
    history: [],
  },
]

const savedWork: SavedWorkItem[] = [
  {
    id: 'saved-locks',
    kind: 'query',
    name: 'Prod lock sweep',
    summary: 'Checks blocking sessions with environment-resolved variables.',
    tags: ['postgresql', 'ops'],
    folder: 'Runbooks',
    favorite: true,
    connectionId: 'conn-analytics',
    environmentId: 'env-prod',
    language: 'sql',
    queryText: `select
  pid,
  usename,
  wait_event_type,
  wait_event,
  query
from pg_stat_activity
where state <> 'idle'
order by query_start asc
limit 100;`,
    updatedAt: timestamp,
  },
  {
    id: 'saved-hotkeys',
    kind: 'template',
    name: 'Redis hot key pack',
    summary: 'Reusable prefix, TTL, and memory inspection workflow.',
    tags: ['redis', 'incident'],
    folder: 'Cache',
    connectionId: 'conn-cache',
    environmentId: 'env-prod',
    language: 'redis',
    queryText: 'SCAN 0 MATCH session:* COUNT 50',
    updatedAt: timestamp,
  },
  {
    id: 'saved-catalog',
    kind: 'investigation-pack',
    name: 'Catalog variance',
    summary: 'Saved filters, notes, and snapshots for inventory drift.',
    tags: ['mongodb', 'support'],
    folder: 'Applications',
    connectionId: 'conn-catalog',
    environmentId: 'env-dev',
    language: 'mongodb',
    queryText: `{
  "collection": "products",
  "filter": { "status": "active" },
  "limit": 50
}`,
    updatedAt: timestamp,
  },
]

const guardrails: GuardrailDecision[] = [
  {
    status: 'confirm',
    reasons: ['Prod sessions require explicit confirmation before writes.'],
    safeModeApplied: true,
    requiredConfirmationText: 'CONFIRM Prod',
  },
]

export function createSeedSnapshot(): WorkspaceSnapshot {
  return {
    schemaVersion: 3,
    connections,
    environments,
    tabs,
    closedTabs: [],
    libraryNodes: [],
    savedWork,
    explorerNodes,
    adapterManifests,
    preferences,
    guardrails,
    lockState: {
      isLocked: false,
    },
    ui: {
      activeConnectionId: 'conn-analytics',
      activeEnvironmentId: 'env-prod',
      activeTabId: 'tab-sql-ops',
      explorerFilter: '',
      explorerView: 'structure',
      connectionGroupMode: 'none',
      sidebarSectionStates: {},
      activeActivity: 'library',
      sidebarCollapsed: false,
      activeSidebarPane: 'library',
      sidebarWidth: 280,
      bottomPanelVisible: true,
      activeBottomPanelTab: 'results',
      bottomPanelHeight: 260,
      resultsDock: 'bottom',
      resultsSideWidth: 420,
      rightDrawer: 'none',
      rightDrawerWidth: 360,
    },
    updatedAt: timestamp,
  }
}

export function createSeedHealth(): AppHealth {
  return {
    runtime: 'browser-preview',
    adapterHost: 'simulated',
    secretStorage: 'planned',
    platform: 'web',
    telemetry: 'opt-in',
  }
}

export function createSeedBootstrapPayload(): BootstrapPayload {
  const snapshot = createSeedSnapshot()
  const resolvedEnvironment = resolveEnvironment(
    snapshot.environments,
    snapshot.ui.activeEnvironmentId,
  )
  const diagnostics = buildDiagnosticsReport(snapshot, createSeedHealth())

  return {
    health: createSeedHealth(),
    snapshot,
    resolvedEnvironment,
    diagnostics,
  }
}

export function createSeedDiagnosticsReport(
  snapshot: WorkspaceSnapshot,
  health: AppHealth,
): DiagnosticsReport {
  return buildDiagnosticsReport(snapshot, health)
}

export function createSeedResolvedEnvironment(
  snapshot: WorkspaceSnapshot,
): ResolvedEnvironment {
  return resolveEnvironment(snapshot.environments, snapshot.ui.activeEnvironmentId)
}
