export type MysqlObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

type MysqlFamilyEngine = 'mysql' | 'mariadb'

const DESCRIPTORS: Record<string, MysqlObjectViewDescriptor> = {
  databases: descriptor('databases', 'Open Databases', 'MySQL Databases', 'Review user databases separately from system schemas and server-level surfaces.', 'No databases are visible', 'Refresh databases or verify the account can inspect information_schema.'),
  database: descriptor('database', 'Open Database Overview', 'MySQL Database', 'Review tables, views, routines, events, triggers, indexes, privileges, and storage signals for this database.', 'No database metadata is loaded', 'Refresh this database to collect visible MySQL metadata.'),
  'system-schemas': descriptor('system-schemas', 'Open System Schemas', 'System Schemas', 'Review information_schema, mysql, performance_schema, and sys away from user objects.', 'No system schemas are visible', 'System schemas may be hidden by the current metadata policy.'),
  tables: descriptor('tables', 'Open Tables', 'MySQL Tables', 'Review base tables, row estimates, storage engine, collation, and table-management entry points.', 'No tables were returned', 'The database may not contain user tables.'),
  table: descriptor('table', 'Open Table', 'MySQL Table', 'Inspect columns, indexes, constraints, triggers, statistics, privileges, partitions, and a bounded data query.', 'No table metadata is loaded', 'Refresh this table to collect information_schema metadata.', 'Open Data Query'),
  views: descriptor('views', 'Open Views', 'MySQL Views', 'Review stored SELECT definitions, security mode, check option, and bounded view queries.', 'No views were returned', 'The database may not contain views.'),
  view: descriptor('view', 'Open View Definition', 'MySQL View', 'Inspect view definition summary, columns, dependencies, privileges, and a bounded query.', 'No view metadata is loaded', 'Refresh this view to collect view metadata.', 'Open View Query'),
  indexes: descriptor('indexes', 'Manage Indexes', 'MySQL Indexes', 'Review primary, secondary, unique, fulltext, spatial, invisible, and prefix indexes with usage hints.', 'No indexes were returned', 'Refresh indexes or check information_schema access.'),
  index: descriptor('index', 'Open Index', 'MySQL Index', 'Inspect indexed columns, uniqueness, cardinality, visibility, prefix length, and maintenance hints.', 'No index metadata is loaded', 'Refresh this index to collect index metadata.'),
  columns: descriptor('columns', 'Open Columns', 'MySQL Columns', 'Review column types, nullability, defaults, generated flags, collation, and comments.', 'No columns were returned', 'Refresh columns to collect information_schema column metadata.'),
  constraints: descriptor('constraints', 'Open Constraints', 'MySQL Constraints', 'Review primary keys, unique constraints, foreign keys, and checks where supported.', 'No constraints were returned', 'This table may not define constraints.'),
  'foreign-keys': descriptor('foreign-keys', 'Open Foreign Keys', 'MySQL Foreign Keys', 'Review referenced tables, columns, update/delete rules, and relationship names.', 'No foreign keys were returned', 'This table may not reference other tables.'),
  triggers: descriptor('triggers', 'Open Triggers', 'MySQL Triggers', 'Review trigger timing, events, enabled state, and definition summary.', 'No triggers were returned', 'This database may not define triggers.'),
  trigger: descriptor('trigger', 'Open Trigger', 'MySQL Trigger', 'Inspect trigger timing, event, table target, and definition summary.', 'No trigger metadata is loaded', 'Refresh this trigger to collect trigger metadata.'),
  procedures: descriptor('procedures', 'Open Procedures', 'MySQL Procedures', 'Review stored procedures, parameters, SQL security, deterministic flags, and execution templates.', 'No procedures were returned', 'The database may not contain stored procedures.'),
  procedure: descriptor('procedure', 'Manage Procedure', 'MySQL Procedure', 'Inspect procedure signature, parameters, definition summary, privileges, and guarded alter/drop previews.', 'No procedure metadata is loaded', 'Refresh this procedure to collect routine metadata.'),
  functions: descriptor('functions', 'Open Functions', 'MySQL Functions', 'Review stored functions, return types, deterministic flags, SQL security, and privileges.', 'No functions were returned', 'The database may not contain stored functions.'),
  function: descriptor('function', 'Manage Function', 'MySQL Function', 'Inspect function signature, return type, definition summary, privileges, and guarded alter/drop previews.', 'No function metadata is loaded', 'Refresh this function to collect routine metadata.'),
  events: descriptor('events', 'Open Events', 'MySQL Events', 'Review scheduled events, status, schedule, last execution, and guarded enable/disable previews.', 'No events were returned', 'The event scheduler may be disabled or no events exist.'),
  event: descriptor('event', 'Open Event', 'MySQL Event', 'Inspect event schedule, status, body summary, and guarded enable/disable previews.', 'No event metadata is loaded', 'Refresh this event to collect event metadata.'),
  partitions: descriptor('partitions', 'Open Partitions', 'MySQL Partitions', 'Review table partitions, row estimates, method, expression, and storage size.', 'No partitions were returned', 'This table may not be partitioned.'),
  storage: descriptor('storage', 'Open Storage', 'MySQL Storage', 'Review storage engines, table sizes, data/index length, auto-increment, and fragmentation hints.', 'No storage metadata is loaded', 'Refresh storage to collect table status metadata.'),
  security: descriptor('security', 'Review Users / Privileges', 'MySQL Users / Privileges', 'Review users, hosts, roles, grants, authentication plugins, and privilege scope.', 'No security metadata is loaded', 'Refresh security or verify privileges to inspect mysql system tables.'),
  users: descriptor('users', 'Review Users', 'MySQL Users', 'Review user accounts, hosts, plugins, lock state, and password-expiry hints.', 'No users were returned', 'User metadata may be restricted.'),
  roles: descriptor('roles', 'Review Roles', 'MySQL Roles', 'Review roles and role assignments where supported.', 'No roles were returned', 'Roles may be unavailable or restricted.'),
  'role-mappings': descriptor('role-mappings', 'Review Role Mappings', 'MariaDB Role Mappings', 'Review MariaDB mysql.roles_mapping memberships, admin options, and mapped principals.', 'No role mappings were returned', 'MariaDB role mapping metadata may be unavailable or restricted.'),
  permissions: descriptor('permissions', 'Review Grants', 'MySQL Grants', 'Review database, table, routine, and global grants for visible principals.', 'No grants were returned', 'The current account may not be allowed to inspect grants.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'MySQL Diagnostics', 'Review sessions, processlist, InnoDB status, slow-query signals, replication, and performance_schema counters.', 'No diagnostics are loaded', 'Refresh diagnostics to collect available MySQL status metadata.'),
  sessions: descriptor('sessions', 'Review Sessions', 'MySQL Sessions', 'Review active sessions, commands, state, duration, and lock/blocking hints.', 'No sessions were returned', 'Processlist metadata may be restricted.'),
  statistics: descriptor('statistics', 'Review Status Counters', 'MySQL Status Counters', 'Review global status counters, threads, slow-query counts, and workload signals.', 'No status counters were returned', 'SHOW GLOBAL STATUS may be restricted.'),
  'slow-queries': descriptor('slow-queries', 'Review Slow Queries', 'MySQL Slow Queries', 'Review digest latency, counts, max latency, and rows examined from performance_schema where available.', 'No slow-query rows were returned', 'performance_schema digest metadata may be disabled or restricted.'),
  'performance-schema': descriptor('performance-schema', 'Review Performance Schema', 'MySQL Performance Schema', 'Review statement digests, table/index I/O waits, metadata locks, and optimizer-trace visibility.', 'No performance_schema rows were returned', 'performance_schema may be disabled, trimmed, or restricted.'),
  'metadata-locks': descriptor('metadata-locks', 'Review Metadata Locks', 'MySQL Metadata Locks', 'Review pending and granted metadata locks with object, lock mode, session, and user context.', 'No metadata locks were returned', 'metadata_locks may be empty or restricted.'),
  'optimizer-trace': descriptor('optimizer-trace', 'Review Optimizer Trace', 'MySQL Optimizer Trace', 'Review optimizer_trace settings, memory limits, and recent trace availability without dumping raw trace JSON first.', 'No optimizer trace settings were returned', 'optimizer_trace may be disabled or unavailable for the current account.'),
  'server-variables': descriptor('server-variables', 'Review Server Variables', 'MariaDB Server Variables', 'Review MariaDB version, SQL mode, default storage engine, and server capability variables.', 'No server variables were returned', 'SHOW VARIABLES may be restricted for the current account.'),
  'storage-engines': descriptor('storage-engines', 'Review Storage Engines', 'MariaDB Storage Engines', 'Review MariaDB storage engines, transaction support, XA support, and savepoint capability.', 'No storage engines were returned', 'SHOW ENGINES may be restricted for the current account.'),
  'analyze-profile': descriptor('analyze-profile', 'Review ANALYZE Profile', 'MariaDB ANALYZE FORMAT=JSON', 'Review guarded MariaDB ANALYZE FORMAT=JSON profile metadata and the read-only sample query template.', 'No ANALYZE profile metadata was returned', 'ANALYZE FORMAT=JSON may be unavailable or blocked by permissions.'),
  'innodb-status': descriptor('innodb-status', 'Review InnoDB Status', 'InnoDB Status', 'Review buffer pool, row-lock waits, purge lag, and storage-engine pressure without raw SHOW output.', 'No InnoDB status rows were returned', 'The server may not use InnoDB or metadata may be restricted.'),
  'status-counters': descriptor('status-counters', 'Review Status Counters', 'MySQL Status Counters', 'Review global status counters, threads, slow query counts, and workload signals.', 'No status counters were returned', 'SHOW GLOBAL STATUS may be restricted.'),
  replication: descriptor('replication', 'Open Replication', 'MySQL Replication', 'Review replica/source status, lag, threads, GTID, and channel health.', 'No replication metadata was returned', 'This server may not be configured for replication.'),
}

const DEFAULT_DESCRIPTOR: MysqlObjectViewDescriptor = descriptor(
  'object',
  'Inspect MySQL Object',
  'MySQL Object',
  'Review available MySQL or MariaDB metadata for this object.',
  'MySQL metadata is not available',
  'Refresh this object or check whether the account can inspect it.',
)

export function getMysqlObjectViewDescriptor(
  kind: string | undefined,
  engine: MysqlFamilyEngine = 'mysql',
): MysqlObjectViewDescriptor {
  if (!kind) {
    return familyDescriptor(DEFAULT_DESCRIPTOR, engine)
  }

  return familyDescriptor(DESCRIPTORS[normalizeMysqlObjectKind(kind)] ?? DEFAULT_DESCRIPTOR, engine)
}

export function mysqlObjectViewMenuLabel(kind: string | undefined): string {
  return getMysqlObjectViewDescriptor(kind).menuLabel
}

export function isMysqlObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeMysqlObjectKind(kind)])
}

export const MYSQL_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): MysqlObjectViewDescriptor {
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

function normalizeMysqlObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

function familyDescriptor(
  descriptor: MysqlObjectViewDescriptor,
  engine: MysqlFamilyEngine,
): MysqlObjectViewDescriptor {
  if (engine !== 'mariadb') {
    return descriptor
  }

  return {
    ...descriptor,
    title: descriptor.title.replace(/^MySQL\b/, 'MariaDB'),
    purpose: descriptor.purpose
      .replace(/\bMySQL\b/g, 'MariaDB')
      .replace(/MariaDB or MariaDB/g, 'MariaDB')
      .replace(/optimizer-trace visibility/i, 'ANALYZE FORMAT=JSON visibility'),
    emptyTitle: descriptor.emptyTitle.replace(/^MySQL\b/, 'MariaDB'),
    emptyDescription: descriptor.emptyDescription.replace(/\bMySQL\b/g, 'MariaDB'),
  }
}
