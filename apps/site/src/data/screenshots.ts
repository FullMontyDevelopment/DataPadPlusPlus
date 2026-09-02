import { declaredDatastoreEngines, type DatastoreEngineId } from './datastore-engines'

export type CommonScreenshotId =
  | 'hero-workbench'
  | 'connection-wizard'
  | 'library-environments'
  | 'explorer-tree'
  | 'sql-query-results'
  | 'mongodb-builder'
  | 'redis-browser'
  | 'search-diagnostics'
  | 'import-export'
  | 'result-export'
  | 'settings-backups'
  | 'download-release'
  | 'safety-preview'
  | 'api-server'
  | 'mcp-server'
  | 'workspace-search'
  | 'test-suites'
  | 'relationship-explorer'
  | 'typed-query-builder'
  | 'document-editor'
  | 'key-value-inspector'
  | 'datastore-transfer'
  | 'transfer-center'
  | 'workspace-import-review'
  | 'multi-window-tabs'
  | 'plugins-ready'
  | 'plugins-experimental'
  | 'workspace-switcher'
  | 'security-checks'
  | 'oracle-paging'

export type DatastoreScreenshotId = `datastore-${DatastoreEngineId}-${'connection' | 'workflow'}`

export type ScreenshotId = CommonScreenshotId | DatastoreScreenshotId

export type ScreenshotSlot = {
  id: ScreenshotId
  title: string
  alt: string
  caption: string
  image: string
  captureCase: string
  sharedAsset?: boolean
}

type ScreenshotDefinition = Pick<ScreenshotSlot, 'title' | 'caption' | 'image'> & {
  id?: CommonScreenshotId
  sharedAsset?: boolean
}

const commonScreenshotDefinitions: Record<CommonScreenshotId, ScreenshotDefinition> = {
  'hero-workbench': {
    id: 'hero-workbench',
    title: 'Workbench overview',
    caption: 'Hero image showing the full DataPad++ desktop workspace.',
    image: '/screenshots/hero-workbench.png',
  },
  'connection-wizard': {
    id: 'connection-wizard',
    title: 'Connection wizard',
    caption: 'Connection profile fields, read-only settings, and test result.',
    image: '/screenshots/connection-wizard.png',
  },
  'library-environments': {
    id: 'library-environments',
    title: 'Library and environments',
    caption: 'Saved connections, folders, scripts, and inherited environment labels.',
    image: '/screenshots/library-environments.png',
  },
  'explorer-tree': {
    id: 'explorer-tree',
    title: 'Object explorer',
    caption: 'Datastore-owned tree with native objects and context actions.',
    image: '/screenshots/explorer-tree.png',
  },
  'sql-query-results': {
    id: 'sql-query-results',
    title: 'SQL query results',
    caption: 'Editor, result grid, messages, and row selection in one workspace.',
    image: '/screenshots/sql-query-results.png',
  },
  'mongodb-builder': {
    id: 'mongodb-builder',
    title: 'MongoDB query builder',
    caption: 'Filters, projections, sort, explain plans, and document results.',
    image: '/screenshots/mongodb-builder.png',
  },
  'redis-browser': {
    id: 'redis-browser',
    title: 'Redis key browser',
    caption: 'Key filters, type-aware value surfaces, TTL, and guarded key actions.',
    image: '/screenshots/redis-browser.png',
  },
  'search-diagnostics': {
    id: 'search-diagnostics',
    title: 'Search diagnostics',
    caption: 'Index, mapping, profile, shard, and slow-log inspection surfaces.',
    image: '/screenshots/search-diagnostics.png',
  },
  'import-export': {
    id: 'import-export',
    title: 'Guarded document edit',
    caption: 'A document field change staged for target and environment review before it is sent to the datastore.',
    image: '/screenshots/import-export.png',
  },
  'result-export': {
    id: 'result-export',
    title: 'Result export dialog',
    caption: 'Payload-aware CSV, JSON, NDJSON, and text exports with secret redaction.',
    image: '/screenshots/result-export.png',
  },
  'settings-backups': {
    id: 'settings-backups',
    title: 'Settings and backups',
    caption: 'Workspace bundles, encrypted backups, appearance, health, and shortcuts.',
    image: '/screenshots/settings-backups.png',
  },
  'download-release': {
    id: 'download-release',
    title: 'Update settings',
    caption: 'Update channel, current version, available version, and install controls for the desktop app.',
    image: '/screenshots/download-release.png',
  },
  'safety-preview': {
    id: 'safety-preview',
    title: 'Security settings',
    caption: 'Global safe mode explains how risky writes, inline edits, API and MCP requests, and read-only work are guarded.',
    image: '/screenshots/safety-preview.png',
  },
  'api-server': {
    id: 'api-server',
    title: 'API Server workspace',
    caption: 'Local REST, GraphQL, or gRPC servers exposing selected datastore resources and saved queries.',
    image: '/screenshots/api-server.png',
  },
  'mcp-server': {
    id: 'mcp-server',
    title: 'MCP Server setup',
    caption: 'Desktop-only MCP endpoints, scoped auth tokens, client snippets, metrics, and logs.',
    image: '/screenshots/mcp-server.png',
  },
  'workspace-search': {
    id: 'workspace-search',
    title: 'Workspace Search',
    caption: 'Search connections, Library work, open tabs, recently closed tabs, scripts, and tests.',
    image: '/screenshots/workspace-search.png',
  },
  'test-suites': {
    id: 'test-suites',
    title: 'Datastore test suites',
    caption: 'The test-suite workspace explains that a saved datastore target is required before cases can run.',
    image: '/screenshots/test-suites.png',
  },
  'relationship-explorer': {
    id: 'relationship-explorer',
    title: 'SQL relationship explorer',
    caption: 'Focused schema diagrams with table cards, relationship ends, and object inspectors.',
    image: '/screenshots/relationship-explorer.png',
  },
  'typed-query-builder': {
    id: 'typed-query-builder',
    title: 'Typed query builder values',
    caption: 'A Date/time filter using a timezone-aware ISO value and the compact native picker before query execution.',
    image: '/screenshots/typed-query-builder.png',
  },
  'document-editor': {
    id: 'document-editor',
    title: 'Guarded document field editing',
    caption: 'A field-level document change paused for target and environment review before execution.',
    image: '/screenshots/document-editor.png',
  },
  'key-value-inspector': {
    id: 'key-value-inspector',
    title: 'Key-value context actions',
    caption: 'The read-only entry menu exposes copy and full-value inspection actions while mutation controls remain unavailable.',
    image: '/screenshots/key-value-inspector.png',
  },
  'datastore-transfer': {
    id: 'datastore-transfer',
    title: 'Native datastore transfer',
    caption: 'Selected objects, native or portable formats, destination options, validation, and conflict-safe review.',
    image: '/screenshots/datastore-transfer.png',
  },
  'transfer-center': {
    id: 'transfer-center',
    title: 'Transfers Center',
    caption: 'Transfers Center shows a failed example transfer with its warning count, failure detail, retry control, and dismiss action.',
    image: '/screenshots/transfer-center.png',
  },
  'workspace-import-review': {
    id: 'workspace-import-review',
    title: 'File-first workspace import',
    caption: 'A staged choose-file, unlock, and review workflow that keeps encrypted contents closed until the passphrase is entered.',
    image: '/screenshots/workspace-import-review.png',
  },
  'multi-window-tabs': {
    id: 'multi-window-tabs',
    title: 'Experimental multi-window controls',
    caption: 'The tab context menu exposes the preview-only move-to-window action and its current availability state.',
    image: '/screenshots/multi-window-tabs.png',
  },
  'plugins-ready': {
    id: 'plugins-ready',
    title: 'Plugin settings',
    caption: 'The Plugins settings section shows each opt-in capability, its maturity, supported platforms, and enable control.',
    image: '/screenshots/plugins-ready.png',
  },
  'plugins-experimental': {
    id: 'plugins-experimental',
    title: 'Experimental plugin settings',
    caption: 'Experimental plugins identify their current feature boundary before you enable them for the workspace.',
    image: '/screenshots/plugins-experimental.png',
  },
  'workspace-switcher': {
    id: 'workspace-switcher',
    title: 'Create a named workspace',
    caption: 'The Workspaces section creates and switches named local workspace profiles after saving the current workspace.',
    image: '/screenshots/workspace-switcher.png',
  },
  'security-checks': {
    id: 'security-checks',
    title: 'Datastore Security Checks',
    caption: 'An illustrative Posture view groups advisory checks by connection and environment with severity, evidence, and remediation details.',
    image: '/screenshots/security-checks.png',
  },
  'oracle-paging': {
    id: 'oracle-paging',
    title: 'Oracle paging and completion',
    caption: 'Load more for large Oracle schema branches with selected-schema progressive object and column completion.',
    image: '/screenshots/oracle-paging.png',
  },
}

const datastoreLabels: Record<DatastoreEngineId, string> = {
  postgresql: 'PostgreSQL',
  cockroachdb: 'CockroachDB',
  sqlserver: 'SQL Server / Azure SQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  sqlite: 'SQLite',
  oracle: 'Oracle',
  mongodb: 'MongoDB',
  dynamodb: 'DynamoDB',
  cassandra: 'Cassandra',
  cosmosdb: 'Cosmos DB',
  litedb: 'LiteDB',
  redis: 'Redis',
  valkey: 'Valkey',
  memcached: 'Memcached',
  neo4j: 'Neo4j',
  neptune: 'Amazon Neptune',
  arango: 'ArangoDB',
  janusgraph: 'JanusGraph',
  influxdb: 'InfluxDB',
  timescaledb: 'TimescaleDB',
  prometheus: 'Prometheus',
  opentsdb: 'OpenTSDB',
  elasticsearch: 'Elasticsearch',
  opensearch: 'OpenSearch',
  clickhouse: 'ClickHouse',
  duckdb: 'DuckDB',
  snowflake: 'Snowflake',
  bigquery: 'BigQuery',
}

const commonScreenshotSlots = Object.fromEntries(
  Object.entries(commonScreenshotDefinitions).map(([id, definition]) => [
    id,
    {
      id,
      ...definition,
      alt: `${definition.title}. ${definition.caption}`,
      captureCase: `common:${id}`,
    },
  ]),
) as Record<CommonScreenshotId, ScreenshotSlot>

const datastoreScreenshotSlots = Object.fromEntries(
  declaredDatastoreEngines.flatMap((engine) => {
    const label = datastoreLabels[engine]
    return ([
      {
        id: `datastore-${engine}-connection`,
        title: `${label} connection setup`,
        caption: `The native ${label} connection form with illustrative, non-secret values, platform notes, and connection-test feedback.`,
        image: `/screenshots/datastores/${engine}-connection.png`,
        captureCase: `datastore:${engine}:connection`,
      },
      {
        id: `datastore-${engine}-workflow`,
        title: `${label} native workflow`,
        caption: `A representative ${label} explorer and bounded read-only workflow. Replace the example objects with names from your datastore.`,
        image: `/screenshots/datastores/${engine}-workflow.png`,
        captureCase: `datastore:${engine}:workflow`,
      },
    ] as ScreenshotSlot[]).map((slot) => [slot.id, { ...slot, alt: `${slot.title}. ${slot.caption}` }])
  }),
) as Record<DatastoreScreenshotId, ScreenshotSlot>

export const screenshotSlots: Record<ScreenshotId, ScreenshotSlot> = {
  ...commonScreenshotSlots,
  ...datastoreScreenshotSlots,
}

export function getScreenshotSlot(id: ScreenshotId) {
  return screenshotSlots[id]
}
