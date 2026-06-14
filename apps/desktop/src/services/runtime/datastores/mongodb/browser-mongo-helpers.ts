import type { ExplorerNode } from '@datapadplusplus/shared-types'

interface MongoObjectScope {
  databaseName?: string
  objectName: string
}

interface MongoCollectionAdminScope extends MongoObjectScope {
  operation: string
}

export function documentExplorerNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return {
    family: 'document',
    ...node,
  }
}

export function parseMongoObjectScope(scope: string, prefix: string, fallbackDatabase: string) {
  const rest = scope.replace(prefix, '')
  const [databasePart = '', ...objectParts] = rest.split(':')

  if (!objectParts.length) {
    return {
      databaseName: fallbackDatabase,
      objectName: databasePart.trim(),
    }
  }

  return {
    databaseName: databasePart || fallbackDatabase,
    objectName: objectParts.join(':').trim(),
  }
}

export function parseMongoObjectScopeStrict(
  scope: string,
  prefix: string,
  fallbackDatabase?: string,
): MongoObjectScope | undefined {
  if (!scope.startsWith(prefix)) return undefined

  const parts = scope
    .slice(prefix.length)
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean)
  const database = fallbackDatabase?.trim()

  if (parts.length >= 2) {
    return {
      databaseName: parts[0]!,
      objectName: parts.slice(1).join(':'),
    }
  }

  if (parts.length === 1) {
    return {
      databaseName: database,
      objectName: parts[0]!,
    }
  }

  return undefined
}

export function parseMongoCollectionAdminScope(
  scope: string,
  fallbackDatabase?: string,
): MongoCollectionAdminScope | undefined {
  if (!scope.startsWith('collection-admin:')) return undefined

  const parts = scope
    .slice('collection-admin:'.length)
    .split(':')
    .map((part) => part.trim())
  const operation = parts.shift()
  const database = fallbackDatabase?.trim()

  if (!operation) {
    return undefined
  }

  if (parts.length >= 2) {
    return {
      operation,
      databaseName: parts[0] || database,
      objectName: parts.slice(1).join(':'),
    }
  }

  if (parts.length === 1 && parts[0]) {
    return {
      operation,
      databaseName: database,
      objectName: parts[0],
    }
  }

  return undefined
}

export function parseMongoDatabaseScope(scope: string, prefix: string, fallbackDatabase?: string) {
  if (!scope.startsWith(prefix)) return undefined

  const database = scope.slice(prefix.length).trim() || fallbackDatabase?.trim()
  return database || undefined
}

export function documentFindTemplate(database: string | undefined, collection: string, limit = 20) {
  return JSON.stringify(
    {
      ...(database ? { database } : {}),
      collection,
      filter: {},
      limit,
    },
    null,
    2,
  )
}

export function mongoAggregationTemplate(database: string | undefined, collection: string) {
  return JSON.stringify(
    {
      ...(database ? { database } : {}),
      collection,
      pipeline: [{ $match: {} }, { $limit: 20 }],
    },
    null,
    2,
  )
}

export function mongoCommandTemplate(database: string | undefined, command: Record<string, unknown>) {
  return JSON.stringify(
    {
      ...(database ? { database } : {}),
      command,
    },
    null,
    2,
  )
}
