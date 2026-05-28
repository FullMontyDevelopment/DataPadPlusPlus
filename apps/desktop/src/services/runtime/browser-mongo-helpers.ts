import type { ExplorerNode } from '@datapadplusplus/shared-types'

export function documentExplorerNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return {
    family: 'document',
    ...node,
  }
}

export function parseMongoObjectScope(scope: string, prefix: string, fallbackDatabase: string) {
  const rest = scope.replace(prefix, '')
  const [databasePart, ...objectParts] = rest.split(':')
  const firstPart = databasePart || fallbackDatabase

  if (!objectParts.length) {
    return {
      databaseName: fallbackDatabase,
      objectName: firstPart,
    }
  }

  return {
    databaseName: databasePart || fallbackDatabase,
    objectName: objectParts.join(':') || firstPart,
  }
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
