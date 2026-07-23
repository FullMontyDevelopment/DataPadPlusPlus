import type { ScreenshotId } from './screenshots'

export const websiteUrl = 'https://datapad-plus-plus.org/'
export const repoUrl = 'https://github.com/FullMontyDevelopment/DataPadPlusPlus'
export const releasesUrl = `${repoUrl}/releases`

export type Feature = {
  title: string
  description: string
  screenshot: ScreenshotId
}

export const coreFeatures: Feature[] = [
  {
    title: 'One focused workspace',
    description:
      'Connect, explore, query, inspect, edit, test, expose, and manage multiple datastore families without changing tools.',
    screenshot: 'hero-workbench',
  },
  {
    title: 'Datastore-native surfaces',
    description:
      'Tables feel like tables, collections feel like collections, Redis keys open in type-aware views, and search/cloud/local engines keep their own posture.',
    screenshot: 'explorer-tree',
  },
  {
    title: 'Guarded by design',
    description:
      'Risky work is visible, read-only profiles are respected, and destructive or administrative actions stay preview-first unless identity and environment checks pass.',
    screenshot: 'safety-preview',
  },
  {
    title: 'Reusable work lives in the Library',
    description:
      'Save connections, folders, queries, scripts, notes, tests, snippets, snapshots, and environment context together.',
    screenshot: 'library-environments',
  },
  {
    title: 'Search and prove reusable work',
    description:
      'Search the workspace across connections, Library items, tabs, scripts, and tests, then turn repeatable checks into datastore test suites.',
    screenshot: 'workspace-search',
  },
  {
    title: 'Expose data deliberately',
    description:
      'Opt-in API Server and MCP Server plugins publish selected resources, saved queries, setup snippets, metrics, and logs without turning the whole desktop into an open endpoint.',
    screenshot: 'api-server',
  },
  {
    title: 'Map relationships before writing SQL',
    description:
      'Use focused SQL relationship diagrams, table inspectors, declared keys, and optional inferred links to understand schemas before querying.',
    screenshot: 'relationship-explorer',
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
  'Install a release build for your platform.',
  'Create a local, fixture-backed, or read-only connection.',
  'Attach the right environment before querying.',
  'Explore native objects and diagnostics.',
  'Run bounded reads, inspect results, export what you need, then save useful work.',
  'Search saved work or build test suites for repeatable checks.',
  'Promote edits or admin actions only after guardrails prove the target.',
  'Enable API Server or MCP Server plugins only when a local integration needs it.',
]
