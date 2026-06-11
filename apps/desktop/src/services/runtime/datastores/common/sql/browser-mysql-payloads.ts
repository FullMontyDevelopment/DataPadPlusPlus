import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  mysqlGrants,
  mysqlIndexes,
  mysqlStatistics,
  mysqlTables,
} from './browser-mysql-fixtures'
import {
  mysqlIdentifier,
  parseMysqlObjectScope,
} from './browser-mysql-helpers'
import { mysqlDiagnosticsPayload } from './browser-mysql-diagnostics'

export function mysqlInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const database = connection.database || 'datapadplusplus'

  if (nodeId.startsWith('database:')) {
    return mysqlDatabasePayload(connection, nodeId.replace('database:', '') || database)
  }

  if (nodeId === 'mysql:system-schemas') {
    return {
      engine: connection.engine,
      database,
      objectView: 'system-schemas',
      schemas: [
        { name: 'information_schema', type: 'system', objectCount: 64 },
        { name: 'mysql', type: 'system', objectCount: 38 },
        { name: 'performance_schema', type: 'system', objectCount: 112 },
        { name: 'sys', type: 'system', objectCount: 100 },
      ],
    }
  }

  if (nodeId.startsWith('mysql:security')) {
    return mysqlSecurityPayload(connection)
  }

  if (nodeId.startsWith('mysql:diagnostics')) {
    return mysqlDiagnosticsPayload(connection)
  }

  if (nodeId.startsWith('mysql:')) {
    const [, scopedDatabase = database, section = 'tables'] = nodeId.split(':')
    return mysqlFolderPayload(connection, scopedDatabase, section)
  }

  if (nodeId.startsWith('table-section:')) {
    const [, scopedDatabase = database, table = 'accounts', section = 'columns'] = nodeId.split(':')
    return mysqlTablePayload(connection, scopedDatabase, table, section)
  }

  if (nodeId.startsWith('table:')) {
    const { database: scopedDatabase, objectName } = parseMysqlObjectScope(nodeId, database)
    return mysqlTablePayload(connection, scopedDatabase, objectName, 'table')
  }

  if (nodeId.startsWith('view:')) {
    const { database: scopedDatabase, objectName } = parseMysqlObjectScope(nodeId, database)
    return {
      engine: connection.engine,
      database: scopedDatabase,
      schema: scopedDatabase,
      objectName,
      objectView: 'view',
      views: [{
        schema: scopedDatabase,
        name: objectName,
        definition: "create view active_accounts as select id, name, status from accounts where status = 'active'",
        status: 'valid',
      }],
      columns: [
        { name: 'id', type: 'bigint', nullable: false },
        { name: 'name', type: 'varchar(160)', nullable: true },
        { name: 'status', type: 'varchar(40)', nullable: true },
      ],
      dependencies: [{ name: 'accounts', type: 'table', direction: 'reads from' }],
    }
  }

  if (nodeId.startsWith('procedure:') || nodeId.startsWith('function:') || nodeId.startsWith('event:') || nodeId.startsWith('trigger:')) {
    return mysqlRoutinePayload(connection, nodeId, database)
  }

  if (nodeId.startsWith('index:')) {
    const [, scopedDatabase = database, table = 'accounts', index = 'PRIMARY'] = nodeId.split(':')
    return {
      engine: connection.engine,
      database: scopedDatabase,
      schema: scopedDatabase,
      objectName: index,
      objectView: 'index',
      indexes: mysqlIndexes(table).filter((row) => row.name === index || row.name === 'PRIMARY'),
    }
  }

  return mysqlDatabasePayload(connection, database)
}

function mysqlDatabasePayload(connection: ConnectionProfile, database: string) {
  return {
    engine: connection.engine,
    database,
    schema: database,
    objectName: database,
    objectView: 'database',
    tableCount: 3,
    indexCount: 4,
    rowCount: 428,
    tables: mysqlTables(database),
    views: [{
      schema: database,
      name: 'active_accounts',
      definition: "create view active_accounts as select id, name, status from accounts where status = 'active'",
      status: 'valid',
    }],
    indexes: [
      ...mysqlIndexes('accounts'),
      ...mysqlIndexes('orders'),
    ],
    procedures: [
      { schema: database, name: 'refresh_account_rollup', arguments: 'in p_account_id bigint', language: 'sql', security: 'definer' },
    ],
    functions: [
      { schema: database, name: 'account_status_label', arguments: 'p_status varchar(40)', returns: 'varchar(120)', language: 'sql' },
    ],
    events: [
      { schema: database, name: 'purge_old_sessions', status: 'enabled', schedule: 'every 1 day', lastExecuted: '2026-05-20T02:00:00Z', definer: 'app@%' },
    ],
    triggers: [
      { name: 'accounts_updated_at', timing: 'before', event: 'update', enabled: true, function: 'sets updated_at' },
    ],
    permissions: mysqlGrants(database),
    statistics: mysqlStatistics(database),
  }
}

function mysqlFolderPayload(connection: ConnectionProfile, database: string, section: string) {
  const base = mysqlDatabasePayload(connection, database)

  if (section === 'tables') {
    return { ...base, objectView: 'tables', views: [], indexes: [], procedures: [], functions: [], events: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'views') {
    return { ...base, objectView: 'views', tables: [], indexes: [], procedures: [], functions: [], events: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'procedures') {
    return { ...base, objectView: 'procedures', tables: [], views: [], indexes: [], functions: [], events: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'functions') {
    return { ...base, objectView: 'functions', tables: [], views: [], indexes: [], procedures: [], events: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'events') {
    return { ...base, objectView: 'events', tables: [], views: [], indexes: [], procedures: [], functions: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'triggers') {
    return { ...base, objectView: 'triggers', tables: [], views: [], indexes: [], procedures: [], functions: [], events: [], permissions: [], statistics: [] }
  }

  if (section === 'indexes') {
    return { ...base, objectView: 'indexes', tables: [], views: [], procedures: [], functions: [], events: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'storage') {
    return {
      ...base,
      objectView: 'storage',
      tables: [],
      views: [],
      indexes: [],
      procedures: [],
      functions: [],
      events: [],
      triggers: [],
      permissions: [],
      engines: [
        { name: 'InnoDB', support: 'default', transactions: 'yes', xa: 'yes', savepoints: 'yes' },
        { name: 'MEMORY', support: 'yes', transactions: 'no', xa: 'no', savepoints: 'no' },
      ],
    }
  }

  return base
}

function mysqlTablePayload(connection: ConnectionProfile, database: string, table: string, section: string) {
  const payload = {
    engine: connection.engine,
    database,
    schema: database,
    objectName: table,
    objectView: section === 'table' ? 'table' : section,
    rowCount: table === 'orders' ? 256 : 128,
    size: table === 'orders' ? '144 KB' : '80 KB',
    tables: mysqlTables(database).filter((row) => row.name === table),
    columns: [
      { name: 'id', type: 'bigint unsigned', nullable: false, default: '', identity: 'auto_increment', collation: '' },
      { name: 'name', type: 'varchar(160)', nullable: true, default: '', collation: 'utf8mb4_0900_ai_ci' },
      { name: 'updated_at', type: 'timestamp', nullable: false, default: 'current_timestamp', collation: '' },
    ],
    indexes: mysqlIndexes(table),
    constraints: [
      { name: 'PRIMARY', type: 'primary key', columns: 'id', status: 'enforced' },
    ],
    foreignKeys: table === 'orders'
      ? [{ id: 1, from: 'account_id', table: 'accounts', to: 'id', onUpdate: 'RESTRICT', onDelete: 'CASCADE' }]
      : [],
    triggers: [
      { name: `${table}_updated_at`, timing: 'before', event: 'update', enabled: true, function: 'sets updated_at' },
    ],
    partitions: [],
    statistics: mysqlStatistics(database).filter((row) => row.name === table),
    permissions: mysqlGrants(database).filter((row) => row.object === table),
    schemaObjects: [{
      type: 'table',
      name: table,
      tableName: table,
      definition: `create table ${mysqlIdentifier(table)} (id bigint unsigned primary key auto_increment, name varchar(160), updated_at timestamp not null default current_timestamp) engine=InnoDB`,
    }],
  }

  if (section === 'columns') {
    return { ...payload, tables: [], indexes: [], constraints: [], foreignKeys: [], triggers: [], partitions: [], statistics: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'indexes') {
    return { ...payload, tables: [], columns: [], constraints: [], foreignKeys: [], triggers: [], partitions: [], statistics: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'constraints') {
    return { ...payload, tables: [], columns: [], indexes: [], foreignKeys: [], triggers: [], partitions: [], statistics: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'foreign-keys') {
    return { ...payload, tables: [], columns: [], indexes: [], constraints: [], triggers: [], partitions: [], statistics: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'triggers') {
    return { ...payload, tables: [], columns: [], indexes: [], constraints: [], foreignKeys: [], partitions: [], statistics: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'statistics') {
    return { ...payload, tables: [], columns: [], indexes: [], constraints: [], foreignKeys: [], triggers: [], partitions: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'ddl') {
    return { ...payload, tables: [], columns: [], indexes: [], constraints: [], foreignKeys: [], triggers: [], partitions: [], statistics: [], permissions: [] }
  }

  return payload
}

function mysqlRoutinePayload(connection: ConnectionProfile, nodeId: string, fallbackDatabase: string) {
  const [kind = 'procedure', database = fallbackDatabase, objectName = 'routine'] = nodeId.split(':')
  const definition = mysqlRoutineDefinition(kind, database, objectName)
  const routine = {
    schema: database,
    name: objectName,
    arguments: kind === 'function' ? 'p_status varchar(40)' : 'in p_account_id bigint',
    returns: kind === 'function' ? 'varchar(120)' : '',
    language: 'sql',
    security: 'definer',
    definition,
  }

  return {
    engine: connection.engine,
    database,
    schema: database,
    objectName,
    objectView: kind,
    definition,
    ...(kind === 'function' ? { functions: [routine] } : {}),
    ...(kind === 'procedure' ? { procedures: [routine] } : {}),
    ...(kind === 'event' ? { events: [{ schema: database, name: objectName, status: 'enabled', schedule: 'every 1 day', definer: 'app@%' }] } : {}),
    ...(kind === 'trigger' ? { triggers: [{ name: objectName, timing: 'before', event: 'update', enabled: true, function: 'sets updated_at' }] } : {}),
    parameters: kind === 'event' || kind === 'trigger'
      ? []
      : [{ name: kind === 'function' ? 'p_status' : 'p_account_id', type: kind === 'function' ? 'varchar(40)' : 'bigint', mode: kind === 'function' ? 'in' : 'in', ordinal: 1 }],
    permissions: mysqlGrants(database).filter((row) => row.object === objectName),
  }
}

function mysqlRoutineDefinition(kind: string, database: string, objectName: string) {
  if (kind === 'function') {
    return [
      `create function ${mysqlIdentifier(database)}.${mysqlIdentifier(objectName)}(p_status varchar(40))`,
      'returns varchar(120)',
      'deterministic',
      'begin',
      "  return concat('status:', p_status);",
      'end',
    ].join('\n')
  }

  if (kind === 'trigger') {
    return [
      `create trigger ${mysqlIdentifier(database)}.${mysqlIdentifier(objectName)}`,
      'before update on accounts',
      'for each row',
      'set new.updated_at = current_timestamp;',
    ].join('\n')
  }

  if (kind === 'event') {
    return [
      `create event ${mysqlIdentifier(database)}.${mysqlIdentifier(objectName)}`,
      'on schedule every 1 day',
      'do call refresh_account_rollups();',
    ].join('\n')
  }

  return [
    `create procedure ${mysqlIdentifier(database)}.${mysqlIdentifier(objectName)}(in p_account_id bigint)`,
    'begin',
    '  select p_account_id as account_id;',
    'end',
  ].join('\n')
}

function mysqlSecurityPayload(connection: ConnectionProfile) {
  const isMariaDb = connection.engine === 'mariadb'
  return {
    engine: connection.engine,
    objectView: 'security',
    users: [
      { name: 'app', type: 'user', defaultSchema: connection.database || 'datapadplusplus', authenticationType: isMariaDb ? 'mysql_native_password' : 'caching_sha2_password' },
      { name: 'reporting', type: 'user', defaultSchema: connection.database || 'datapadplusplus', authenticationType: 'mysql_native_password' },
    ],
    roles: isMariaDb
      ? [
          { name: 'reporting_read', host: '%', login: 'role', inherit: 'yes', isRole: 'Y' },
          { name: 'app_writer', host: '%', login: 'role', inherit: 'yes', isRole: 'Y' },
        ]
      : [
          { name: 'readonly', login: 'no', inherit: 'yes', memberships: 'reporting' },
        ],
    roleMappings: isMariaDb
      ? [
          { name: 'reporting', host: '%', member: 'reporting_read', adminOption: 'N', memberships: 'reporting_read (N)' },
          { name: 'app', host: '%', member: 'app_writer', adminOption: 'Y', memberships: 'app_writer (Y)' },
        ]
      : [],
    permissions: mysqlGrants(connection.database || 'datapadplusplus'),
  }
}
