import type { ScreenshotId } from './screenshots'

export const websiteUrl = 'https://datapad-plus-plus.org/'
export const repoUrl = 'https://github.com/FullMontyDevelopment/DataPadPlusPlus'
export const releasesUrl = `${repoUrl}/releases`

export type Feature = {
  title: string
  description: string
  screenshot: ScreenshotId
  problem: string
  href: string
}

export const coreFeatures: Feature[] = [
  {
    title: 'One workbench instead of many database IDEs',
    problem: 'Too many separate tools make connections, tabs, and saved work difficult to manage.',
    description:
      'Keep connections, environments, Explorer objects, saved work, query tabs, results, and diagnostics together without flattening every datastore into the same interface.',
    screenshot: 'hero-workbench',
    href: '/docs/first-launch',
  },
  {
    title: 'Native-feeling tools beyond basic editor extensions',
    problem: 'A query textbox alone is not enough for discovery, diagnostics, results, and safe edits.',
    description:
      'Tables feel like tables, documents keep native types, Redis keys open in complete type-aware views, and search, graph, metrics, and analytical engines retain their own workflows.',
    screenshot: 'explorer-tree',
    href: '/docs/datastore-explorer',
  },
  {
    title: 'Visible target and environment context',
    problem: 'The most dangerous mistake is running the right query against the wrong target.',
    description:
      'Every tab carries its connection, environment, database/schema or object scope, and persistent environment color—even when it moves into an experimental detached window.',
    screenshot: 'multi-window-tabs',
    href: '/docs/multi-window-tabs',
  },
  {
    title: 'Validated builders and guarded editing',
    problem: 'Permissive inputs and guessed target identity turn convenient editing into unsafe execution.',
    description:
      'Build nested typed filters, validate JSON explicitly, edit documents or rows only with stable identity, and refresh from authoritative server evidence.',
    screenshot: 'typed-query-builder',
    href: '/docs/typed-query-builders',
  },
  {
    title: 'Native and portable data movement',
    problem: 'Generic exports lose types, while vendor backup tools differ dramatically between engines.',
    description:
      'Choose only manifest-supported formats and destinations, validate before starting, fail imports on conflict, and follow background work in Transfers Center.',
    screenshot: 'datastore-transfer',
    href: '/docs/native-datastore-transfers',
  },
  {
    title: 'Versioned, encrypted, recoverable workspaces',
    problem: 'Backups should not silently leak credentials or grow with disposable result payloads.',
    description:
      'Export compact encrypted bundles, opt into secrets explicitly, preview file-first imports, name new workspaces, recover destructive replacements, and analyze size without exposing contents.',
    screenshot: 'workspace-import-review',
    href: '/docs/workspace-import-export',
  },
  {
    title: 'Search, test, map, and expose work deliberately',
    problem: 'Reusable knowledge disappears when it lives only in open editors and private mental context.',
    description:
      'Use the Library, Workspace Search, relationship maps, datastore test suites, and opt-in API/MCP servers to turn explored data into intentional reusable workflows.',
    screenshot: 'workspace-search',
    href: '/docs/workspace-search',
  },
]

export const datastoreGroups = [
  {
    family: 'SQL and relational',
    engines: ['PostgreSQL', 'CockroachDB', 'SQL Server', 'Azure SQL', 'MySQL', 'MariaDB', 'SQLite', 'Oracle', 'TimescaleDB'],
  },
  {
    family: 'Document and NoSQL',
    engines: ['MongoDB', 'DynamoDB', 'Cassandra', 'Cosmos DB'],
  },
  {
    family: 'Key-value and cache',
    engines: ['Redis', 'Valkey', 'Memcached'],
  },
  {
    family: 'Search',
    engines: ['Elasticsearch', 'OpenSearch'],
  },
  {
    family: 'Local and analytical',
    engines: ['DuckDB', 'LiteDB', 'ClickHouse', 'Snowflake', 'BigQuery'],
  },
  {
    family: 'Time-series, metrics, and graph',
    engines: ['Prometheus', 'InfluxDB', 'OpenTSDB', 'Neo4j', 'ArangoDB', 'JanusGraph', 'Neptune'],
  },
]

export const launchWorkflow = [
  'Install a pre-release build for your platform.',
  'Create a local, fixture-backed, or read-only connection.',
  'Attach the right environment before querying.',
  'Explore native objects and diagnostics.',
  'Run bounded reads, inspect results, export what you need, then save useful work.',
  'Search saved work or enable Datastore Tests for target-bound, adapter-backed checks.',
  'Promote edits, transfers, or admin actions only after guardrails prove the target.',
  'Enable API Server or MCP Server plugins only when a local integration needs it.',
]
