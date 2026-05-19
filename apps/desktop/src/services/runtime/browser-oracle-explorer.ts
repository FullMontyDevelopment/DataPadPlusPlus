import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'

export function createOracleExplorerNodes(
  connection: ConnectionProfile,
  scope?: string,
): ExplorerNode[] {
  const schema = connection.auth.username?.trim().toUpperCase() || 'APP'
  const service = connection.database || connection.oracleOptions?.serviceName || 'ORCLPDB1'

  if (!scope) {
    return [
      oracleNode('oracle-containers', 'Containers', 'containers', 'CDB/PDB containers', 'oracle:containers', ['Oracle'], true),
      oracleNode('oracle-schemas', 'Schemas', 'schemas', 'Users and object schemas', 'oracle:schemas', ['Oracle'], true),
      oracleNode('oracle-security', 'Security', 'security', 'Users, roles, profiles, privileges, and grants', 'oracle:security', ['Oracle'], true),
      oracleNode('oracle-storage', 'Storage', 'storage', 'Tablespaces, data files, segments, and quotas', 'oracle:storage', ['Oracle'], true),
      oracleNode('oracle-performance', 'Performance', 'performance', 'Sessions, waits, SQL Monitor, AWR, and ASH', 'oracle:performance', ['Oracle'], true),
      oracleNode('oracle-scheduler', 'Scheduler', 'scheduler', 'Jobs, programs, chains, and windows', 'oracle:scheduler', ['Oracle'], true),
      oracleNode('oracle-queues', 'Queues', 'queues', 'Advanced Queuing objects', 'oracle:queues', ['Oracle'], true),
      oracleNode('oracle-data-guard', 'Data Guard', 'data-guard', 'Data Guard status where available', 'oracle:data-guard', ['Oracle'], true),
      oracleNode('oracle-rac', 'RAC', 'rac', 'Cluster instances and services where available', 'oracle:rac', ['Oracle'], true),
      oracleNode('oracle-diagnostics', 'Diagnostics', 'diagnostics', 'Plans, locks, waits, and database health', 'oracle:diagnostics', ['Oracle'], true),
    ]
  }

  if (scope === 'oracle:containers') {
    return [
      oracleNode(`oracle-container:${service}`, service, 'database', 'Selected Oracle service/container', `oracle:container:${service}`, ['Oracle', 'Containers'], true),
    ]
  }

  if (scope.startsWith('oracle:container:')) {
    const container = scope.replace('oracle:container:', '') || service
    return oracleSchemaSections(schema, ['Oracle', 'Containers', container])
  }

  if (scope === 'oracle:schemas') {
    return [
      oracleNode(`oracle-schema:${schema}`, schema, 'schema', 'Configured Oracle schema', `oracle:schema:${schema}`, ['Oracle', 'Schemas'], true),
    ]
  }

  if (scope.startsWith('oracle:schema:')) {
    return oracleSchemaSections(scope.replace('oracle:schema:', '') || schema, ['Oracle', 'Schemas', schema])
  }

  if (scope === 'oracle:security') {
    return [
      oracleNode('oracle-users', 'Users', 'users', 'Database users', undefined, ['Oracle', 'Security']),
      oracleNode('oracle-roles', 'Roles', 'roles', 'Database roles', undefined, ['Oracle', 'Security']),
      oracleNode('oracle-profiles', 'Profiles', 'profiles', 'Password and resource profiles', undefined, ['Oracle', 'Security']),
      oracleNode('oracle-privileges', 'Privileges', 'privileges', 'System and object privileges', undefined, ['Oracle', 'Security']),
    ]
  }

  if (scope === 'oracle:storage') {
    return [
      oracleNode('oracle-tablespaces', 'Tablespaces', 'tablespaces', 'Tablespace status and allocation', undefined, ['Oracle', 'Storage']),
      oracleNode('oracle-data-files', 'Data Files', 'data-files', 'Data files where granted', undefined, ['Oracle', 'Storage']),
      oracleNode('oracle-segments', 'Segments', 'segments', 'Segment sizes and owners', undefined, ['Oracle', 'Storage']),
      oracleNode('oracle-quotas', 'Quotas', 'quotas', 'Tablespace quotas', undefined, ['Oracle', 'Storage']),
    ]
  }

  if (scope === 'oracle:performance' || scope === 'oracle:diagnostics') {
    return [
      oracleNode('oracle-sessions', 'Sessions', 'sessions', 'Active sessions', undefined, ['Oracle', 'Performance']),
      oracleNode('oracle-locks', 'Locks', 'locks', 'Lock and blocking metadata', undefined, ['Oracle', 'Performance']),
      oracleNode('oracle-top-sql', 'Top SQL', 'sql-monitor', 'High activity SQL', undefined, ['Oracle', 'Performance']),
      oracleNode('oracle-explain-plan', 'Execution Plan', 'execution-plan', 'DBMS_XPLAN output', undefined, ['Oracle', 'Diagnostics']),
      oracleNode('oracle-invalid-objects', 'Invalid Objects', 'invalid-objects', 'Invalid compilation status', undefined, ['Oracle', 'Diagnostics']),
    ]
  }

  if (scope === 'oracle:scheduler') {
    return [
      oracleNode('oracle-scheduler-jobs', 'Jobs', 'jobs', 'Scheduler jobs', undefined, ['Oracle', 'Scheduler']),
      oracleNode('oracle-scheduler-programs', 'Programs', 'programs', 'Scheduler programs', undefined, ['Oracle', 'Scheduler']),
      oracleNode('oracle-scheduler-chains', 'Chains', 'chains', 'Scheduler chains', undefined, ['Oracle', 'Scheduler']),
      oracleNode('oracle-scheduler-windows', 'Windows', 'windows', 'Scheduler windows', undefined, ['Oracle', 'Scheduler']),
    ]
  }

  return []
}

export function oracleInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('oracle-table:')) {
    const [, schema = 'APP', table = 'TABLE_NAME'] = nodeId.split(':')
    return `select * from "${schema}"."${table}" where rownum <= 100;`
  }

  return oracleInspectQueryTemplateForKind('object', nodeId)
}

export function oracleInspectPayload(connection: ConnectionProfile, nodeId: string) {
  return {
    engine: 'oracle',
    nodeId,
    service: connection.database || connection.oracleOptions?.serviceName || 'ORCLPDB1',
    metadataViews: ['ALL_OBJECTS', 'ALL_TABLES', 'ALL_TAB_COLUMNS', 'ALL_INDEXES', 'ALL_CONSTRAINTS'],
    permissionSensitiveViews: ['DBA_*', 'V$', 'GV$', 'DBA_HIST_*'],
    objectViews: {
      table: ['Data', 'Columns', 'Indexes', 'Constraints', 'Triggers', 'Partitions', 'Statistics', 'Dependencies', 'Permissions', 'DDL'],
      package: ['Spec', 'Body', 'Dependencies', 'Compilation Errors', 'Permissions'],
      query: ['Results', 'Messages', 'Execution Plan', 'Statistics', 'SQL Monitor'],
    },
  }
}

function oracleSchemaSections(schema: string, path: string[]): ExplorerNode[] {
  return [
    oracleNode(`oracle-tables:${schema}`, 'Tables', 'tables', 'Base tables', undefined, path),
    oracleNode(`oracle-views:${schema}`, 'Views', 'views', 'Stored query projections', undefined, path),
    oracleNode(`oracle-mviews:${schema}`, 'Materialized Views', 'materialized-views', 'Refreshable persisted query results', undefined, path),
    oracleNode(`oracle-synonyms:${schema}`, 'Synonyms', 'synonyms', 'Object aliases', undefined, path),
    oracleNode(`oracle-sequences:${schema}`, 'Sequences', 'sequences', 'Generated numeric sequences', undefined, path),
    oracleNode(`oracle-functions:${schema}`, 'Functions', 'functions', 'PL/SQL functions', undefined, path),
    oracleNode(`oracle-procedures:${schema}`, 'Procedures', 'procedures', 'PL/SQL procedures', undefined, path),
    oracleNode(`oracle-packages:${schema}`, 'Packages', 'packages', 'PL/SQL package specs and bodies', undefined, path),
    oracleNode(`oracle-types:${schema}`, 'Types', 'types', 'Object and collection types', undefined, path),
    oracleNode(`oracle-java:${schema}`, 'Java Sources', 'java-sources', 'Java stored source objects', undefined, path),
    oracleNode(`oracle-json:${schema}`, 'JSON Collections', 'json-collections', 'Oracle JSON collection-style objects', undefined, path),
    oracleNode(`oracle-xdb:${schema}`, 'XML DB', 'xml-db', 'XML DB resources', undefined, path),
    oracleNode(`oracle-external:${schema}`, 'External Tables', 'external-tables', 'External file-backed tables', undefined, path),
    oracleNode(`oracle-dblinks:${schema}`, 'Database Links', 'database-links', 'Remote database links', undefined, path),
  ]
}

function oracleNode(
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  path: string[] = ['Oracle'],
  expandable = false,
): ExplorerNode {
  return {
    id,
    family: 'sql',
    label,
    kind,
    detail,
    scope,
    path,
    queryTemplate: oracleInspectQueryTemplateForKind(kind, label),
    expandable,
  }
}

function oracleInspectQueryTemplateForKind(kind: string, label: string) {
  if (kind === 'tables') {
    return "select owner, table_name, status from all_tables where rownum <= 100 order by owner, table_name;"
  }
  if (kind === 'packages') {
    return "select owner, object_name, object_type, status from all_objects where object_type in ('PACKAGE', 'PACKAGE BODY') order by owner, object_name;"
  }
  if (kind === 'security' || kind === 'users' || kind === 'roles') {
    return 'select * from session_privs;'
  }
  if (kind === 'performance' || kind === 'sessions') {
    return 'select * from v$session where rownum <= 100;'
  }
  if (kind === 'storage' || kind === 'tablespaces') {
    return 'select tablespace_name, status from user_tablespaces order by tablespace_name;'
  }
  if (kind === 'execution-plan') {
    return 'select * from table(dbms_xplan.display);'
  }

  return `select owner, object_name, object_type, status from all_objects where object_name = '${label}' or rownum <= 100;`
}
