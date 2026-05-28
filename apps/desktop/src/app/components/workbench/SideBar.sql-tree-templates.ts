import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export function qualifySqlName(connection: ConnectionProfile, schema: string, objectName: string) {
  if (connection.engine === 'sqlite') {
    return `[${schema}].[${objectName}]`
  }

  if (connection.engine === 'oracle') {
    return `"${schema.replace(/"/g, '""')}"."${objectName.replace(/"/g, '""')}"`
  }

  return `${schema}.${objectName}`
}

export function sqlColumnsQuery(connection: ConnectionProfile, schema: string, table: string) {
  if (connection.engine === 'sqlite') {
    return `pragma table_info(${table});`
  }

  if (connection.engine === 'oracle') {
    return `select column_name, data_type, nullable, data_default\nfrom all_tab_columns\nwhere owner = '${schema}' and table_name = '${table}'\norder by column_id;`
  }

  return `select column_name, data_type, is_nullable\nfrom information_schema.columns\nwhere table_schema = '${schema}' and table_name = '${table}'\norder by ordinal_position;`
}

export function sqlIndexesQuery(connection: ConnectionProfile, schema: string, table: string) {
  if (connection.engine === 'sqlite') {
    return `pragma index_list(${table});`
  }

  if (connection.engine === 'sqlserver') {
    return `select i.name, i.type_desc, i.is_unique\nfrom sys.indexes i\njoin sys.objects o on i.object_id = o.object_id\njoin sys.schemas s on o.schema_id = s.schema_id\nwhere s.name = '${schema}' and o.name = '${table}';`
  }

  if (connection.engine === 'oracle') {
    return `select index_name, uniqueness, status, visibility\nfrom all_indexes\nwhere owner = '${schema}' and table_name = '${table}'\norder by index_name;`
  }

  return `select indexname, indexdef\nfrom pg_indexes\nwhere schemaname = '${schema}' and tablename = '${table}';`
}

export function sqlViewDefinitionQuery(connection: ConnectionProfile, schema: string, view: string) {
  if (connection.engine === 'sqlite') {
    return `select sql from sqlite_master where type in ('view', 'table') and name = '${view}';`
  }

  if (connection.engine === 'oracle') {
    return `select text\nfrom all_views\nwhere owner = '${schema}' and view_name = '${view}';`
  }

  return `select view_definition\nfrom information_schema.views\nwhere table_schema = '${schema}' and table_name = '${view}';`
}

export function sqlRebuildIndexQuery(connection: ConnectionProfile, indexName: string) {
  if (connection.engine === 'sqlserver') {
    return `alter index ${indexName} rebuild;`
  }

  if (connection.engine === 'sqlite') {
    return `reindex ${indexName};`
  }

  if (connection.engine === 'oracle') {
    return `alter index ${indexName} rebuild;`
  }

  return `reindex index ${indexName};`
}

export function sqlCreateIndexTemplate(connection: ConnectionProfile, schema: string) {
  if (connection.engine === 'oracle') {
    return `create index ${qualifySqlName(connection, schema, 'idx_table_name_column_name')}\non ${qualifySqlName(connection, schema, 'table_name')} (column_name);`
  }

  return `create index idx_new_table_new_column on ${qualifySqlName(connection, schema, 'table_name')} (column_name);`
}

export function sqlAddColumnTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'oracle') {
    return `alter table ${qualified} add (new_column varchar2(255));`
  }

  return `alter table ${qualified} add column new_column text;`
}

export function sqlDropColumnTemplate(connection: ConnectionProfile, qualified: string, column: string) {
  if (connection.engine === 'oracle') {
    return `-- Review before running.\nalter table ${qualified} drop column ${column};`
  }

  return `-- Review before running.\nalter table ${qualified} drop column ${column};`
}

export function sqlDropTableTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'oracle') {
    return `-- Review before running.\ndrop table ${qualified} purge;`
  }

  return `-- Review before running.\ndrop table ${qualified};`
}

export function sqlCreateStoredProcedureTemplate(
  connection: ConnectionProfile,
  schema: string,
  procedureName = 'new_procedure',
) {
  const qualified = qualifySqlName(connection, schema, procedureName)

  if (connection.engine === 'sqlserver') {
    return `create procedure ${qualified}\nas\nbegin\n  set nocount on;\n  select 1 as value;\nend;`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `delimiter //\ncreate procedure ${qualified}()\nbegin\n  select 1 as value;\nend//\ndelimiter ;`
  }

  if (connection.engine === 'oracle') {
    return `create or replace procedure ${qualified} as\nbegin\n  null;\nend;`
  }

  return `create or replace procedure ${qualified}()\nlanguage plpgsql\nas $$\nbegin\n  raise notice 'new_procedure ran';\nend;\n$$;`
}

export function sqlCreateFunctionTemplate(
  connection: ConnectionProfile,
  schema: string,
  functionName = 'new_function',
) {
  const qualified = qualifySqlName(connection, schema, functionName)

  if (connection.engine === 'sqlserver') {
    return `create function ${qualified}()\nreturns int\nas\nbegin\n  return 1;\nend;`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `create function ${qualified}()\nreturns int deterministic\nreturn 1;`
  }

  if (connection.engine === 'oracle') {
    return `create or replace function ${qualified}\nreturn number\nas\nbegin\n  return 1;\nend;`
  }

  return `create or replace function ${qualified}()\nreturns integer\nlanguage sql\nas $$\n  select 1;\n$$;`
}

export function sqlCreateTriggerTemplate(connection: ConnectionProfile, schema: string) {
  const tableName = qualifySqlName(connection, schema, 'table_name')

  if (connection.engine === 'sqlserver') {
    return `create trigger ${qualifySqlName(connection, schema, 'new_trigger')}\non ${tableName}\nafter insert\nas\nbegin\n  set nocount on;\nend;`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `create trigger ${qualifySqlName(connection, schema, 'new_trigger')}\nbefore insert on ${tableName}\nfor each row\nbegin\n  set new.created_at = coalesce(new.created_at, current_timestamp);\nend;`
  }

  if (connection.engine === 'oracle') {
    return `create or replace trigger ${qualifySqlName(connection, schema, 'new_trigger')}\nbefore insert on ${tableName}\nfor each row\nbegin\n  null;\nend;`
  }

  return `create trigger new_trigger\nbefore insert on ${tableName}\nfor each row\nexecute function ${qualifySqlName(connection, schema, 'trigger_function')}();`
}

export function sqlCreateTypeTemplate(connection: ConnectionProfile, schema: string) {
  if (connection.engine === 'sqlserver') {
    return `create type ${qualifySqlName(connection, schema, 'new_table_type')} as table (\n  id int not null\n);`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb' || connection.engine === 'sqlite') {
    return `-- ${connection.engine} does not expose standalone user-defined types like PostgreSQL.\n-- Use enum/check constraints or table definitions instead.`
  }

  if (connection.engine === 'oracle') {
    return `create or replace type ${qualifySqlName(connection, schema, 'new_object_type')} as object (\n  id number,\n  name varchar2(255)\n);`
  }

  return `create type ${qualifySqlName(connection, schema, 'new_status')} as enum ('active', 'inactive');`
}

export function sqlCreatePackageTemplate(connection: ConnectionProfile, schema: string) {
  if (connection.engine !== 'oracle') {
    return sqlCreateStoredProcedureTemplate(connection, schema)
  }

  const qualified = qualifySqlName(connection, schema, 'new_package')
  return `create or replace package ${qualified} as\n  function ping return varchar2;\nend;\n/\ncreate or replace package body ${qualified} as\n  function ping return varchar2 as\n  begin\n    return 'pong';\n  end;\nend;\n/`
}

export function sqlSelectFunctionTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'oracle') {
    return `select ${qualified}() as value from dual;`
  }

  return `select * from ${qualified}();`
}

export function sqlPackageErrorsQuery(connection: ConnectionProfile, schema: string, packageName: string) {
  if (connection.engine === 'oracle') {
    return `select name, type, line, position, text\nfrom all_errors\nwhere owner = '${schema}' and name = '${packageName}'\norder by sequence;`
  }

  return `select 1;`
}

export function sqlExecuteStoredProcedureTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'sqlserver') {
    return `exec ${qualified};`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `call ${qualified}();`
  }

  return `call ${qualified}();`
}

export function sqlAlterStoredProcedureTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'sqlserver') {
    return `alter procedure ${qualified}\nas\nbegin\n  set nocount on;\n  select 1 as value;\nend;`
  }

  return `-- Edit and review before running.\n${sqlCreateStoredProcedureTemplate(connection, defaultSqlSchema(connection), qualified.split('.').at(-1) ?? 'new_procedure')}`
}

export function sqlDropStoredProcedureTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'sqlserver') {
    return `-- Review before running.\ndrop procedure ${qualified};`
  }

  return `-- Review before running.\ndrop procedure ${qualified};`
}

function defaultSqlSchema(connection: ConnectionProfile) {
  if (connection.engine === 'sqlite' || connection.engine === 'duckdb') {
    return 'main'
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return connection.database || 'default'
  }

  if (connection.engine === 'sqlserver') {
    return 'dbo'
  }

  return 'public'
}
