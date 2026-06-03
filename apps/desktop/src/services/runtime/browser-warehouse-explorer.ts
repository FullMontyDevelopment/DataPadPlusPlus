import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import { clickHouseWarehousePayload } from './browser-clickhouse-payloads'
import { cloudWarehousePayload } from './browser-cloud-warehouse-payloads'

export function createWarehouseExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const namespace = warehouseDefaultNamespace(connection)
  const namespaceRoot = warehouseNamespaceRoot(connection)

  if (!scope) {
    return [
      warehouseNode({ id: `warehouse:${namespaceRoot.kind}`, label: namespaceRoot.label, kind: namespaceRoot.kind, detail: namespaceRoot.detail, scope: `warehouse:${namespaceRoot.kind}`, expandable: true }),
      warehouseNode({ id: 'warehouse:tables', label: 'Tables', kind: 'tables', detail: 'Columnar tables and partitions', scope: 'warehouse:tables', expandable: true }),
      warehouseNode({ id: 'warehouse:views', label: 'Views', kind: 'views', detail: 'Saved analytical projections', scope: 'warehouse:views', expandable: true }),
      warehouseNode({ id: 'warehouse:warehouses', label: warehouseComputeLabel(connection), kind: 'warehouses', detail: warehouseComputeDetail(connection), scope: 'warehouse:warehouses', expandable: true }),
      warehouseNode({ id: 'warehouse:jobs', label: warehouseJobsLabel(connection), kind: 'jobs', detail: 'Query history, scheduled work, and load jobs', scope: 'warehouse:jobs', expandable: true }),
      warehouseNode({ id: 'warehouse:security', label: 'Security', kind: 'security', detail: warehouseSecurityDetail(connection), scope: 'warehouse:security' }),
      warehouseNode({ id: 'warehouse:diagnostics', label: 'Diagnostics', kind: 'diagnostics', detail: 'Cost, runtime, queueing, and storage health', scope: 'warehouse:diagnostics' }),
    ]
  }

  if (scope === 'warehouse:databases' || scope === 'warehouse:datasets') {
    return warehouseNamespaces(connection).map((item) =>
      warehouseNode({
        id: `${namespaceRoot.singleKind}:${item.name}`,
        label: item.name,
        kind: namespaceRoot.singleKind,
        detail: `${item.tables} tables | ${warehouseNamespaceLocation(item) ?? item.owner}`,
        path: [namespaceRoot.label],
        scope: `${namespaceRoot.singleKind}:${item.name}`,
        expandable: true,
      }),
    )
  }

  if (isWarehouseNamespaceScope(scope)) {
    return [
      warehouseNode({ id: `tables:${namespace}`, label: 'Tables', kind: 'tables', detail: 'Tables in this namespace', path: [namespace], scope: 'warehouse:tables', expandable: true }),
      warehouseNode({ id: `views:${namespace}`, label: 'Views', kind: 'views', detail: 'Views in this namespace', path: [namespace], scope: 'warehouse:views', expandable: true }),
      warehouseNode({ id: `materialized-views:${namespace}`, label: 'Materialized Views', kind: 'materialized-views', detail: 'Persisted analytical views', path: [namespace], scope: 'warehouse:materialized-views', expandable: true }),
      warehouseNode({ id: `stages:${namespace}`, label: warehouseStageLabel(connection), kind: 'stages', detail: 'Load and unload locations', path: [namespace], scope: 'warehouse:stages', expandable: true }),
      warehouseNode({ id: `jobs:${namespace}`, label: warehouseJobsLabel(connection), kind: 'jobs', detail: 'Recent jobs and scheduled work', path: [namespace], scope: 'warehouse:jobs', expandable: true }),
    ]
  }

  if (scope === 'warehouse:tables') {
    return warehouseTables(connection).map((table) =>
      warehouseNode({
        id: `table:${table.schema}:${table.name}`,
        label: table.name,
        kind: 'table',
        detail: `${table.rows} rows | ${table.size} | ${table.partitioning}`,
        path: [table.schema],
        scope: `table:${table.schema}:${table.name}`,
        queryTemplate: warehouseObjectQueryTemplate(connection, table.schema, table.name),
      }),
    )
  }

  if (scope === 'warehouse:views') {
    return warehouseViews().map((view) =>
      warehouseNode({
        id: `view:${view.schema}:${view.name}`,
        label: view.name,
        kind: 'view',
        detail: `${view.dependencies} dependencies | stale ${view.stale}`,
        path: [view.schema],
        scope: `view:${view.schema}:${view.name}`,
        queryTemplate: warehouseObjectQueryTemplate(connection, view.schema, view.name),
      }),
    )
  }

  if (scope === 'warehouse:materialized-views') {
    return warehouseMaterializedViews().map((view) =>
      warehouseNode({
        id: `materialized-view:${view.schema}:${view.name}`,
        label: view.name,
        kind: 'materialized-view',
        detail: `${view.refreshStatus} | ${view.size}`,
        path: [view.schema],
        scope: `materialized-view:${view.schema}:${view.name}`,
        queryTemplate: warehouseObjectQueryTemplate(connection, view.schema, view.name),
      }),
    )
  }

  if (scope === 'warehouse:stages') {
    return warehouseStages(connection).map((stage) =>
      warehouseNode({ id: `stage:${stage.name}`, label: stage.name, kind: 'stage', detail: `${stage.type} | ${stage.fileFormat}`, path: ['Stages'], scope: `stage:${stage.name}` }),
    )
  }

  if (scope === 'warehouse:warehouses') {
    return warehouseCompute(connection).map((item) =>
      warehouseNode({ id: `warehouse-compute:${item.name}`, label: item.name, kind: 'warehouse', detail: `${item.size} | ${item.state} | ${item.credits} credits`, path: [warehouseComputeLabel(connection)], scope: `warehouse-compute:${item.name}` }),
    )
  }

  if (scope === 'warehouse:jobs') {
    return warehouseJobs(connection).map((job) =>
      warehouseNode({ id: `job:${job.id}`, label: job.id, kind: 'job', detail: `${job.status} | ${job.duration} | ${job.bytesScanned}`, path: [warehouseJobsLabel(connection)], scope: `job:${job.id}` }),
    )
  }

  return []
}

export function warehouseInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  if (nodeId.startsWith('table:') || nodeId.startsWith('view:') || nodeId.startsWith('materialized-view:')) {
    const [, schema = warehouseDefaultNamespace(connection), objectName = 'table_name'] = nodeId.split(':')
    return warehouseObjectQueryTemplate(connection, schema, objectName)
  }

  if (nodeId.startsWith('job:')) {
    return warehouseJobQueryTemplate(connection, nodeId.replace('job:', ''))
  }

  return warehouseDiagnosticsQueryTemplate(connection)
}

export function warehouseInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const base = warehouseBasePayload(connection)

  if (nodeId === 'warehouse:databases' || nodeId === 'warehouse:datasets' || isWarehouseNamespaceScope(nodeId)) {
    return {
      ...base,
      objectView: connection.engine === 'bigquery' ? 'datasets' : 'databases',
      databases: connection.engine === 'bigquery' ? [] : warehouseNamespaces(connection),
      datasets: connection.engine === 'bigquery' ? warehouseNamespaces(connection) : [],
      tables: warehouseTables(connection),
      views: warehouseViews(),
      warehouses: warehouseCompute(connection),
      jobs: warehouseJobs(connection),
      diagnostics: warehouseDiagnostics(connection),
    }
  }

  if (nodeId === 'warehouse:tables' || nodeId.startsWith('table:')) {
    const table = nodeId.startsWith('table:') ? nodeId.split(':').at(-1) : undefined
    return {
      ...base,
      objectView: table ? 'table' : 'tables',
      tables: warehouseTables(connection).filter((row) => !table || row.name === table),
      columns: warehouseColumns(),
      security: warehouseSecurity(connection),
      diagnostics: warehouseDiagnostics(connection),
    }
  }

  if (nodeId === 'warehouse:views' || nodeId.startsWith('view:')) {
    const view = nodeId.startsWith('view:') ? nodeId.split(':').at(-1) : undefined
    return {
      ...base,
      objectView: view ? 'view' : 'views',
      views: warehouseViews().filter((row) => !view || row.name === view),
      columns: warehouseColumns(),
      security: warehouseSecurity(connection),
      diagnostics: warehouseDiagnostics(connection),
    }
  }

  if (nodeId === 'warehouse:materialized-views' || nodeId.startsWith('materialized-view:')) {
    const view = nodeId.startsWith('materialized-view:') ? nodeId.split(':').at(-1) : undefined
    return {
      ...base,
      objectView: view ? 'materialized-view' : 'materialized-views',
      materializedViews: warehouseMaterializedViews().filter((row) => !view || row.name === view),
      columns: warehouseColumns(),
      diagnostics: warehouseDiagnostics(connection),
    }
  }

  if (nodeId === 'warehouse:stages' || nodeId.startsWith('stage:')) {
    const stage = nodeId.startsWith('stage:') ? nodeId.replace('stage:', '') : undefined
    return { ...base, objectView: stage ? 'stage' : 'stages', stages: warehouseStages(connection).filter((row) => !stage || row.name === stage), jobs: warehouseJobs(connection), diagnostics: warehouseDiagnostics(connection) }
  }

  if (nodeId === 'warehouse:warehouses' || nodeId.startsWith('warehouse-compute:')) {
    const warehouse = nodeId.startsWith('warehouse-compute:') ? nodeId.replace('warehouse-compute:', '') : undefined
    return { ...base, objectView: warehouse ? 'warehouse' : 'warehouses', warehouses: warehouseCompute(connection).filter((row) => !warehouse || row.name === warehouse), jobs: warehouseJobs(connection), diagnostics: warehouseDiagnostics(connection) }
  }

  if (nodeId === 'warehouse:jobs' || nodeId.startsWith('job:')) {
    const job = nodeId.startsWith('job:') ? nodeId.replace('job:', '') : undefined
    return { ...base, objectView: job ? 'job' : 'jobs', jobs: warehouseJobs(connection).filter((row) => !job || row.id === job), diagnostics: warehouseDiagnostics(connection) }
  }

  if (nodeId === 'warehouse:security') {
    return {
      ...base,
      objectView: 'security',
      security: warehouseSecurity(connection),
      permissionWarnings: [{ scope: 'security', reason: 'Access metadata depends on the active warehouse role or IAM principal.' }],
    }
  }

  return { ...base, objectView: 'diagnostics', diagnostics: warehouseDiagnostics(connection), jobs: warehouseJobs(connection), warehouses: warehouseCompute(connection) }
}

function warehouseNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return { family: 'warehouse', ...node }
}

function warehouseNamespaceRoot(connection: ConnectionProfile) {
  return connection.engine === 'bigquery'
    ? { label: 'Datasets', kind: 'datasets', singleKind: 'dataset', detail: 'BigQuery datasets and access controls' }
    : { label: 'Databases', kind: 'databases', singleKind: 'database', detail: 'Warehouse database namespaces' }
}

function isWarehouseNamespaceScope(scope: string) {
  return scope.startsWith('database:') || scope.startsWith('dataset:')
}

function warehouseDefaultNamespace(connection: ConnectionProfile) {
  return connection.database?.trim() || (connection.engine === 'bigquery' ? 'analytics' : 'DATAPAD')
}

function warehouseComputeLabel(connection: ConnectionProfile) {
  return connection.engine === 'bigquery' ? 'Reservations' : connection.engine === 'clickhouse' ? 'Clusters' : 'Warehouses'
}

function warehouseComputeDetail(connection: ConnectionProfile) {
  return connection.engine === 'bigquery' ? 'Slots, reservations, and assignments' : connection.engine === 'clickhouse' ? 'Cluster nodes and shards' : 'Compute warehouses'
}

function warehouseJobsLabel(connection: ConnectionProfile) {
  return connection.engine === 'snowflake' ? 'Tasks & Query History' : 'Jobs'
}

function warehouseStageLabel(connection: ConnectionProfile) {
  return connection.engine === 'bigquery' ? 'External Tables' : 'Stages'
}

function warehouseSecurityDetail(connection: ConnectionProfile) {
  return connection.engine === 'bigquery' ? 'IAM bindings and dataset access' : 'Roles, grants, policies, and permissions'
}

function warehouseObjectQueryTemplate(connection: ConnectionProfile, schema: string, objectName: string) {
  const objectPath =
    connection.engine === 'bigquery'
      ? `\`${schema}.${objectName}\``
      : connection.engine === 'snowflake'
        ? `${quoteWarehouseIdentifier(schema)}.${quoteWarehouseIdentifier(objectName)}`
        : connection.engine === 'clickhouse'
          ? `\`${schema}\`.\`${objectName}\``
          : `${schema}.${objectName}`

  return `select * from ${objectPath} limit 100;`
}

function warehouseJobQueryTemplate(connection: ConnectionProfile, jobId: string) {
  if (connection.engine === 'bigquery') {
    return `select * from \`region-us\`.INFORMATION_SCHEMA.JOBS_BY_PROJECT where job_id = '${jobId}' limit 100;`
  }
  if (connection.engine === 'snowflake') {
    return `select * from table(information_schema.query_history()) where query_id = '${jobId}' limit 100;`
  }
  return `select * from system.query_log where query_id = '${jobId}' limit 100;`
}

function warehouseDiagnosticsQueryTemplate(connection: ConnectionProfile) {
  if (connection.engine === 'bigquery') {
    return 'select * from `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT order by creation_time desc limit 100;'
  }
  if (connection.engine === 'snowflake') {
    return 'select * from table(information_schema.query_history()) order by start_time desc limit 100;'
  }
  return 'select * from system.query_log order by event_time desc limit 100;'
}

function quoteWarehouseIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

function warehouseBasePayload(connection: ConnectionProfile) {
  return {
    engine: connection.engine,
    database: warehouseDefaultNamespace(connection),
    tableCount: warehouseTables(connection).length,
    viewCount: warehouseViews().length,
    jobCount: warehouseJobs(connection).length,
    failedJobCount: warehouseJobs(connection).filter((job) => job.status !== 'succeeded').length,
    bytesScanned: '1.8 TB',
    storageSize: '420 GB',
    ...cloudWarehousePayload(connection),
    ...clickHouseWarehousePayload(connection),
  }
}

function warehouseNamespaces(connection: ConnectionProfile) {
  const name = warehouseDefaultNamespace(connection)
  if (connection.engine === 'bigquery') {
    return [
      { name, location: 'US', tables: 4, views: 2, defaultTtl: 'none', owner: 'analytics-team' },
      { name: 'finance', location: 'EU', tables: 9, views: 3, defaultTtl: '90 days', owner: 'finance-ops' },
    ]
  }

  return [
    { name, schemas: 2, tables: 6, owner: 'ACCOUNTADMIN', retention: '1 day', region: connection.engine === 'snowflake' ? 'AWS us-east-1' : 'cluster-local' },
  ]
}

function warehouseNamespaceLocation(namespace: ReturnType<typeof warehouseNamespaces>[number]) {
  return 'location' in namespace ? namespace.location : namespace.region
}

function warehouseTables(connection: ConnectionProfile) {
  const schema = warehouseDefaultNamespace(connection)
  return [
    { name: 'orders', schema, rows: '12.4 M', size: '88 GB', partitioning: connection.engine === 'bigquery' ? 'DATE(order_date)' : 'order_date', clustering: 'customer_id, sku', freshness: '8 min ago' },
    { name: 'accounts', schema, rows: '84 K', size: '640 MB', partitioning: 'none', clustering: 'region', freshness: '12 min ago' },
    { name: 'products', schema, rows: '3.2 K', size: '42 MB', partitioning: 'none', clustering: 'category', freshness: '1 h ago' },
  ]
}

function warehouseViews() {
  return [
    { name: 'daily_revenue', schema: 'analytics', owner: 'analytics-team', dependencies: 'orders, products', stale: 'no' },
    { name: 'active_accounts', schema: 'analytics', owner: 'analytics-team', dependencies: 'accounts', stale: 'no' },
  ]
}

function warehouseMaterializedViews() {
  return [
    { name: 'revenue_by_sku_mv', schema: 'analytics', refreshStatus: 'fresh', lastRefresh: '15 min ago', size: '2.4 GB' },
  ]
}

function warehouseColumns() {
  return [
    { name: 'id', type: 'STRING', mode: 'required', nullable: 'no', description: 'Stable business key' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'nullable', nullable: 'yes', description: 'Event creation time' },
    { name: 'amount', type: 'NUMERIC', mode: 'nullable', nullable: 'yes', description: 'Order or revenue amount' },
  ]
}

function warehouseStages(connection: ConnectionProfile) {
  if (connection.engine === 'bigquery') {
    return [{ name: 'external_sales_csv', type: 'external table', url: 'Configured Cloud Storage source', fileFormat: 'CSV', encryption: 'Google-managed', owner: 'analytics-team' }]
  }
  return [
    { name: 'raw_import_stage', type: 'external', url: 'Configured object storage source', fileFormat: 'CSV', encryption: 'SSE-KMS', owner: 'loader' },
    { name: 'export_stage', type: 'internal', url: '@export_stage', fileFormat: 'PARQUET', encryption: 'managed', owner: 'analytics-team' },
  ]
}

function warehouseCompute(connection: ConnectionProfile) {
  if (connection.engine === 'bigquery') {
    return [{ name: 'default-reservation', size: '500 slots', state: 'active', queued: 0, running: 3, credits: 'slot-based' }]
  }
  if (connection.engine === 'clickhouse') {
    return [{ name: 'default-cluster', size: '3 shards', state: 'healthy', queued: 0, running: 5, credits: 'n/a' }]
  }
  return [
    { name: 'ANALYTICS_XS', size: 'X-Small', state: 'running', queued: 0, running: 4, credits: '0.24' },
    { name: 'LOAD_WH', size: 'Small', state: 'suspended', queued: 0, running: 0, credits: '0.00' },
  ]
}

function warehouseJobs(connection: ConnectionProfile) {
  const suffix = connection.engine === 'bigquery' ? 'bq' : connection.engine === 'snowflake' ? 'sf' : 'ch'
  return [
    { id: `${suffix}-job-1001`, type: 'query', status: 'succeeded', duration: '1.8s', bytesScanned: '128 MB', cost: connection.engine === 'bigquery' ? '$0.001' : 'low' },
    { id: `${suffix}-job-1002`, type: 'load', status: 'succeeded', duration: '12s', bytesScanned: '3.4 GB', cost: 'medium' },
    { id: `${suffix}-job-1003`, type: 'query', status: 'failed', duration: '480 ms', bytesScanned: '0 B', cost: 'none' },
  ]
}

function warehouseSecurity(connection: ConnectionProfile) {
  if (connection.engine === 'bigquery') {
    return [
      { principal: 'group:analytics@example.com', role: 'roles/bigquery.dataViewer', privilege: 'read', object: warehouseDefaultNamespace(connection), effect: 'allow' },
      { principal: 'serviceAccount:loader@example.com', role: 'roles/bigquery.jobUser', privilege: 'jobs.create', object: 'project', effect: 'allow' },
    ]
  }

  return [
    { principal: 'ANALYST_ROLE', role: 'reader', privilege: 'SELECT', object: warehouseDefaultNamespace(connection), effect: 'allow' },
    { principal: 'LOAD_ROLE', role: 'loader', privilege: 'INSERT', object: 'raw_import_stage', effect: 'guarded' },
  ]
}

function warehouseDiagnostics(connection: ConnectionProfile) {
  return [
    { signal: 'Broad Scan Risk', value: 'watch', status: 'watch', guidance: 'Dry-run broad queries before executing them against large warehouse tables.' },
    { signal: connection.engine === 'bigquery' ? 'Slot Pressure' : 'Queue Pressure', value: 'low', status: 'healthy', guidance: 'No simulated queue pressure detected.' },
    { signal: 'Failed Jobs', value: warehouseJobs(connection).filter((job) => job.status === 'failed').length, status: 'watch', guidance: 'Review recent failures before scheduling dependent work.' },
  ]
}
