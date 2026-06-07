export type SqlServerObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, SqlServerObjectViewDescriptor> = {
  databases: descriptor('databases', 'Open Databases', 'SQL Server Databases', 'Review user and system databases, snapshots, status, read-only state, and database-scoped entry points.', 'No databases are visible', 'Refresh databases or verify the login can read sys.databases.'),
  database: descriptor('database', 'Open Database Overview', 'SQL Server Database', 'Review database object folders, file/storage status, Query Store, security, and performance surfaces.', 'No database metadata is loaded', 'Refresh this database to collect visible metadata.'),
  'system-databases': descriptor('system-databases', 'Open System Databases', 'System Databases', 'Review master, model, msdb, tempdb, and other engine-maintained databases separately from user databases.', 'No system databases are visible', 'System database metadata may be hidden by permissions.'),
  'database-snapshots': descriptor('database-snapshots', 'Open Database Snapshots', 'Database Snapshots', 'Review point-in-time database snapshots when available.', 'No database snapshots were returned', 'This server may not use database snapshots.'),
  tables: descriptor('tables', 'Open Tables', 'SQL Server Tables', 'Review base, temporal, external, graph, FileTable, and system table groups.', 'No tables were returned', 'The database may not contain user tables or metadata access may be limited.'),
  table: descriptor('table', 'Open Table', 'SQL Server Table', 'Inspect table data entry points, columns, keys, constraints, indexes, triggers, statistics, dependencies, permissions, and scripts.', 'No table metadata is loaded', 'Refresh this table to collect sys catalog metadata.', 'Open Data Query'),
  views: descriptor('views', 'Open Views', 'SQL Server Views', 'Review stored SELECT projections, definitions, dependencies, indexed-view hints, and bounded query actions.', 'No views were returned', 'The database may not contain views.'),
  view: descriptor('view', 'Open View Definition', 'SQL Server View', 'Inspect view definition, columns, dependencies, permissions, and a bounded query action.', 'No view metadata is loaded', 'Refresh this view to collect metadata.', 'Open View Query'),
  'stored-procedures': descriptor('stored-procedures', 'Open Stored Procedures', 'Stored Procedures', 'Review T-SQL and CLR procedures, parameters, definitions, execution templates, and permissions.', 'No stored procedures were returned', 'The database may not contain stored procedures.'),
  procedure: descriptor('procedure', 'Manage Stored Procedure', 'Stored Procedure', 'Inspect definition, parameters, dependencies, permissions, and guarded alter/drop previews.', 'No procedure metadata is loaded', 'Refresh this procedure to collect metadata.'),
  'scalar-functions': descriptor('scalar-functions', 'Open Scalar Functions', 'Scalar-valued Functions', 'Review scalar T-SQL and CLR functions with signatures and definitions.', 'No scalar functions were returned', 'The database may not contain scalar functions.'),
  'table-valued-functions': descriptor('table-valued-functions', 'Open Table-valued Functions', 'Table-valued Functions', 'Review inline and multi-statement table-valued functions.', 'No table-valued functions were returned', 'The database may not contain table-valued functions.'),
  'aggregate-functions': descriptor('aggregate-functions', 'Open Aggregate Functions', 'Aggregate Functions', 'Review CLR aggregate functions and their metadata.', 'No aggregate functions were returned', 'The database may not contain CLR aggregate functions.'),
  'clr-functions': descriptor('clr-functions', 'Open CLR Functions', 'CLR Functions', 'Review CLR-backed SQL functions and assembly ownership.', 'No CLR functions were returned', 'The database may not contain CLR functions.'),
  functions: descriptor('functions', 'Open Functions', 'SQL Server Functions', 'Review scalar, table-valued, aggregate, and CLR functions.', 'No functions were returned', 'The database may not contain functions.'),
  function: descriptor('function', 'Manage Function', 'SQL Server Function', 'Inspect function definition, parameters, dependencies, permissions, and guarded alter/drop previews.', 'No function metadata is loaded', 'Refresh this function to collect metadata.'),
  indexes: descriptor('indexes', 'Manage Indexes', 'SQL Server Indexes', 'Review clustered, nonclustered, columnstore, XML, spatial, and filtered indexes plus usage and fragmentation hints.', 'No indexes were returned', 'Refresh indexes or check sys.indexes access.'),
  index: descriptor('index', 'Open Index', 'SQL Server Index', 'Inspect index key/include columns, type, uniqueness, filter, usage, and maintenance hints.', 'No index metadata is loaded', 'Refresh this index to collect metadata.'),
  columns: descriptor('columns', 'Open Columns', 'SQL Server Columns', 'Review column data types, nullability, identity/computed flags, defaults, and collation.', 'No columns were returned', 'Refresh columns or check table metadata access.'),
  keys: descriptor('keys', 'Open Keys', 'SQL Server Keys', 'Review primary keys, unique keys, foreign keys, and table relationships.', 'No keys were returned', 'This object may not have keys.'),
  constraints: descriptor('constraints', 'Open Constraints', 'SQL Server Constraints', 'Review check, default, primary, unique, and foreign key constraints.', 'No constraints were returned', 'This object may not have constraints.'),
  triggers: descriptor('triggers', 'Open Triggers', 'SQL Server Triggers', 'Review DML/database triggers, enabled state, timing, and definition hints.', 'No triggers were returned', 'This object may not have triggers.'),
  statistics: descriptor('statistics', 'Open Statistics', 'SQL Server Statistics', 'Review statistics objects, row modification counters, histograms, and last update hints.', 'No statistics were returned', 'Statistics metadata may be unavailable.'),
  dependencies: descriptor('dependencies', 'Open Dependencies', 'SQL Server Dependencies', 'Review referenced and referencing objects before changes.', 'No dependencies were returned', 'Dependency metadata may be unavailable.'),
  permissions: descriptor('permissions', 'Review Permissions', 'SQL Server Permissions', 'Review object and database permissions with principal and grantor context.', 'No permissions were returned', 'The login may not be allowed to inspect permissions.'),
  security: descriptor('security', 'Review Security', 'SQL Server Security', 'Review logins, users, roles, schemas, credentials, certificates, keys, and audits.', 'No security metadata is loaded', 'Refresh security or verify catalog permissions.'),
  users: descriptor('users', 'Review Users', 'Database Users', 'Review users, authentication type, default schema, and mapped login metadata.', 'No users were returned', 'User metadata may be restricted.'),
  roles: descriptor('roles', 'Review Roles', 'Database Roles', 'Review database roles and role membership hints.', 'No roles were returned', 'Role metadata may be restricted.'),
  schemas: descriptor('schemas', 'Open Schemas', 'SQL Server Schemas', 'Review object namespaces and schema ownership.', 'No schemas were returned', 'Schema metadata may be restricted.'),
  certificate: descriptor('certificate', 'Review Certificate', 'SQL Server Certificate', 'Review certificate subject, issuer, expiry, private-key posture, and related security context.', 'No certificate metadata was returned', 'Certificate metadata may be restricted.'),
  certificates: descriptor('certificates', 'Review Certificates', 'SQL Server Certificates', 'Review database certificates, subject/issuer metadata, expiry state, and private-key posture.', 'No certificates were returned', 'This database may not use certificates.'),
  'symmetric-key': descriptor('symmetric-key', 'Review Symmetric Key', 'Symmetric Key', 'Review symmetric key algorithm, length, owner, and lifecycle metadata.', 'No symmetric key metadata was returned', 'Symmetric key metadata may be restricted.'),
  'symmetric-keys': descriptor('symmetric-keys', 'Review Symmetric Keys', 'Symmetric Keys', 'Review symmetric key algorithms, lengths, owners, and lifecycle metadata.', 'No symmetric keys were returned', 'This database may not use symmetric keys.'),
  'asymmetric-key': descriptor('asymmetric-key', 'Review Asymmetric Key', 'Asymmetric Key', 'Review asymmetric key algorithm, length, owner, and private-key encryption posture.', 'No asymmetric key metadata was returned', 'Asymmetric key metadata may be restricted.'),
  'asymmetric-keys': descriptor('asymmetric-keys', 'Review Asymmetric Keys', 'Asymmetric Keys', 'Review asymmetric key algorithms, lengths, owners, and private-key encryption posture.', 'No asymmetric keys were returned', 'This database may not use asymmetric keys.'),
  credential: descriptor('credential', 'Review Credential', 'Database Scoped Credential', 'Review scoped credential identity metadata without exposing secret material.', 'No credential metadata was returned', 'Credential metadata may be restricted.'),
  credentials: descriptor('credentials', 'Review Credentials', 'Database Scoped Credentials', 'Review scoped credential identities and provider metadata without exposing secret material.', 'No credentials were returned', 'This database may not use database-scoped credentials.'),
  'database-scoped-credential': descriptor('database-scoped-credential', 'Review Credential', 'Database Scoped Credential', 'Review scoped credential identity metadata without exposing secret material.', 'No credential metadata was returned', 'Credential metadata may be restricted.'),
  'database-scoped-credentials': descriptor('database-scoped-credentials', 'Review Credentials', 'Database Scoped Credentials', 'Review scoped credential identities and provider metadata without exposing secret material.', 'No credentials were returned', 'This database may not use database-scoped credentials.'),
  audit: descriptor('audit', 'Review Audit', 'Database Audit Specification', 'Review database audit specification state, action count, and server audit binding.', 'No audit metadata was returned', 'Audit metadata may be restricted.'),
  audits: descriptor('audits', 'Review Audits', 'Database Audit Specifications', 'Review database audit specification state, action counts, and server audit bindings.', 'No audit specifications were returned', 'This database may not use database audit specifications.'),
  synonyms: descriptor('synonyms', 'Open Synonyms', 'SQL Server Synonyms', 'Review object aliases and base object targets.', 'No synonyms were returned', 'The database may not contain synonyms.'),
  sequences: descriptor('sequences', 'Open Sequences', 'SQL Server Sequences', 'Review sequence data type, increment, cache, cycling, and current range metadata.', 'No sequences were returned', 'The database may not contain sequences.'),
  types: descriptor('types', 'Open Types', 'SQL Server Types', 'Review user-defined, alias, CLR, and table types.', 'No types were returned', 'The database may not contain user-defined types.'),
  assemblies: descriptor('assemblies', 'Open Assemblies', 'SQL Server Assemblies', 'Review CLR assemblies, permission sets, and related objects.', 'No assemblies were returned', 'CLR may not be enabled or no assemblies exist.'),
  'query-store': descriptor('query-store', 'Open Query Store', 'Query Store', 'Review top queries, regressed queries, forced plans, runtime stats, and Query Store status.', 'No Query Store metadata is loaded', 'Query Store may be disabled or access may be restricted.'),
  'query-store-view': descriptor('query-store-view', 'Open Query Store View', 'Query Store View', 'Review a focused Query Store surface such as top queries, regressed queries, or forced plans.', 'No Query Store rows were returned', 'Query Store may be empty or disabled.'),
  performance: descriptor('performance', 'Open Performance', 'SQL Server Performance', 'Review active sessions, locks, waits, and tuning hints from available DMVs.', 'No performance metadata is loaded', 'Refresh performance metadata or check DMV permissions.'),
  waits: descriptor('waits', 'Review Wait Stats', 'Wait Stats', 'Review wait categories, task counts, accumulated waits, and likely pressure sources.', 'No wait stats were returned', 'Wait stats may be unavailable or restricted.'),
  'missing-indexes': descriptor('missing-indexes', 'Review Missing Indexes', 'Missing Indexes', 'Review optimizer missing-index hints and impact estimates.', 'No missing-index hints were returned', 'Missing-index DMVs may be empty or restricted.'),
  'extended-events': descriptor('extended-events', 'Open Extended Events', 'Extended Events', 'Review event sessions, targets, and capture templates.', 'No Extended Events metadata is loaded', 'Extended Events metadata may be unavailable.'),
  'sql-server-agent': descriptor('sql-server-agent', 'Open SQL Server Agent', 'SQL Server Agent', 'Review jobs, schedules, alerts, operators, proxies, and Agent availability.', 'No Agent metadata is loaded', 'SQL Server Agent may be disabled or unavailable on Azure SQL Database.'),
  agent: descriptor('agent', 'Open SQL Server Agent', 'SQL Server Agent', 'Review jobs, schedules, alerts, operators, proxies, and Agent availability.', 'No Agent metadata is loaded', 'SQL Server Agent may be disabled or unavailable on Azure SQL Database.'),
  job: descriptor('job', 'Open Job', 'SQL Server Agent Job', 'Review one SQL Agent job with schedule, run history, owner, category, and guarded management previews.', 'No job metadata was returned', 'SQL Server Agent job metadata may be unavailable or restricted.'),
  jobs: descriptor('jobs', 'Open Jobs', 'SQL Server Agent Jobs', 'Review SQL Agent jobs, enabled state, last run, next run, and guarded run/disable previews.', 'No jobs were returned', 'SQL Server Agent may be unavailable or restricted.'),
  schedule: descriptor('schedule', 'Open Schedule', 'SQL Server Agent Schedule', 'Review one SQL Agent schedule with frequency, active window, and attached jobs.', 'No schedule metadata was returned', 'Agent schedule metadata may be unavailable.'),
  schedules: descriptor('schedules', 'Open Schedules', 'SQL Server Agent Schedules', 'Review SQL Agent schedule metadata.', 'No schedules were returned', 'Agent schedules may be unavailable.'),
  alert: descriptor('alert', 'Open Alert', 'SQL Server Agent Alert', 'Review one SQL Agent alert with severity, message, database scope, and notification posture.', 'No alert metadata was returned', 'Agent alert metadata may be unavailable.'),
  alerts: descriptor('alerts', 'Open Alerts', 'SQL Server Agent Alerts', 'Review SQL Agent alert metadata, severity/message bindings, and last occurrence signals.', 'No alerts were returned', 'Agent alerts may be unavailable.'),
  operator: descriptor('operator', 'Open Operator', 'SQL Server Agent Operator', 'Review one SQL Agent notification operator and available delivery channels.', 'No operator metadata was returned', 'Agent operator metadata may be unavailable.'),
  operators: descriptor('operators', 'Open Operators', 'SQL Server Agent Operators', 'Review SQL Agent notification operators and delivery channel metadata.', 'No operators were returned', 'Agent operators may be unavailable.'),
  proxy: descriptor('proxy', 'Open Proxy', 'SQL Server Agent Proxy', 'Review one SQL Agent proxy, credential binding, and subsystem coverage.', 'No proxy metadata was returned', 'Agent proxy metadata may be unavailable.'),
  proxies: descriptor('proxies', 'Open Proxies', 'SQL Server Agent Proxies', 'Review SQL Agent proxies, credential bindings, and subsystem coverage.', 'No proxies were returned', 'Agent proxies may be unavailable.'),
  storage: descriptor('storage', 'Open Storage', 'SQL Server Storage', 'Review database files, filegroups, partitions, size, growth, and allocation surfaces.', 'No storage metadata is loaded', 'Refresh storage or check database file metadata access.'),
  file: descriptor('file', 'Open File', 'Database File', 'Review one logical database file, type, size, growth, max-size, state, and data-space mapping.', 'No file metadata was returned', 'File metadata may be restricted.'),
  files: descriptor('files', 'Open Files', 'Database Files', 'Review logical files, type, size, growth, max size, and state.', 'No files were returned', 'File metadata may be restricted.'),
  filegroup: descriptor('filegroup', 'Open Filegroup', 'Filegroup', 'Review one filegroup state, default/read-only flags, file count, and allocation context.', 'No filegroup metadata was returned', 'Filegroup metadata may be restricted.'),
  filegroups: descriptor('filegroups', 'Open Filegroups', 'Filegroups', 'Review filegroup state, default/read-only flags, and allocation context.', 'No filegroups were returned', 'Filegroup metadata may be unavailable.'),
  'partition-scheme': descriptor('partition-scheme', 'Open Partition Scheme', 'Partition Scheme', 'Review one partition scheme, function mapping, and destination count.', 'No partition scheme metadata was returned', 'Partition scheme metadata may be restricted.'),
  'partition-schemes': descriptor('partition-schemes', 'Open Partition Schemes', 'Partition Schemes', 'Review partition schemes, function mappings, and destination counts.', 'No partition schemes were returned', 'This database may not use partition schemes.'),
  'partition-function': descriptor('partition-function', 'Open Partition Function', 'Partition Function', 'Review one partition function, boundary direction, fanout, and range values.', 'No partition function metadata was returned', 'Partition function metadata may be restricted.'),
  'partition-functions': descriptor('partition-functions', 'Open Partition Functions', 'Partition Functions', 'Review partition functions, boundary direction, fanout, and range values.', 'No partition functions were returned', 'This database may not use partition functions.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'SQL Server Diagnostics', 'Review sessions, blocking, waits, IO, memory, TempDB, Query Store, and index health surfaces.', 'No diagnostics are loaded', 'Refresh diagnostics to collect available DMV metadata.'),
  sessions: descriptor('sessions', 'Review Sessions', 'SQL Server Sessions', 'Review active sessions, blocking, wait type, CPU, reads, writes, and login context.', 'No sessions were returned', 'DMV access may be restricted.'),
  locks: descriptor('locks', 'Review Locks', 'SQL Server Locks', 'Review lock resources, modes, request status, and blocking risk.', 'No locks were returned', 'There may be no locks or DMV access may be restricted.'),
}

const DEFAULT_DESCRIPTOR: SqlServerObjectViewDescriptor = descriptor(
  'object',
  'Inspect SQL Server Object',
  'SQL Server Object',
  'Review available SQL Server catalog metadata for this object.',
  'SQL Server metadata is not available',
  'Refresh this object or check whether the connected login can inspect it.',
)

export function getSqlServerObjectViewDescriptor(kind: string | undefined): SqlServerObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeSqlServerObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function sqlServerObjectViewMenuLabel(kind: string | undefined): string {
  return getSqlServerObjectViewDescriptor(kind).menuLabel
}

export function isSqlServerObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeSqlServerObjectKind(kind)])
}

export const SQLSERVER_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): SqlServerObjectViewDescriptor {
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

function normalizeSqlServerObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
