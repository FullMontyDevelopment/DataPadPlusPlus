import type {
  ConnectionProfile,
  QueryBuilderState,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { isMongoAggregationBuilderState } from './mongo-aggregation'
import { isMongoFindBuilderState } from './mongo-find'

export interface MongoQueryScope {
  database?: string
  collection?: string
}

export function mongoQueryScopeForTab({
  builderState,
  connection,
  queryText,
  scriptText,
  tab,
}: {
  builderState?: QueryBuilderState
  connection?: ConnectionProfile
  queryText?: string
  scriptText?: string
  tab?: QueryTabState
}): MongoQueryScope | undefined {
  if (connection?.engine !== 'mongodb' || !tab) {
    return undefined
  }

  const builderCollection = mongoBuilderCollection(builderState ?? tab.builderState)
  const queryScope = mongoScopeFromQueryText(queryText ?? tab.queryText)
  const scriptScope = mongoScopeFromScriptText(scriptText ?? tab.scriptText)
  const scopedTargetScope = mongoScopeFromScopedTarget(tab.scopedTarget)
  const connectionDatabase = connection.database?.trim() || undefined

  return {
    database:
      queryScope.database ??
      scopedTargetScope.database ??
      connectionDatabase,
    collection:
      builderCollection ??
      queryScope.collection ??
      scriptScope.collection ??
      scopedTargetScope.collection,
  }
}

function mongoBuilderCollection(builderState?: QueryBuilderState) {
  if (
    isMongoFindBuilderState(builderState) ||
    isMongoAggregationBuilderState(builderState)
  ) {
    return builderState.collection.trim() || undefined
  }

  return undefined
}

function mongoScopeFromQueryText(queryText: string | undefined): MongoQueryScope {
  if (!queryText?.trim()) {
    return {}
  }

  try {
    return mongoScopeFromQueryValue(JSON.parse(queryText))
  } catch {
    return {}
  }
}

function mongoScopeFromQueryValue(value: unknown): MongoQueryScope {
  if (!isRecord(value)) {
    return {}
  }

  const command = isRecord(value.command) ? value.command : undefined

  return {
    database: stringValue(value.database) ?? stringValue(value.db) ?? stringValue(command?.db),
    collection:
      stringValue(value.collection) ??
      stringValue(value.find) ??
      stringValue(value.aggregate) ??
      stringValue(value.count) ??
      stringValue(value.countDocuments) ??
      stringValue(value.distinct) ??
      stringValue(command?.collection) ??
      stringValue(command?.find) ??
      stringValue(command?.aggregate) ??
      stringValue(command?.count) ??
      stringValue(command?.countDocuments) ??
      stringValue(command?.distinct),
  }
}

function mongoScopeFromScriptText(scriptText: string | undefined): MongoQueryScope {
  if (!scriptText?.trim()) {
    return {}
  }

  const getCollectionMatch = /db\.getCollection\(\s*['"`]([^'"`]+)['"`]\s*\)/.exec(scriptText)

  if (getCollectionMatch?.[1]) {
    return { collection: getCollectionMatch[1] }
  }

  const dottedCollectionMatch = /db\.([A-Za-z_$][\w$]*)\s*\./.exec(scriptText)
  return dottedCollectionMatch?.[1] ? { collection: dottedCollectionMatch[1] } : {}
}

function mongoScopeFromScopedTarget(target: ScopedQueryTarget | undefined): MongoQueryScope {
  if (!target) {
    return {}
  }

  const scopeParts = target.scope?.split(':').filter(Boolean) ?? []

  const scopeKind = scopeParts[0]
  if (
    scopeParts.length >= 3 &&
    scopeKind &&
    ['collection', 'aggregation', 'view'].includes(scopeKind)
  ) {
    return {
      database: scopeParts[1],
      collection: scopeParts.slice(2).join(':'),
    }
  }

  const path = target.path ?? []
  const collectionContainerIndex = firstExistingIndex(path, ['Collections', 'Views', 'GridFS'])

  if (collectionContainerIndex > 0 && path[collectionContainerIndex + 1]) {
    return {
      database: path[collectionContainerIndex - 1],
      collection: path[collectionContainerIndex + 1],
    }
  }

  return {}
}

function firstExistingIndex(values: string[], candidates: string[]) {
  for (const candidate of candidates) {
    const index = values.indexOf(candidate)

    if (index >= 0) {
      return index
    }
  }

  return -1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
