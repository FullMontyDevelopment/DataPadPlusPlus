export type WarehouseObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, WarehouseObjectViewDescriptor> = {
  databases: descriptor('databases', 'Browse Databases', 'Warehouse Databases', 'Review database namespaces, schemas, tables, views, stages, and access posture.', 'No databases are loaded', 'Refresh metadata or verify this warehouse connection can list databases.'),
  database: descriptor('database', 'Open Database', 'Warehouse Database', 'Inspect one database namespace with schemas, tables, views, jobs, and cost signals.', 'Database metadata is not loaded', 'Refresh this database or check metadata permissions.'),
  datasets: descriptor('datasets', 'Browse Datasets', 'Datasets', 'Review BigQuery-style datasets, tables, views, scheduled work, and IAM coverage.', 'No datasets are loaded', 'Refresh metadata or verify this project can list datasets.'),
  dataset: descriptor('dataset', 'Open Dataset', 'Dataset', 'Inspect one dataset with tables, views, jobs, partitions, and access controls.', 'Dataset metadata is not loaded', 'Refresh this dataset or check IAM access.'),
  schemas: descriptor('schemas', 'Browse Schemas', 'Warehouse Schemas', 'Review schema namespaces, object counts, ownership, and grants.', 'No schemas are loaded', 'Refresh metadata or verify schema visibility.'),
  schema: descriptor('schema', 'Open Schema', 'Warehouse Schema', 'Inspect one schema with tables, views, stages, tasks, and grants.', 'Schema metadata is not loaded', 'Refresh this schema or check role permissions.'),
  tables: descriptor('tables', 'Open Tables', 'Warehouse Tables', 'Review analytical tables, partitioning, clustering, storage, row counts, and cost hints.', 'No tables are loaded', 'Refresh table metadata or select a different namespace.'),
  table: descriptor('table', 'Open Table', 'Warehouse Table', 'Inspect columns, partitions, clustering, storage, freshness, grants, and query entry points for one table.', 'Table metadata is not loaded', 'Refresh this table or check table metadata permissions.', 'Query Table'),
  views: descriptor('views', 'Open Views', 'Warehouse Views', 'Review saved analytical projections, dependencies, refresh shape, and query entry points.', 'No views are loaded', 'Refresh view metadata or select a different namespace.'),
  view: descriptor('view', 'Open View', 'Warehouse View', 'Inspect view definition metadata, dependencies, columns, grants, and safe query entry points.', 'View metadata is not loaded', 'Refresh this view or check metadata permissions.', 'Query View'),
  'materialized-views': descriptor('materialized-views', 'Open Materialized Views', 'Materialized Views', 'Review persisted projections, freshness, storage, refresh status, and cost signals.', 'No materialized views are loaded', 'Refresh metadata or verify support for materialized views.'),
  'materialized-view': descriptor('materialized-view', 'Open Materialized View', 'Materialized View', 'Inspect one materialized view with refresh state, dependencies, storage, and query entry points.', 'Materialized view metadata is not loaded', 'Refresh this materialized view.', 'Query Materialized View'),
  stages: descriptor('stages', 'Browse Stages', 'Stages', 'Review internal and external stages, file formats, encryption, and load readiness.', 'No stages are loaded', 'Refresh stages or verify stage visibility.'),
  stage: descriptor('stage', 'Open Stage', 'Stage', 'Inspect one stage, storage integration, file format, recent load signals, and guarded import/export workflows.', 'Stage metadata is not loaded', 'Refresh this stage.'),
  warehouses: descriptor('warehouses', 'Manage Warehouses', 'Compute Warehouses', 'Review compute warehouses, size, scaling policy, state, utilization, and cost posture.', 'No compute warehouses are loaded', 'Refresh compute metadata or check account permissions.'),
  warehouse: descriptor('warehouse', 'Open Warehouse', 'Compute Warehouse', 'Inspect one compute warehouse with utilization, queueing, credits, and scaling settings.', 'Warehouse metadata is not loaded', 'Refresh this warehouse or check monitor privileges.'),
  jobs: descriptor('jobs', 'Review Jobs', 'Warehouse Jobs', 'Review query history, scheduled work, load jobs, failures, bytes scanned, and runtime trends.', 'No jobs are loaded', 'Refresh jobs or widen the metadata time window.'),
  job: descriptor('job', 'Open Job', 'Warehouse Job', 'Inspect one warehouse job with status, duration, scanned data, billed cost, and diagnostics.', 'Job metadata is not loaded', 'Refresh this job.'),
  tasks: descriptor('tasks', 'Review Tasks', 'Tasks', 'Review scheduled queries, tasks, dependencies, owners, and last run status.', 'No tasks are loaded', 'Refresh task metadata.'),
  task: descriptor('task', 'Open Task', 'Task', 'Inspect one scheduled task with schedule, owner, last run, and guarded management actions.', 'Task metadata is not loaded', 'Refresh this task.'),
  security: descriptor('security', 'Review Access', 'Warehouse Security', 'Review roles, grants, IAM bindings, policies, and permission warnings.', 'No access metadata is loaded', 'Refresh security metadata or check role permissions.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'Warehouse Diagnostics', 'Review bytes scanned, queued work, failed jobs, storage growth, and cost/performance warnings.', 'No diagnostics are loaded', 'Refresh diagnostics metadata.'),
}

const DEFAULT_DESCRIPTOR = descriptor(
  'object',
  'Inspect Warehouse Object',
  'Warehouse Object',
  'Review available warehouse metadata for this object.',
  'Warehouse metadata is not available',
  'Refresh this object or check whether the connection can inspect it.',
)

export function getWarehouseObjectViewDescriptor(kind: string | undefined): WarehouseObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeWarehouseObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function warehouseObjectViewMenuLabel(kind: string | undefined): string {
  return getWarehouseObjectViewDescriptor(kind).menuLabel
}

export function isWarehouseObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeWarehouseObjectKind(kind)])
}

export const WAREHOUSE_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): WarehouseObjectViewDescriptor {
  return {
    kind,
    menuLabel,
    title,
    purpose,
    emptyTitle,
    emptyDescription,
    primaryQueryLabel,
  }
}

function normalizeWarehouseObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
