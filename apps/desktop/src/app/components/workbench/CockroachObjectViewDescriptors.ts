export type CockroachObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, CockroachObjectViewDescriptor> = {
  database: descriptor('database', 'Open Database Overview', 'CockroachDB Database', 'Review schemas, table families, jobs, regions, and database-local privileges.', 'No database metadata is loaded', 'Refresh the database to collect visible CockroachDB metadata.'),
  databases: descriptor('databases', 'Open Databases', 'CockroachDB Databases', 'Review user and system database namespaces separately from cluster-level health surfaces.', 'No databases are visible', 'Refresh databases or check SHOW DATABASES privileges.'),
  'user-schemas': descriptor('user-schemas', 'Open User Schemas', 'User Schemas', 'Review user-created schemas and their tables, views, sequences, types, and functions.', 'No user schemas are visible', 'Refresh schemas or check information_schema access.'),
  'system-schemas': descriptor('system-schemas', 'Open System Schemas', 'System Schemas', 'Review crdb_internal, pg_catalog, information_schema, and system-owned metadata separately.', 'No system schemas are visible', 'System schemas may be hidden by the current metadata policy.'),
  schema: descriptor('schema', 'Open Schema Overview', 'CockroachDB Schema', 'Review object counts, grants, regional hints, and schema-local object entry points.', 'No schema metadata is loaded', 'Refresh this schema to collect visible metadata.'),
  tables: descriptor('tables', 'Open Tables', 'CockroachDB Tables', 'Review tables, row estimates, locality, primary indexes, and table-management entry points.', 'No tables were returned', 'The schema may not contain base tables, or metadata access may be limited.'),
  table: descriptor('table', 'Open Table', 'CockroachDB Table', 'Inspect columns, indexes, constraints, locality, ranges, statistics, grants, and a bounded data query.', 'No table metadata is loaded', 'Refresh this table to collect catalog metadata.', 'Open Data Query'),
  views: descriptor('views', 'Open Views', 'CockroachDB Views', 'Review stored SELECT definitions and open focused view workflows.', 'No views were returned', 'The schema may not contain views.'),
  view: descriptor('view', 'Open View Definition', 'CockroachDB View', 'Inspect definition, columns, dependencies, grants, and a sample-query action.', 'No view definition is loaded', 'Refresh this view to collect definition metadata.', 'Open View Query'),
  indexes: descriptor('indexes', 'Manage Indexes', 'CockroachDB Indexes', 'Review primary, secondary, inverted, partial, and unique indexes with locality and usage hints.', 'No indexes were returned', 'Refresh indexes or check catalog access.'),
  index: descriptor('index', 'Open Index', 'CockroachDB Index', 'Inspect columns, uniqueness, storing columns, locality, and relation usage hints.', 'No index metadata is loaded', 'Refresh this index to collect index metadata.'),
  constraints: descriptor('constraints', 'Open Constraints', 'CockroachDB Constraints', 'Review primary keys, foreign keys, unique constraints, checks, and validation state.', 'No constraints were returned', 'This object may not have constraints.'),
  functions: descriptor('functions', 'Open Functions', 'CockroachDB Functions', 'Review user-defined functions, arguments, return types, volatility, and language.', 'No functions were returned', 'The schema may not contain functions.'),
  function: descriptor('function', 'Manage Function', 'CockroachDB Function', 'Inspect function signature, source, ownership, dependencies, and guarded alter/drop previews.', 'No function metadata is loaded', 'Refresh this function to collect routine metadata.'),
  sequences: descriptor('sequences', 'Open Sequences', 'CockroachDB Sequences', 'Review sequence ownership, increment, min/max, cache, and cycling metadata.', 'No sequences were returned', 'The schema may not contain sequences.'),
  sequence: descriptor('sequence', 'Open Sequence', 'CockroachDB Sequence', 'Inspect sequence ownership, current options, and guarded alter/drop preview entry points.', 'No sequence metadata is loaded', 'Refresh this sequence to collect sequence metadata.'),
  types: descriptor('types', 'Open Types', 'CockroachDB Types', 'Review enum and user-defined type metadata.', 'No types were returned', 'The schema may not contain user-defined types.'),
  type: descriptor('type', 'Open Type', 'CockroachDB Type', 'Inspect type definition, labels, dependencies, and grants.', 'No type metadata is loaded', 'Refresh this type to collect type metadata.'),
  security: descriptor('security', 'Review Security', 'CockroachDB Security', 'Review roles, grants, default privileges, certificates, and permission-sensitive warnings.', 'No security metadata is loaded', 'Refresh security metadata or check SHOW GRANTS access.'),
  roles: descriptor('roles', 'Review Roles', 'CockroachDB Roles', 'Review users, roles, options, memberships, and login capabilities.', 'No roles were returned', 'Role metadata may be restricted.'),
  permissions: descriptor('permissions', 'Review Grants', 'CockroachDB Grants', 'Review database, schema, table, sequence, type, and function privileges.', 'No grants were returned', 'The current user may not be allowed to inspect grants.'),
  grants: descriptor('grants', 'Review Grants', 'CockroachDB Grants', 'Review granted privileges and default privilege surfaces.', 'No grants were returned', 'The current user may not be allowed to inspect grants.'),
  cluster: descriptor('cluster', 'Open Cluster Overview', 'CockroachDB Cluster', 'Review nodes, ranges, regions, jobs, contention, and cluster settings from one place.', 'No cluster metadata is loaded', 'Refresh the cluster view to collect available status metadata.'),
  nodes: descriptor('nodes', 'Review Nodes', 'CockroachDB Nodes', 'Review node liveness, locality, capacity, range counts, and SQL/KV health signals.', 'No nodes were returned', 'Node status may require cluster-observer privileges.'),
  node: descriptor('node', 'Open Node', 'CockroachDB Node', 'Inspect node locality, liveness, capacity, stores, and range distribution hints.', 'No node metadata is loaded', 'Refresh this node to collect status metadata.'),
  ranges: descriptor('ranges', 'Review Ranges', 'CockroachDB Ranges', 'Review range distribution, leaseholders, replicas, hotspots, and table span ownership.', 'No ranges were returned', 'Range metadata may require crdb_internal access.'),
  regions: descriptor('regions', 'Review Regions', 'CockroachDB Regions', 'Review regions, localities, survivability goals, and placement constraints.', 'No regions were returned', 'This cluster may not be multi-region or metadata may be restricted.'),
  localities: descriptor('localities', 'Review Localities', 'CockroachDB Localities', 'Review locality tiers and node placement across regions, zones, and racks.', 'No localities were returned', 'Refresh nodes or regions to collect locality metadata.'),
  jobs: descriptor('jobs', 'Review Jobs', 'CockroachDB Jobs', 'Review schema changes, backups, imports, restores, changefeeds, and other cluster jobs.', 'No jobs were returned', 'Job history may be empty or restricted.'),
  job: descriptor('job', 'Open Job', 'CockroachDB Job', 'Inspect job progress, status, timestamps, payload, and failure details where available.', 'No job metadata is loaded', 'Refresh this job to collect job metadata.'),
  contention: descriptor('contention', 'Review Contention', 'CockroachDB Contention', 'Review transaction contention, waiting keys, blocking transactions, and retry pressure.', 'No contention rows were returned', 'Contention details may require cluster settings or crdb_internal access.'),
  transactions: descriptor('transactions', 'Review Transactions', 'CockroachDB Transactions', 'Review transaction state, retry pressure, age, priority, and contention risk.', 'No transactions were returned', 'Transaction metadata may be restricted or currently empty.'),
  statements: descriptor('statements', 'Review Statements', 'CockroachDB Statement Stats', 'Review statement execution counts, latency, rows, retries, and plan health signals.', 'No statement stats were returned', 'Statement statistics may be reset or restricted.'),
  'cluster-settings': descriptor('cluster-settings', 'Review Cluster Settings', 'CockroachDB Cluster Settings', 'Review runtime settings, SQL/KV safety knobs, and visible cluster configuration.', 'No cluster settings were returned', 'Cluster settings may require elevated privileges.'),
  'zone-configurations': descriptor('zone-configurations', 'Review Zone Configurations', 'CockroachDB Zone Configurations', 'Review replication, constraints, lease preferences, and garbage-collection settings.', 'No zone configurations were returned', 'Zone config metadata may be restricted.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'CockroachDB Diagnostics', 'Review sessions, statement stats, transactions, contention, locks, and database statistics.', 'No diagnostics are loaded', 'Refresh diagnostics to collect available CockroachDB status metadata.'),
  sessions: descriptor('sessions', 'Review Sessions', 'CockroachDB Sessions', 'Review active sessions, transactions, statement state, and client metadata.', 'No sessions were returned', 'SHOW SESSIONS metadata may be restricted for this role.'),
  locks: descriptor('locks', 'Review Locks', 'CockroachDB Locks', 'Review lock holders, waiters, keys, and blocking risks where available.', 'No locks were returned', 'There may be no visible locks or lock inspection may be restricted.'),
  statistics: descriptor('statistics', 'Open Statistics', 'CockroachDB Statistics', 'Review table statistics, row estimates, bytes, ranges, and statement health signals.', 'No statistics were returned', 'Refresh statistics or check catalog access.'),
  ddl: descriptor('ddl', 'Open Definition', 'CockroachDB Definition', 'Review generated object definition SQL only when explicitly requested.', 'No definition is loaded', 'Definition extraction may require catalog access.'),
}

const DEFAULT_DESCRIPTOR: CockroachObjectViewDescriptor = descriptor(
  'object',
  'Inspect CockroachDB Object',
  'CockroachDB Object',
  'Review available CockroachDB catalog, status, and crdb_internal metadata for this object.',
  'CockroachDB metadata is not available',
  'Refresh this object or check whether the connected user can inspect it.',
)

export function getCockroachObjectViewDescriptor(kind: string | undefined): CockroachObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeCockroachObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function cockroachObjectViewMenuLabel(kind: string | undefined): string {
  return getCockroachObjectViewDescriptor(kind).menuLabel
}

export function isCockroachObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeCockroachObjectKind(kind)])
}

export const COCKROACH_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): CockroachObjectViewDescriptor {
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

function normalizeCockroachObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
