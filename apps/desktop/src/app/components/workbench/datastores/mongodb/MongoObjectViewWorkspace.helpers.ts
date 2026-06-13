import type {
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'

export type JsonRecord = Record<string, unknown>

export function queryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state?.queryTemplate) {
    return undefined
  }

  return {
    kind: state.kind,
    label: state.label,
    path: state.path,
    queryTemplate: state.queryTemplate,
    preferredBuilder: mongoObjectViewPreferredBuilder(state.kind),
  }
}

function mongoObjectViewPreferredBuilder(kind: string): ScopedQueryTarget['preferredBuilder'] {
  if (kind === 'aggregations') {
    return 'mongo-aggregation'
  }

  if (
    [
      'collection',
      'documents',
      'gridfs-collection',
      'view-results',
      'sample-results',
    ].includes(kind)
  ) {
    return 'mongo-find'
  }

  return undefined
}

export function objectViewWarnings(tab: QueryTabState, payload: JsonRecord) {
  return [
    ...(tab.objectViewState?.warnings ?? []),
    ...(tab.error?.message ? [tab.error.message] : []),
    ...(typeof payload.warning === 'string' ? [payload.warning] : []),
  ].filter(Boolean)
}

export function mongoObjectViewPayloadWithScope(
  payload: JsonRecord,
  state: QueryTabState['objectViewState'],
) {
  const scope = mongoScopeFromObjectViewState(state)
  if (!scope.database && !scope.collection) {
    return payload
  }

  return {
    ...payload,
    ...(scope.database && !payload.database ? { database: scope.database } : {}),
    ...(scope.collection && !payload.collection ? { collection: scope.collection } : {}),
  }
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function stringValue(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  return compactJson(value)
}

function mongoScopeFromObjectViewState(state: QueryTabState['objectViewState']) {
  const nodeId = state?.nodeId ?? ''
  const knownPrefixes = [
    'insert-document:',
    'create-index:',
    'collection:',
    'documents:',
    'indexes:',
    'schema-preview:',
    'validation-rules:',
    'collection-statistics:',
    'collection-permissions:',
    'collection-scripts:',
    'aggregations:',
  ]
  const matchedPrefix = knownPrefixes.find((prefix) => nodeId.startsWith(prefix))
  if (matchedPrefix) {
    const rest = nodeId.slice(matchedPrefix.length)
    const [database = '', ...collectionParts] = rest.split(':')
    const collection = collectionParts.join(':')
    return {
      database: database || mongoDatabaseFromPath(state?.path),
      collection: collection || mongoCollectionFromPath(state?.path),
    }
  }

  return {
    database: mongoDatabaseFromPath(state?.path),
    collection: mongoCollectionFromPath(state?.path),
  }
}

function mongoDatabaseFromPath(path: string[] | undefined) {
  if (!path?.length) {
    return ''
  }

  const collectionsIndex = path.indexOf('Collections')
  if (collectionsIndex > 0) {
    return path[collectionsIndex - 1] ?? ''
  }

  const viewsIndex = path.indexOf('Views')
  if (viewsIndex > 0) {
    return path[viewsIndex - 1] ?? ''
  }

  return path[0] ?? ''
}

function mongoCollectionFromPath(path: string[] | undefined) {
  if (!path?.length) {
    return ''
  }

  const collectionsIndex = path.indexOf('Collections')
  if (collectionsIndex >= 0) {
    return path[collectionsIndex + 1] ?? path.at(-1) ?? ''
  }

  return path.length > 1 ? path.at(-1) ?? '' : ''
}

function compactJson(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
