type JsonRecord = Record<string, unknown>

export function postgresSourceInspectQueryTemplate(
  nodeId: string,
  schema: string,
  objectName: string,
) {
  if (nodeId.startsWith('function:') && objectName) {
    return `select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = '${escapeSqlLiteral(schema)}' and p.proname = '${escapeSqlLiteral(objectName)}';`
  }

  if (nodeId.startsWith('procedure:') && objectName) {
    return `select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = '${escapeSqlLiteral(schema)}' and p.proname = '${escapeSqlLiteral(objectName)}' and p.prokind = 'p';`
  }

  return undefined
}

export function postgresSourceInspectPayload(
  base: JsonRecord,
  nodeId: string,
  schema: string,
  objectName: string,
) {
  if (nodeId.startsWith('view:') || nodeId.startsWith('materialized-view:')) {
    return postgresViewPayload(base, nodeId, schema, objectName)
  }

  if (nodeId.startsWith('function:')) {
    return postgresFunctionPayload(base, schema, objectName || 'account_status')
  }

  if (nodeId.startsWith('procedure:')) {
    return postgresProcedurePayload(base, schema, objectName || 'refresh_rollups')
  }

  return undefined
}

export function sqlServerSourceInspectQueryTemplate(
  nodeId: string,
  database: string,
  schema: string,
  objectName: string,
) {
  if ((nodeId.startsWith('procedure:') || nodeId.startsWith('function:')) && objectName) {
    return `use [${database}];\nselect sm.definition from sys.sql_modules sm join sys.objects so on so.object_id = sm.object_id join sys.schemas ss on ss.schema_id = so.schema_id where ss.name = N'${escapeSqlLiteral(schema)}' and so.name = N'${escapeSqlLiteral(objectName)}';`
  }

  return undefined
}

export function sqlServerSourceInspectPayload(
  base: JsonRecord,
  nodeId: string,
  schema: string,
  objectName: string,
) {
  if (nodeId.startsWith('view:')) {
    return sqlServerViewPayload(base, schema, objectName || 'active_accounts')
  }

  if (nodeId.startsWith('procedure:')) {
    return sqlServerProcedurePayload(base, schema, objectName || 'refresh_account_cache')
  }

  if (nodeId.startsWith('function:')) {
    return sqlServerFunctionPayload(base, schema, objectName || 'account_status')
  }

  return undefined
}

function postgresViewPayload(base: JsonRecord, nodeId: string, schema: string, objectName: string) {
  const viewName = objectName || 'active_accounts'
  const isMaterialized = nodeId.startsWith('materialized-view:')
  const definition = [
    `create ${isMaterialized ? 'materialized view' : 'view'} "${schema}"."${viewName}" as`,
    'select id, sku, updated_at',
    `from "${schema}"."accounts"`,
    "where status = 'active';",
  ].join('\n')

  return {
    ...base,
    definition,
    views: [{ schema, name: viewName, status: 'valid', definition, owner: 'app', rows: isMaterialized ? 128 : undefined }],
    dependencies: [{ schema, name: 'accounts', type: 'table', dependency: 'referenced by view definition' }],
    permissions: [{ principal: 'reporting', privilege: 'SELECT', object: `${schema}.${viewName}`, state: 'granted', grantor: schema }],
  }
}

function postgresFunctionPayload(base: JsonRecord, schema: string, functionName: string) {
  const definition = [
    `create or replace function "${schema}"."${functionName}"(p_account_id bigint)`,
    'returns text',
    'language plpgsql',
    'stable',
    'as $$',
    'begin',
    "  return 'active';",
    'end;',
    '$$;',
  ].join('\n')

  return {
    ...base,
    definition,
    functions: [{ schema, name: functionName, arguments: 'p_account_id bigint', returns: 'text', language: 'plpgsql', volatility: 'stable', definition }],
    parameters: [{ name: 'p_account_id', type: 'bigint', mode: 'in', ordinal: 1 }],
    dependencies: [{ schema, name: 'accounts', type: 'table', dependency: 'reads account state' }],
    permissions: [{ principal: 'app_reader', privilege: 'EXECUTE', object: `${schema}.${functionName}`, state: 'granted', grantor: schema }],
  }
}

function postgresProcedurePayload(base: JsonRecord, schema: string, procedureName: string) {
  const definition = [
    `create or replace procedure "${schema}"."${procedureName}"(p_force boolean default false)`,
    'language plpgsql',
    'as $$',
    'begin',
    '  refresh materialized view concurrently "public"."daily_rollups";',
    'end;',
    '$$;',
  ].join('\n')

  return {
    ...base,
    definition,
    procedures: [{ schema, name: procedureName, arguments: 'p_force boolean default false', language: 'plpgsql', definition }],
    parameters: [{ name: 'p_force', type: 'boolean', mode: 'in', default: 'false', ordinal: 1 }],
    dependencies: [{ schema: 'public', name: 'daily_rollups', type: 'materialized view', dependency: 'refresh target' }],
    permissions: [{ principal: 'app_operator', privilege: 'EXECUTE', object: `${schema}.${procedureName}`, state: 'granted', grantor: schema }],
  }
}

function sqlServerViewPayload(base: JsonRecord, schema: string, viewName: string) {
  const definition = [
    `create or alter view [${schema}].[${viewName}] as`,
    'select [id], [sku], [updated_at]',
    `from [${schema}].[accounts]`,
    "where [status] = N'active';",
  ].join('\n')

  return {
    ...base,
    definition,
    views: [{ schema, name: viewName, status: 'valid', definition, owner: schema }],
    dependencies: [{ schema, name: 'accounts', type: 'USER_TABLE', dependency: 'referenced by view definition' }],
    permissions: [{ principal: 'reporting', privilege: 'SELECT', object: `${schema}.${viewName}`, state: 'GRANT', grantor: 'dbo' }],
  }
}

function sqlServerProcedurePayload(base: JsonRecord, schema: string, procedureName: string) {
  const definition = [
    `create or alter procedure [${schema}].[${procedureName}]`,
    '  @account_id bigint = null',
    'as',
    'begin',
    '  set nocount on;',
    '  select @account_id as account_id;',
    'end;',
  ].join('\n')

  return {
    ...base,
    definition,
    procedures: [{ schema, name: procedureName, arguments: '@account_id bigint = null', language: 'T-SQL', definition, executeAs: 'CALLER' }],
    parameters: [{ name: '@account_id', type: 'bigint', mode: 'IN', hasDefault: true, ordinal: 1 }],
    dependencies: [{ schema, name: 'accounts', type: 'USER_TABLE', dependency: 'optional lookup target' }],
    permissions: [{ principal: 'app_executor', privilege: 'EXECUTE', object: `${schema}.${procedureName}`, state: 'GRANT', grantor: 'dbo' }],
  }
}

function sqlServerFunctionPayload(base: JsonRecord, schema: string, functionName: string) {
  const definition = [
    `create or alter function [${schema}].[${functionName}](@account_id bigint)`,
    'returns nvarchar(32)',
    'as',
    'begin',
    "  return N'active';",
    'end;',
  ].join('\n')

  return {
    ...base,
    definition,
    functions: [{ schema, name: functionName, arguments: '@account_id bigint', returns: 'nvarchar(32)', language: 'T-SQL', definition }],
    parameters: [{ name: '@account_id', type: 'bigint', mode: 'IN', ordinal: 1 }],
    dependencies: [{ schema, name: 'accounts', type: 'USER_TABLE', dependency: 'reads account state' }],
    permissions: [{ principal: 'app_executor', privilege: 'EXECUTE', object: `${schema}.${functionName}`, state: 'GRANT', grantor: 'dbo' }],
  }
}

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''")
}
