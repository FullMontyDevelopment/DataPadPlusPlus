import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  postgresSourceInspectPayload,
  postgresSourceInspectQueryTemplate,
} from './browser-relational-source-payloads'
import {
  timescaleInspectPayload,
  timescaleInspectQueryTemplate,
} from './browser-timescale-payloads'
import {
  postgresDiagnosticsBrowserPayload,
  postgresExtensionBrowserPayload,
  postgresSchemaBrowserPayload,
  postgresSecurityBrowserPayload,
} from './browser-postgres-payload-fixtures'
import {
  parsePostgresNodeId,
  postgresColumns,
} from './browser-postgres-family-helpers'

export { cockroachInspectPayload } from './browser-cockroach-payloads'
export { cockroachInspectQueryTemplate } from './browser-cockroach-query-templates'

export function postgresInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parsePostgresNodeId(connection, nodeId)

  if (connection.engine === 'timescaledb') {
    const timescaleQuery = timescaleInspectQueryTemplate(nodeId, schema, objectName)
    if (timescaleQuery) {
      return timescaleQuery
    }
  }

  if (['table:', 'view:', 'materialized-view:'].some((prefix) => nodeId.startsWith(prefix)) && objectName) {
    return `select * from "${schema}"."${objectName}" limit 100;`
  }

  const sourceQuery = postgresSourceInspectQueryTemplate(nodeId, schema, objectName)
  if (sourceQuery) {
    return sourceQuery
  }

  if (nodeId.includes('locks')) {
    return 'select locktype, mode, granted, relation::regclass::text as relation from pg_locks limit 100;'
  }

  if (nodeId.includes('waits')) {
    return 'select wait_event_type, wait_event, count(*) as sessions from pg_stat_activity where wait_event is not null group by wait_event_type, wait_event order by sessions desc;'
  }

  if (nodeId.includes('statements')) {
    return 'select query, calls, mean_exec_time, rows from pg_stat_statements order by mean_exec_time desc limit 50;'
  }

  if (nodeId.includes('index-health')) {
    return 'select schemaname, relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch from pg_stat_user_indexes order by idx_scan asc limit 100;'
  }

  if (nodeId.includes('diagnostics') || nodeId.includes('sessions')) {
    return 'select pid, usename, datname, state, wait_event_type, wait_event from pg_stat_activity order by query_start desc nulls last limit 100;'
  }

  if (nodeId.startsWith('extension:')) {
    return `select e.extname, e.extversion, n.nspname as schema, a.default_version, a.comment from pg_extension e join pg_namespace n on n.oid = e.extnamespace left join pg_available_extensions a on a.name = e.extname where n.nspname = '${schema.replace(/'/g, "''")}' and e.extname = '${objectName.replace(/'/g, "''")}';`
  }

  if (nodeId.includes('security') || nodeId.includes('roles') || nodeId.includes('default-privileges')) {
    return [
      'select rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb from pg_roles order by rolname;',
      'select member.rolname as role, parent.rolname as member_of, m.admin_option from pg_auth_members m join pg_roles member on member.oid = m.member join pg_roles parent on parent.oid = m.roleid order by role, member_of;',
      'select grantee, privilege_type, table_schema, table_name, is_grantable from information_schema.role_table_grants order by table_schema, table_name, grantee;',
      'select * from pg_default_acl order by defaclnamespace, defaclrole;',
    ].join('\n')
  }

  return `select schemaname, tablename from pg_catalog.pg_tables where schemaname = '${schema.replace(/'/g, "''")}' order by tablename;`
}

export function postgresInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parsePostgresNodeId(connection, nodeId)
  const base = {
    engine: connection.engine,
    database: connection.database || 'datapadplusplus',
    schema,
    objectName,
  }

  if (connection.engine === 'timescaledb') {
    const payload = timescaleInspectPayload(
      connection,
      base,
      nodeId,
      schema,
      objectName,
      postgresColumns(),
    )
    if (payload) {
      return payload
    }
  }

  if (nodeId.startsWith('table:')) {
    return {
      ...base,
      rowCount: 128,
      size: '96 KB',
      columns: postgresColumns(),
      indexes: [
        { name: `${objectName}_pkey`, type: 'btree', columns: 'id', unique: true, valid: true, size: '16 KB' },
        { name: `${objectName}_updated_at_idx`, type: 'btree', columns: 'updated_at', unique: false, valid: true, size: '16 KB' },
      ],
      constraints: [
        { name: `${objectName}_pkey`, type: 'PRIMARY KEY', columns: 'id', status: 'validated' },
      ],
      triggers: [
        { name: `${objectName}_updated_at_trg`, timing: 'BEFORE', event: 'UPDATE', enabled: true, function: 'set_updated_at()' },
      ],
      statistics: [
        { name: objectName, rows: 128, scans: 6, lastVacuum: '2026-05-10', lastAnalyze: '2026-05-16', size: '96 KB' },
      ],
      permissions: [
        { principal: 'reporting', privilege: 'SELECT', object: `${schema}.${objectName}`, objectKind: 'relation', state: 'granted', grantor: schema, grantable: false },
      ],
    }
  }

  const sourcePayload = postgresSourceInspectPayload(base, nodeId, schema, objectName)
  if (sourcePayload) {
    return sourcePayload
  }

  if (nodeId.startsWith('schema:') || nodeId.startsWith('postgres:') && !nodeId.includes(':diagnostics') && !nodeId.includes(':security')) {
    return postgresSchemaBrowserPayload(base, schema)
  }

  if (nodeId.startsWith('extension:')) {
    return postgresExtensionBrowserPayload(base, schema, objectName)
  }

  if (nodeId.includes('security') || nodeId.includes('roles')) {
    return postgresSecurityBrowserPayload(base, schema)
  }

  if (
    nodeId.includes('diagnostics') ||
    nodeId.includes('sessions') ||
    nodeId.includes('locks') ||
    nodeId.includes('waits') ||
    nodeId.includes('statements') ||
    nodeId.includes('index-health')
  ) {
    return postgresDiagnosticsBrowserPayload(base, schema)
  }

  return {
    ...base,
    objects: [
      { schema, name: objectName || 'accounts', type: 'table', status: 'visible' },
    ],
  }
}
