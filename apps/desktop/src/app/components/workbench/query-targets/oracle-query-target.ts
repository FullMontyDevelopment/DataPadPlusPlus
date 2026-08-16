import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'

export interface OracleObjectTarget {
  database?: string
  schema: string
  object: string
}

export interface OracleSchemaTarget {
  database?: string
  schema: string
}

export function parseOracleObjectTarget(scope: string | undefined): OracleObjectTarget | undefined {
  const parts = scope?.split(':') ?? []
  if (parts[0] !== 'oracle' || parts[1] !== 'object') {
    return undefined
  }

  if (parts[3] === 'database' && parts.length === 7) {
    return decodedTarget(parts[4], parts[5], parts[6])
  }
  if (parts[3] === 'schema' && parts.length === 6) {
    return decodedTarget(undefined, parts[4], parts[5])
  }
  if (parts.length === 5) {
    return decodedTarget(undefined, parts[3], parts[4])
  }
  return undefined
}

export function parseOracleSchemaTarget(scope: string | undefined): OracleSchemaTarget | undefined {
  const objectTarget = parseOracleObjectTarget(scope)
  if (objectTarget) {
    return {
      database: objectTarget.database,
      schema: objectTarget.schema,
    }
  }

  const parts = scope?.split(':') ?? []
  if (parts[0] === 'oracle' && parts[1] === 'category') {
    if (parts[2] === 'database' && parts.length === 6) {
      return decodedSchemaTarget(parts[3], parts[4])
    }
    if (parts[2] === 'schema' && parts.length === 5) {
      return decodedSchemaTarget(undefined, parts[3])
    }
  }
  if (parts[0] === 'oracle' && parts[1] === 'schema' && parts.length === 3) {
    return decodedSchemaTarget(undefined, parts[2])
  }
  if (parts[0] === 'schema' && parts.length === 2) {
    return decodedSchemaTarget(undefined, parts[1])
  }
  return undefined
}

export function oracleSchemaScope(schema: string) {
  return `schema:${encodeURIComponent(schema)}`
}

export function oracleStructureScope(
  connection: ConnectionProfile | undefined,
  tab: QueryTabState | undefined,
) {
  if (connection?.engine !== 'oracle' || !tab) {
    return undefined
  }
  const selectedSchema = tab.sqlScope?.schema?.trim()
  if (selectedSchema) {
    return oracleSchemaScope(selectedSchema)
  }
  const target = tab.scopedTarget
  if (!target) {
    return undefined
  }
  const scopedSchema = parseOracleSchemaTarget(target.scope)
  if (scopedSchema) {
    return oracleSchemaScope(scopedSchema.schema)
  }
  const schemaContainerIndex = target.path?.findIndex(
    (part) => part.trim().toLowerCase() === 'schemas',
  ) ?? -1
  const schema =
    target.kind === 'schema'
      ? target.label
      : schemaContainerIndex >= 0
        ? target.path?.[schemaContainerIndex + 1]
        : target.path?.length === 2
          ? target.path[0]
          : undefined
  return schema?.trim() ? oracleSchemaScope(schema.trim()) : undefined
}

function decodedTarget(
  database: string | undefined,
  schema: string | undefined,
  object: string | undefined,
): OracleObjectTarget | undefined {
  const decodedDatabase = database === undefined ? undefined : decodeScopeComponent(database)
  const decodedSchema = schema === undefined ? undefined : decodeScopeComponent(schema)
  const decodedObject = object === undefined ? undefined : decodeScopeComponent(object)

  if (!decodedSchema || !decodedObject || (database !== undefined && !decodedDatabase)) {
    return undefined
  }
  return {
    database: decodedDatabase,
    schema: decodedSchema,
    object: decodedObject,
  }
}

function decodedSchemaTarget(
  database: string | undefined,
  schema: string | undefined,
): OracleSchemaTarget | undefined {
  const decodedDatabase = database === undefined ? undefined : decodeScopeComponent(database)
  const decodedSchema = schema === undefined ? undefined : decodeScopeComponent(schema)
  if (!decodedSchema || (database !== undefined && !decodedDatabase)) {
    return undefined
  }
  return { database: decodedDatabase, schema: decodedSchema }
}

function decodeScopeComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}
