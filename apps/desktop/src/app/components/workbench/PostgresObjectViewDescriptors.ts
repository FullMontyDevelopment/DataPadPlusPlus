export type PostgresObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, PostgresObjectViewDescriptor> = {
  database: descriptor('database', 'Open Database Overview', 'PostgreSQL Database', 'Review database-level schemas, extensions, roles, sessions, locks, and storage signals.', 'No database metadata is loaded', 'Refresh the database view to collect visible PostgreSQL metadata.'),
  'user-schemas': descriptor('user-schemas', 'Open User Schemas', 'User Schemas', 'Review user-created schemas and their table, view, routine, and security surfaces.', 'No user schemas are visible', 'Refresh schemas or check information_schema access.'),
  'system-schemas': descriptor('system-schemas', 'Open System Schemas', 'System Schemas', 'Review pg_catalog, information_schema, and extension-owned schema metadata separately from user objects.', 'No system schemas are visible', 'System schemas may be hidden by the current connection policy.'),
  schema: descriptor('schema', 'Open Schema Overview', 'PostgreSQL Schema', 'Review object counts, extensions, routines, grants, and schema-local object entry points.', 'No schema metadata is loaded', 'Refresh this schema to collect visible metadata.'),
  tables: descriptor('tables', 'Open Tables', 'PostgreSQL Tables', 'Review base tables, partitioned tables, row estimates, ownership, and table-management entry points.', 'No tables were returned', 'The schema may not contain base tables, or metadata access may be limited.'),
  table: descriptor('table', 'Open Table', 'PostgreSQL Table', 'Inspect table columns, indexes, constraints, triggers, statistics, grants, and a bounded data-query entry point.', 'No table metadata is loaded', 'Refresh this table to collect catalog metadata.', 'Open Data Query'),
  hypertables: descriptor('hypertables', 'Open Hypertables', 'Timescale Hypertables', 'Review hypertables, chunks, compression coverage, retention windows, and policy entry points.', 'No hypertables were returned', 'Refresh TimescaleDB metadata or check extension catalog access.'),
  hypertable: descriptor('hypertable', 'Open Hypertable', 'Timescale Hypertable', 'Inspect hypertable chunks, time dimensions, compression state, indexes, and statistics.', 'No hypertable metadata is loaded', 'Refresh this hypertable or check TimescaleDB metadata access.', 'Open Data Query'),
  chunks: descriptor('chunks', 'Review Chunks', 'Timescale Chunks', 'Review chunk ranges, size, compression state, and time-window distribution.', 'No chunks were returned', 'Refresh chunk metadata or check TimescaleDB catalog access.'),
  compression: descriptor('compression', 'Manage Compression', 'Timescale Compression', 'Review compression settings, coverage, and guarded compression-policy previews.', 'No compression metadata was returned', 'Refresh compression metadata or check policy visibility.'),
  retention: descriptor('retention', 'Manage Retention', 'Timescale Retention', 'Review retention windows, policy jobs, and guarded retention-policy previews.', 'No retention metadata was returned', 'Refresh retention metadata or check job visibility.'),
  'continuous-aggregates': descriptor('continuous-aggregates', 'Open Continuous Aggregates', 'Continuous Aggregates', 'Review time-bucket materializations, refresh lag, and refresh-policy entry points.', 'No continuous aggregates were returned', 'Refresh continuous aggregate metadata or check view access.'),
  'continuous-aggregate': descriptor('continuous-aggregate', 'Open Continuous Aggregate', 'Continuous Aggregate', 'Inspect the continuous aggregate definition, refresh status, dependencies, and query action.', 'No continuous aggregate metadata is loaded', 'Refresh this continuous aggregate to collect metadata.', 'Open Data Query'),
  jobs: descriptor('jobs', 'Review Jobs', 'Timescale Jobs', 'Review compression, retention, and continuous aggregate refresh jobs.', 'No Timescale jobs were returned', 'Refresh jobs or check timescaledb_information.jobs access.'),
  views: descriptor('views', 'Open Views', 'PostgreSQL Views', 'Review stored SELECT definitions and open focused view definition workflows.', 'No views were returned', 'The schema may not contain views.'),
  view: descriptor('view', 'Open View Definition', 'PostgreSQL View', 'Inspect the view definition, columns, dependencies, grants, and bounded query action.', 'No view definition is loaded', 'Refresh this view to collect definition metadata.', 'Open View Query'),
  'materialized-views': descriptor('materialized-views', 'Open Materialized Views', 'Materialized Views', 'Review persisted query projections, refresh state, indexes, and maintenance actions.', 'No materialized views were returned', 'The schema may not contain materialized views.'),
  'materialized-view': descriptor('materialized-view', 'Open Materialized View', 'Materialized View', 'Inspect definition, refresh status, indexes, storage, grants, and bounded query action.', 'No materialized view metadata is loaded', 'Refresh this materialized view to collect metadata.', 'Open Data Query'),
  indexes: descriptor('indexes', 'Manage Indexes', 'PostgreSQL Indexes', 'Review index definitions, uniqueness, validity, access methods, size, and maintenance preview entry points.', 'No indexes were returned', 'Refresh indexes or check pg_catalog access.'),
  index: descriptor('index', 'Open Index', 'PostgreSQL Index', 'Inspect index columns, definition, uniqueness, validity, size, and relation usage hints.', 'No index metadata is loaded', 'Refresh this index to collect pg_index metadata.'),
  constraints: descriptor('constraints', 'Open Constraints', 'PostgreSQL Constraints', 'Review primary keys, foreign keys, unique constraints, checks, and exclusion constraints.', 'No constraints were returned', 'This object may not have constraints.'),
  'foreign-keys': descriptor('foreign-keys', 'Open Foreign Keys', 'PostgreSQL Foreign Keys', 'Review referenced tables, columns, update/delete actions, and relationship entry points.', 'No foreign keys were returned', 'This table may not reference another visible table.'),
  triggers: descriptor('triggers', 'Open Triggers', 'PostgreSQL Triggers', 'Review trigger timing, events, enabled state, and function targets.', 'No triggers were returned', 'This object may not have triggers.'),
  functions: descriptor('functions', 'Open Functions', 'PostgreSQL Functions', 'Review functions, arguments, return types, volatility, and security mode.', 'No functions were returned', 'The schema may not contain functions.'),
  function: descriptor('function', 'Manage Function', 'PostgreSQL Function', 'Inspect function signature, source, volatility, ownership, grants, and guarded alter/drop previews.', 'No function metadata is loaded', 'Refresh this function to collect routine metadata.'),
  procedures: descriptor('procedures', 'Open Procedures', 'PostgreSQL Procedures', 'Review stored procedures, arguments, language, and execution templates.', 'No procedures were returned', 'The schema may not contain procedures.'),
  procedure: descriptor('procedure', 'Manage Procedure', 'PostgreSQL Procedure', 'Inspect procedure signature, source, ownership, dependencies, and guarded alter/drop previews.', 'No procedure metadata is loaded', 'Refresh this procedure to collect routine metadata.'),
  sequences: descriptor('sequences', 'Open Sequences', 'PostgreSQL Sequences', 'Review sequence ownership, increment, min/max, cache, and cycling metadata.', 'No sequences were returned', 'The schema may not contain sequences.'),
  types: descriptor('types', 'Open Types', 'PostgreSQL Types', 'Review enum, composite, domain, range, and extension-owned type metadata.', 'No types were returned', 'The schema may not contain user-defined types.'),
  extensions: descriptor('extensions', 'Manage Extensions', 'PostgreSQL Extensions', 'Review installed extensions, versions, schemas, and upgrade availability hints.', 'No extensions were returned', 'Refresh extensions or check pg_extension access.'),
  security: descriptor('security', 'Review Security', 'PostgreSQL Security', 'Review roles, grants, ownership, row-level security, and permission-sensitive warnings.', 'No security metadata is loaded', 'Refresh security metadata or check catalog access.'),
  roles: descriptor('roles', 'Review Roles', 'PostgreSQL Roles', 'Review login roles, inheritance, replication/superuser flags, and membership hints.', 'No roles were returned', 'Role metadata may be restricted.'),
  permissions: descriptor('permissions', 'Review Permissions', 'PostgreSQL Permissions', 'Review table, schema, function, and sequence grants for the selected scope.', 'No permissions were returned', 'The current user may not be allowed to inspect grants.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'PostgreSQL Diagnostics', 'Review sessions, locks, wait events, database stats, cache/IO, and query-performance surfaces.', 'No diagnostics are loaded', 'Refresh diagnostics to collect available pg_stat metadata.'),
  sessions: descriptor('sessions', 'Review Sessions', 'PostgreSQL Sessions', 'Review pg_stat_activity sessions, wait events, state, and blocking hints.', 'No sessions were returned', 'pg_stat_activity may be restricted for this role.'),
  locks: descriptor('locks', 'Review Locks', 'PostgreSQL Locks', 'Review lock modes, granted state, relations, and blocking risk.', 'No locks were returned', 'There may be no visible locks or pg_locks access may be restricted.'),
  waits: descriptor('waits', 'Review Wait Events', 'PostgreSQL Wait Events', 'Review wait event categories and pressure from visible pg_stat_activity rows.', 'No wait events were returned', 'The workload may be idle or wait metadata may be restricted.'),
  statements: descriptor('statements', 'Review Statement Stats', 'PostgreSQL Statement Stats', 'Review pg_stat_statements query fingerprints, latency, rows, and call counts where available.', 'No statement stats were returned', 'pg_stat_statements may not be installed or visible to this role.'),
  statistics: descriptor('statistics', 'Open Statistics', 'PostgreSQL Statistics', 'Review row estimates, relation sizes, vacuum/analyze timestamps, scans, tuples, and cache signals.', 'No statistics were returned', 'Refresh statistics or check pg_stat access.'),
  'index-health': descriptor('index-health', 'Review Index Health', 'PostgreSQL Index Health', 'Review index usage, low-scan candidates, tuple reads, and maintenance signals.', 'No index-health rows were returned', 'Refresh index health or check pg_stat_user_indexes access.'),
  ddl: descriptor('ddl', 'Open Definition', 'PostgreSQL Definition', 'Review generated object definition SQL only when explicitly requested.', 'No definition is loaded', 'Definition extraction may require catalog access.'),
}

const DEFAULT_DESCRIPTOR: PostgresObjectViewDescriptor = descriptor(
  'object',
  'Inspect PostgreSQL Object',
  'PostgreSQL Object',
  'Review available PostgreSQL catalog metadata for this object.',
  'PostgreSQL metadata is not available',
  'Refresh this object or check whether the connected user can inspect it.',
)

export function getPostgresObjectViewDescriptor(kind: string | undefined): PostgresObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizePostgresObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function postgresObjectViewMenuLabel(kind: string | undefined): string {
  return getPostgresObjectViewDescriptor(kind).menuLabel
}

export function isPostgresObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizePostgresObjectKind(kind)])
}

export const POSTGRES_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): PostgresObjectViewDescriptor {
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

function normalizePostgresObjectKind(kind: string) {
  const normalized = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')

  if (normalized === 'statement-stats' || normalized === 'statement-statistics') {
    return 'statements'
  }

  if (normalized === 'wait-events') {
    return 'waits'
  }

  return normalized
}
