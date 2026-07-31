export interface OracleObjectTarget {
  database?: string
  schema: string
  object: string
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

function decodeScopeComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}
