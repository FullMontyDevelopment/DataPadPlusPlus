import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import {
  isPostgresSystemSchema,
  parsePostgresNodeId,
  parsePostgresObjectScope,
  postgresSectionLabel,
} from './browser-postgres-family-helpers'

export function createTimescaleExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      timescaleNode(connection, 'schema:public', 'public', 'schema', 'User schema', 'schema:public', ['User Schemas'], true),
      timescaleNode(connection, 'schema:observability', 'observability', 'schema', 'User schema', 'schema:observability', ['User Schemas'], true),
      timescaleNode(connection, 'schema:pg_catalog', 'pg_catalog', 'schema', 'System schema', 'schema:pg_catalog', ['System Schemas'], true),
      timescaleNode(connection, 'timescale:hypertables', 'Hypertables', 'hypertables', 'Time-partitioned tables, chunks, compression, and retention', 'timescale:hypertables', [], true),
      timescaleNode(connection, 'timescale:continuous-aggregates', 'Continuous Aggregates', 'continuous-aggregates', 'Materialized time-bucket views and refresh policies', 'timescale:continuous-aggregates', [], true),
      timescaleNode(connection, 'timescale:jobs', 'Jobs', 'jobs', 'Policy and refresh jobs', 'timescale:jobs', [], true),
      timescaleNode(connection, 'timescale:diagnostics', 'Diagnostics', 'diagnostics', 'Chunk health, compression coverage, and refresh lag', 'timescale:diagnostics', [], true),
      timescaleNode(connection, 'postgres:security', 'Security', 'security', 'Roles, grants, and privileges', 'postgres:security', [], true),
    ]
  }

  if (scope.startsWith('schema:')) {
    const schema = scope.replace('schema:', '') || 'public'
    return timescaleSchemaFolders(connection, schema)
  }

  if (scope === 'timescale:hypertables') {
    return timescaleHypertables(connection)
  }

  if (scope === 'timescale:continuous-aggregates') {
    return timescaleContinuousAggregates(connection)
  }

  if (scope === 'timescale:jobs') {
    return timescaleJobNodes(connection)
  }

  if (scope === 'timescale:diagnostics') {
    return timescaleDiagnosticNodes(connection)
  }

  if (scope.startsWith('hypertable:')) {
    const { schema, objectName } = parsePostgresNodeId(connection, scope)
    return timescaleHypertableSections(connection, schema, objectName)
  }

  if (scope.startsWith('continuous-aggregate:')) {
    const { schema, objectName } = parsePostgresNodeId(connection, scope)
    return timescaleContinuousAggregateSections(connection, schema, objectName)
  }

  if (scope.startsWith('postgres:')) {
    const [, schemaOrSection = 'public', section = ''] = scope.split(':')
    if (schemaOrSection === 'security') {
      return [
        timescaleNode(connection, 'postgres:security:roles', 'Roles', 'roles', 'Login and group roles', undefined, ['Security']),
        timescaleNode(connection, 'postgres:security:permissions', 'Permissions', 'permissions', 'Visible grants and privileges', undefined, ['Security']),
      ]
    }
    return timescaleObjectsForSection(connection, schemaOrSection, section)
  }

  if (scope.startsWith('table:')) {
    const { schema, objectName } = parsePostgresObjectScope(scope)
    return timescaleTableSections(connection, schema, objectName)
  }

  return []
}

function timescaleSchemaFolders(connection: ConnectionProfile, schema: string): ExplorerNode[] {
  const path = [connection.name, isPostgresSystemSchema(schema) ? 'System Schemas' : 'User Schemas', schema]
  const folder = (id: string, label: string, kind: string, detail: string) =>
    timescaleNode(connection, `postgres:${schema}:${id}`, label, kind, detail, `postgres:${schema}:${id}`, path, true)

  return [
    folder('tables', 'Tables', 'tables', 'Base and partitioned tables'),
    folder('views', 'Views', 'views', 'Stored SELECT definitions'),
    folder('materialized-views', 'Materialized Views', 'materialized-views', 'Persisted query projections'),
    folder('indexes', 'Indexes', 'indexes', 'Schema-level index list'),
    folder('functions', 'Functions', 'functions', 'Stored functions'),
    folder('procedures', 'Procedures', 'procedures', 'Stored procedures'),
    folder('sequences', 'Sequences', 'sequences', 'Sequence generators'),
    folder('types', 'Types', 'types', 'Enum, composite, domain, and range types'),
  ]
}

function timescaleObjectsForSection(
  connection: ConnectionProfile,
  schema: string,
  section: string,
): ExplorerNode[] {
  const path = [
    connection.name,
    isPostgresSystemSchema(schema) ? 'System Schemas' : 'User Schemas',
    schema,
    postgresSectionLabel(section),
  ]

  if (section === 'tables') {
    return ['accounts', 'orders', 'products'].map((table) =>
      timescaleNode(connection, `table:${schema}.${table}`, table, 'table', 'Base table', `table:${schema}.${table}`, path, true, `select * from "${schema}"."${table}" limit 100;`),
    )
  }

  if (section === 'views') {
    return [
      timescaleNode(connection, `view:${schema}:active_accounts`, 'active_accounts', 'view', 'View definition', undefined, path, false, `select * from "${schema}"."active_accounts" limit 100;`),
    ]
  }

  if (section === 'materialized-views') {
    return [
      timescaleNode(connection, `materialized-view:${schema}:daily_product_metrics`, 'daily_product_metrics', 'materialized-view', 'Materialized view', undefined, path, false, `select * from "${schema}"."daily_product_metrics" limit 100;`),
    ]
  }

  if (section === 'indexes') {
    return [
      timescaleNode(connection, `index:${schema}:accounts_pkey`, 'accounts_pkey', 'index', 'btree / unique', undefined, path),
      timescaleNode(connection, `index:${schema}:products_sku_idx`, 'products_sku_idx', 'index', 'btree', undefined, path),
    ]
  }

  if (section === 'functions') {
    return [
      timescaleNode(connection, `function:${schema}:account_status`, 'account_status', 'function', 'stable function', undefined, path),
    ]
  }

  return []
}

function timescaleHypertables(connection: ConnectionProfile): ExplorerNode[] {
  const path = [connection.name, 'Hypertables']
  return [
    timescaleNode(connection, 'hypertable:public:order_metrics', 'public.order_metrics', 'hypertable', '8 chunks / compressed / 90 day retention', 'hypertable:public:order_metrics', path, true, 'select * from "public"."order_metrics" limit 100;'),
    timescaleNode(connection, 'hypertable:observability:cpu_metrics', 'observability.cpu_metrics', 'hypertable', '12 chunks / partial compression / 30 day retention', 'hypertable:observability:cpu_metrics', path, true, 'select * from "observability"."cpu_metrics" limit 100;'),
  ]
}

function timescaleContinuousAggregates(connection: ConnectionProfile): ExplorerNode[] {
  const path = [connection.name, 'Continuous Aggregates']
  return [
    timescaleNode(connection, 'continuous-aggregate:observability:hourly_order_metrics', 'observability.hourly_order_metrics', 'continuous-aggregate', '1 hour bucket / 10 minute lag', 'continuous-aggregate:observability:hourly_order_metrics', path, true, 'select * from "observability"."hourly_order_metrics" limit 100;'),
    timescaleNode(connection, 'continuous-aggregate:observability:daily_cpu_metrics', 'observability.daily_cpu_metrics', 'continuous-aggregate', '1 day bucket / 35 minute lag', 'continuous-aggregate:observability:daily_cpu_metrics', path, true, 'select * from "observability"."daily_cpu_metrics" limit 100;'),
  ]
}

function timescaleJobNodes(connection: ConnectionProfile): ExplorerNode[] {
  const path = [connection.name, 'Jobs']
  return [
    timescaleNode(connection, 'timescale:jobs:compression', 'Compression Policies', 'compression', 'Scheduled compression jobs', undefined, path),
    timescaleNode(connection, 'timescale:jobs:retention', 'Retention Policies', 'retention', 'Scheduled retention jobs', undefined, path),
    timescaleNode(connection, 'timescale:jobs:refresh', 'Refresh Jobs', 'jobs', 'Continuous aggregate refresh jobs', undefined, path),
  ]
}

function timescaleDiagnosticNodes(connection: ConnectionProfile): ExplorerNode[] {
  const path = [connection.name, 'Diagnostics']
  return [
    timescaleNode(connection, 'timescale:diagnostics:chunks', 'Chunks', 'chunks', 'Chunk ranges, sizes, and compression state', undefined, path),
    timescaleNode(connection, 'timescale:diagnostics:compression', 'Compression', 'compression', 'Compression coverage and settings', undefined, path),
    timescaleNode(connection, 'timescale:diagnostics:retention', 'Retention', 'retention', 'Retention windows and policy status', undefined, path),
    timescaleNode(connection, 'timescale:diagnostics:continuous-aggregates', 'Refresh Lag', 'continuous-aggregates', 'Continuous aggregate freshness', undefined, path),
  ]
}

function timescaleHypertableSections(
  connection: ConnectionProfile,
  schema: string,
  table: string,
): ExplorerNode[] {
  const path = [connection.name, 'Hypertables', `${schema}.${table}`]
  return [
    timescaleNode(connection, `chunks:${schema}:${table}`, 'Chunks', 'chunks', 'Chunk ranges and compression state', undefined, path),
    timescaleNode(connection, `compression:${schema}:${table}`, 'Compression', 'compression', 'Compression settings and policy', undefined, path),
    timescaleNode(connection, `retention:${schema}:${table}`, 'Retention Policy', 'retention', 'Retention window and job status', undefined, path),
    timescaleNode(connection, `indexes:${schema}:${table}`, 'Indexes', 'indexes', 'Hypertable indexes', undefined, path),
    timescaleNode(connection, `statistics:${schema}:${table}`, 'Statistics', 'statistics', 'Rows, scans, and size', undefined, path),
  ]
}

function timescaleContinuousAggregateSections(
  connection: ConnectionProfile,
  schema: string,
  view: string,
): ExplorerNode[] {
  const path = [connection.name, 'Continuous Aggregates', `${schema}.${view}`]
  return [
    timescaleNode(connection, `continuous-aggregate:${schema}:${view}:definition`, 'Definition', 'ddl', 'Continuous aggregate definition', undefined, path),
    timescaleNode(connection, `continuous-aggregate:${schema}:${view}:refresh`, 'Refresh Policy', 'jobs', 'Refresh schedule and lag', undefined, path),
    timescaleNode(connection, `continuous-aggregate:${schema}:${view}:statistics`, 'Statistics', 'statistics', 'Rows, size, and freshness', undefined, path),
  ]
}

function timescaleTableSections(
  connection: ConnectionProfile,
  schema: string,
  table: string,
): ExplorerNode[] {
  const path = [connection.name, isPostgresSystemSchema(schema) ? 'System Schemas' : 'User Schemas', schema, 'Tables', table]
  return [
    timescaleNode(connection, `columns:${schema}:${table}`, 'Columns', 'columns', 'Column definitions', undefined, path),
    timescaleNode(connection, `indexes:${schema}:${table}`, 'Indexes', 'indexes', 'Table indexes', undefined, path),
    timescaleNode(connection, `constraints:${schema}:${table}`, 'Constraints', 'constraints', 'Table constraints', undefined, path),
    timescaleNode(connection, `statistics:${schema}:${table}`, 'Statistics', 'statistics', 'Row estimates and analyze health', undefined, path),
    timescaleNode(connection, `ddl:${schema}:${table}`, 'Definition', 'ddl', 'Object definition', undefined, path),
  ]
}

function timescaleNode(
  connection: ConnectionProfile,
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  path: string[] = [connection.name],
  expandable = false,
  queryTemplate?: string,
): ExplorerNode {
  return {
    id,
    family: 'sql',
    label,
    kind,
    detail,
    scope,
    path,
    queryTemplate,
    expandable,
  }
}
