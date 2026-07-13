export type OracleObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, OracleObjectViewDescriptor> = {
  database: descriptor('database', 'Open Container', 'Oracle Container', 'Review the selected Oracle service or PDB and jump into schema, security, storage, and performance workflows.', 'No container metadata is loaded', 'Refresh this view after connecting to collect service and PDB metadata.'),
  containers: descriptor('containers', 'Open Containers', 'Oracle Containers', 'Review available CDB/PDB containers and the currently selected service.', 'No containers are visible', 'This connection may be scoped to one service, or V$PDBS may not be granted.'),
  schemas: descriptor('schemas', 'Open Schemas', 'Oracle Schemas', 'Browse Oracle users and object-owning schemas without mixing saved Library items into the database tree.', 'No schemas are visible', 'Refresh schemas or verify ALL_USERS access.'),
  schema: descriptor('schema', 'Open Schema Overview', 'Schema Overview', 'Review object counts, invalid objects, and schema-level entry points before opening focused Oracle object views.', 'No schema metadata is loaded', 'Refresh this schema to collect object counts and health metadata.'),
  tables: descriptor('tables', 'Open Tables', 'Oracle Tables', 'Review base tables, status, tablespaces, and table actions for this schema.', 'No tables were returned', 'The schema may not own tables, or ALL_TABLES may be unavailable.'),
  table: descriptor('table', 'Open Table', 'Oracle Table', 'Inspect table data entry points, columns, indexes, constraints, triggers, partitions, statistics, dependencies, permissions, and DDL.', 'No table metadata is loaded', 'Refresh this table to collect dictionary metadata.', 'Open Data Query'),
  views: descriptor('views', 'Open Views', 'Oracle Views', 'Review saved query projections and open focused view definition workflows.', 'No views were returned', 'The schema may not own views, or ALL_VIEWS may be unavailable.'),
  view: descriptor('view', 'Open View Definition', 'Oracle View', 'Inspect the view SQL text, dependencies, grants, and sample-result query action.', 'No view definition is loaded', 'Refresh this view to collect its definition.'),
  'materialized-views': descriptor('materialized-views', 'Open Materialized Views', 'Materialized Views', 'Review refreshable persisted query results, refresh mode, method, and status.', 'No materialized views were returned', 'The schema may not own materialized views.'),
  'materialized-view': descriptor('materialized-view', 'Open Materialized View', 'Oracle Materialized View', 'Inspect refresh configuration and open a bounded data query for this materialized view.', 'No materialized view metadata is loaded', 'Refresh this materialized view to collect its metadata.', 'Open Data Query'),
  sequences: descriptor('sequences', 'Open Sequences', 'Oracle Sequences', 'Review sequence configuration, cache, cycling, and current range metadata.', 'No sequences were returned', 'The schema may not own sequences.'),
  sequence: descriptor('sequence', 'Open Sequence', 'Oracle Sequence', 'Inspect increment, cache, cycling, ordering, and range metadata without advancing the sequence.', 'No sequence metadata is loaded', 'Refresh this sequence to collect its metadata.'),
  procedures: descriptor('procedures', 'Open Procedures', 'Oracle Procedures', 'Review PL/SQL procedures and open compile or execution templates.', 'No procedures were returned', 'The schema may not own procedures.'),
  procedure: descriptor('procedure', 'Manage Procedure', 'Oracle Procedure', 'Inspect procedure source, parameters, dependencies, compilation errors, and guarded compile/drop previews.', 'No procedure source is loaded', 'Refresh this procedure to collect PL/SQL metadata.'),
  functions: descriptor('functions', 'Open Functions', 'Oracle Functions', 'Review PL/SQL functions and open select or compile workflows.', 'No functions were returned', 'The schema may not own functions.'),
  function: descriptor('function', 'Manage Function', 'Oracle Function', 'Inspect function source, parameters, dependencies, compilation errors, and guarded compile/drop previews.', 'No function source is loaded', 'Refresh this function to collect PL/SQL metadata.'),
  packages: descriptor('packages', 'Open Packages', 'Oracle Packages', 'Review package specs and bodies, validity, dependencies, and compilation state.', 'No packages were returned', 'The schema may not own packages.'),
  package: descriptor('package', 'Manage Package', 'Oracle Package', 'Inspect package spec/body, dependencies, compilation errors, permissions, and compile previews.', 'No package source is loaded', 'Refresh this package to collect spec and body metadata.'),
  types: descriptor('types', 'Open Types', 'Oracle Types', 'Review object, collection, and user-defined type metadata.', 'No types were returned', 'The schema may not own object or collection types.'),
  type: descriptor('type', 'Manage Type', 'Oracle Type', 'Inspect type source, attributes, dependencies, errors, and DDL-oriented workflows.', 'No type metadata is loaded', 'Refresh this type to collect metadata.'),
  synonyms: descriptor('synonyms', 'Open Synonyms', 'Oracle Synonyms', 'Review local object aliases and their remote or schema-qualified targets.', 'No synonyms were returned', 'The schema may not own synonyms.'),
  synonym: descriptor('synonym', 'Open Synonym', 'Oracle Synonym', 'Inspect the target owner, target object, and optional database link without querying the target.', 'No synonym metadata is loaded', 'Refresh this synonym to collect its target metadata.'),
  'json-collections': descriptor('json-collections', 'Open JSON Collections', 'Oracle JSON Collections', 'Review visible tables and columns that store Oracle JSON documents.', 'No JSON collections were returned', 'The schema may not expose JSON columns.'),
  'json-collection': descriptor('json-collection', 'Open JSON Collection', 'Oracle JSON Collection', 'Inspect the backing table and open a bounded query for its JSON documents.', 'No JSON collection metadata is loaded', 'Refresh this JSON collection to collect its metadata.', 'Open Data Query'),
  'external-tables': descriptor('external-tables', 'Open External Tables', 'Oracle External Tables', 'Review visible external tables and their access drivers.', 'No external tables were returned', 'The schema may not own external tables.'),
  'external-table': descriptor('external-table', 'Open External Table', 'Oracle External Table', 'Inspect an external table and open a bounded read query without changing its source.', 'No external table metadata is loaded', 'Refresh this external table to collect its metadata.', 'Open Data Query'),
  'database-links': descriptor('database-links', 'Open Database Links', 'Oracle Database Links', 'Review visible database link definitions without opening remote sessions.', 'No database links were returned', 'The schema may not own database links or may lack dictionary access.'),
  'database-link': descriptor('database-link', 'Open Database Link', 'Oracle Database Link', 'Inspect the remote user and host metadata without querying the remote database.', 'No database link metadata is loaded', 'Refresh this database link to collect its metadata.'),
  indexes: descriptor('indexes', 'Manage Indexes', 'Oracle Indexes', 'Review index status, uniqueness, visibility, tablespace, columns, and maintenance previews.', 'No indexes were returned', 'Refresh indexes or check ALL_INDEXES access.'),
  constraints: descriptor('constraints', 'Open Constraints', 'Oracle Constraints', 'Review primary, unique, foreign-key, check, and not-null constraints.', 'No constraints were returned', 'Refresh constraints or check dictionary access.'),
  triggers: descriptor('triggers', 'Open Triggers', 'Oracle Triggers', 'Review trigger status, timing, events, and compile state.', 'No triggers were returned', 'Refresh triggers or check dictionary access.'),
  partitions: descriptor('partitions', 'Open Partitions', 'Oracle Partitions', 'Review partition and subpartition metadata for partitioned objects.', 'No partitions were returned', 'This object may not be partitioned.'),
  statistics: descriptor('statistics', 'Open Statistics', 'Oracle Statistics', 'Review row counts, blocks, sample dates, optimizer stats, and size hints.', 'No statistics were returned', 'Refresh statistics or gather optimizer metadata.'),
  dependencies: descriptor('dependencies', 'Open Dependencies', 'Oracle Dependencies', 'Review referenced and dependent objects so object changes are safer.', 'No dependencies were returned', 'Refresh dependencies or check ALL_DEPENDENCIES access.'),
  permissions: descriptor('permissions', 'Review Permissions', 'Oracle Permissions', 'Review grants and effective object privileges with permission-sensitive warnings.', 'No permissions were returned', 'The connected user may not be allowed to inspect grants.'),
  ddl: descriptor('ddl', 'Open DDL', 'Oracle DDL', 'Review generated DDL only when explicitly requested from this object view.', 'No DDL is loaded', 'DDL extraction may require DBMS_METADATA privileges.'),
  security: descriptor('security', 'Review Security', 'Oracle Security', 'Review users, roles, profiles, system privileges, and object grants.', 'No security metadata is loaded', 'Refresh security or verify dictionary privileges.'),
  users: descriptor('users', 'Review Users', 'Oracle Users', 'Review database users, account state, default tablespace, and profile assignment.', 'No users were returned', 'ALL_USERS may be unavailable or filtered.'),
  roles: descriptor('roles', 'Review Roles', 'Oracle Roles', 'Review enabled roles and granted role metadata.', 'No roles were returned', 'SESSION_ROLES may be empty for this login.'),
  profiles: descriptor('profiles', 'Review Profiles', 'Oracle Profiles', 'Review password and resource profiles where DBA_PROFILES is granted.', 'No profiles were returned', 'Profile metadata usually requires elevated privileges.'),
  privileges: descriptor('privileges', 'Review Grants', 'Oracle Grants', 'Review effective system and object privileges for this connection.', 'No grants were returned', 'The session may have limited privilege metadata.'),
  storage: descriptor('storage', 'Open Storage', 'Oracle Storage', 'Review tablespaces, data files, segments, quotas, and storage health.', 'No storage metadata is loaded', 'Refresh storage or verify USER_/DBA_ storage view access.'),
  tablespaces: descriptor('tablespaces', 'Open Tablespace Usage', 'Tablespace Usage', 'Review tablespace state, allocation, and free-space indicators.', 'No tablespaces were returned', 'USER_TABLESPACES may be unavailable.'),
  'data-files': descriptor('data-files', 'Open Data Files', 'Oracle Data Files', 'Review data file sizes and status where DBA_DATA_FILES is granted.', 'No data files were returned', 'Data file metadata usually requires DBA privileges.'),
  segments: descriptor('segments', 'Open Segments', 'Oracle Segments', 'Review segment owners, object names, segment types, and size.', 'No segments were returned', 'Segment metadata may require DBA_SEGMENTS access.'),
  quotas: descriptor('quotas', 'Open Quotas', 'Oracle Quotas', 'Review tablespace quota usage for the current user.', 'No quotas were returned', 'The user may not have quota entries.'),
  performance: descriptor('performance', 'Open Performance', 'Oracle Performance', 'Review sessions, waits, top SQL, locks, and diagnostics surfaces when granted.', 'No performance metadata is loaded', 'V$ and GV$ views require explicit grants.'),
  sessions: descriptor('sessions', 'Review Sessions', 'Oracle Sessions', 'Review active sessions, status, wait class, and blocking hints.', 'No sessions were returned', 'V$SESSION may be unavailable to this user.'),
  waits: descriptor('waits', 'Review Waits', 'Oracle Waits', 'Review session wait classes and current wait events.', 'No wait metadata was returned', 'V$SESSION_WAIT may be unavailable.'),
  locks: descriptor('locks', 'Review Locks', 'Oracle Locks', 'Review lock and blocking metadata.', 'No locks were returned', 'V$LOCK may be unavailable or there may be no locks.'),
  'sql-monitor': descriptor('sql-monitor', 'Open SQL Monitor', 'SQL Monitor', 'Review high-activity SQL and monitor reports where licensed and granted.', 'No SQL Monitor rows were returned', 'SQL Monitor views may require extra privileges or licensing.'),
  'execution-plan': descriptor('execution-plan', 'Open Execution Plan', 'Execution Plan', 'Review DBMS_XPLAN output in a readable plan table.', 'No execution plan is loaded', 'Run EXPLAIN PLAN or refresh after a plan exists.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'Oracle Diagnostics', 'Review execution plans, locks, waits, invalid objects, and database health.', 'No diagnostics are loaded', 'Refresh diagnostics to collect available metadata.'),
  'invalid-objects': descriptor('invalid-objects', 'Review Invalid Objects', 'Invalid Objects', 'Review invalid PL/SQL and schema objects that may need recompilation.', 'No invalid objects were returned', 'All visible objects may currently be valid.'),
}

const DEFAULT_DESCRIPTOR: OracleObjectViewDescriptor = descriptor(
  'object',
  'Inspect Oracle Object',
  'Oracle Object',
  'Review available Oracle dictionary metadata for this object.',
  'Oracle metadata is not available',
  'Refresh this object or check whether the connected user can inspect it.',
)

export function getOracleObjectViewDescriptor(kind: string | undefined): OracleObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeOracleObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function oracleObjectViewMenuLabel(kind: string | undefined): string {
  return getOracleObjectViewDescriptor(kind).menuLabel
}

export function isOracleObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeOracleObjectKind(kind)])
}

export const ORACLE_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): OracleObjectViewDescriptor {
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

function normalizeOracleObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
