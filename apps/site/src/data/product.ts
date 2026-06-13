import type { ScreenshotId } from './screenshots'

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
      'Connect, explore, query, inspect, edit, test, and manage multiple datastore families without changing tools.',
    screenshot: 'hero-workbench',
  },
  {
    title: 'Datastore-native surfaces',
    description:
      'Tables feel like tables, collections feel like collections, and Redis keys open in type-aware views instead of generic payload dumps.',
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
  'Create a local or read-only connection.',
  'Attach the right environment before querying.',
  'Explore native objects and diagnostics.',
  'Run bounded reads, inspect results, then save useful work.',
  'Promote edits or admin actions only after guardrails prove the target.',
]
