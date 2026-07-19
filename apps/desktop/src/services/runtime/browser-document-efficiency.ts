import type {
  DocumentNodeChildrenRequest,
  DocumentNodeChildrenResponse,
  ExecutionResultEnvelope,
  ResultPayload,
} from '@datapadplusplus/shared-types'

export function summarizeDocumentResultForEfficiencyMode(
  result: ExecutionResultEnvelope,
): ExecutionResultEnvelope {
  const payloads = result.payloads.map((payload) => {
    if (payload.renderer !== 'document') {
      return payload
    }

    return {
      ...payload,
      hydrationMode: 'lazy' as const,
      documents: payload.documents.map((document) => summarizeDocumentTopLevel(document)),
    }
  })

  return { ...result, payloads }
}

export function fetchDocumentNodeChildrenFromResult(
  result: ExecutionResultEnvelope | undefined,
  request: DocumentNodeChildrenRequest,
): DocumentNodeChildrenResponse {
  const documentPayload = result?.payloads.find(
    (payload): payload is Extract<ResultPayload, { renderer: 'document' }> =>
      payload.renderer === 'document',
  )
  const document = documentPayload?.documents.find((item) =>
    documentIdsEqual(item._id, request.documentId),
  )

  if (!document) {
    throw new Error('Document is no longer available in the loaded result.')
  }

  const currentValue = valueAtPath(document, request.path)
  if (isLazyMarker(currentValue)) {
    throw new Error(
      'Preview mode contains only the summarized field. Use a live desktop MongoDB connection to load its children.',
    )
  }
  if (currentValue === undefined) {
    throw new Error('The selected field is no longer available in the loaded result.')
  }

  return {
    tabId: request.tabId,
    documentId: request.documentId,
    path: request.path,
    value: summarizeValueForLazyHydration(currentValue, request.path),
    notices: [],
  }
}

function summarizeDocumentTopLevel(document: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(document).map(([key, value]) => [
      key,
      key === '_id' ? value : summarizeNestedValue(value, [key]),
    ]),
  )
}

function summarizeValueForLazyHydration(value: unknown, path: Array<string | number>): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => summarizeValueForLazyHydration(item, [...path, index]))
  }

  if (isPlainRecord(value)) {
    if (isBsonScalarRecord(value)) {
      return value
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [
        key,
        summarizeNestedValue(childValue, [...path, key]),
      ]),
    )
  }

  return value
}

function summarizeNestedValue(value: unknown, path: Array<string | number>): unknown {
  if (Array.isArray(value)) {
    return {
      __datapadLazyNode: true,
      type: 'array',
      childCount: value.length,
      path,
      loaded: false,
    }
  }

  if (isPlainRecord(value)) {
    if (isBsonScalarRecord(value)) {
      return value
    }

    return {
      __datapadLazyNode: true,
      type: 'object',
      childCount: Object.keys(value).length,
      path,
      loaded: false,
    }
  }

  return value
}

function valueAtPath(value: unknown, path: Array<string | number>) {
  let current = value

  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined
    }

    if (Array.isArray(current)) {
      const index = arrayIndexFromPathKey(key)
      current = index === undefined ? undefined : current[index]
      continue
    }

    if (!isPlainRecord(current)) {
      return undefined
    }

    current = current[String(key)]
  }

  return current
}

function documentIdsEqual(left: unknown, right: unknown) {
  return valuesEqual(left, right)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false
    }

    return left.every((item, index) => valuesEqual(item, right[index]))
  }

  if (!isPlainRecord(left) || !isPlainRecord(right)) {
    return false
  }

  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()

  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  return leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(left[key], right[key]))
}

function arrayIndexFromPathKey(key: string | number) {
  if (typeof key === 'number') {
    return Number.isInteger(key) && key >= 0 ? key : undefined
  }

  if (!/^\d+$/.test(key)) {
    return undefined
  }

  return Number(key)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isBsonScalarRecord(value: Record<string, unknown>) {
  const entries = Object.entries(value)

  if (entries.length !== 1) {
    return false
  }

  const entry = entries[0]

  if (!entry) {
    return false
  }

  const [key, child] = entry

  if (
    [
      '$oid',
      '$numberInt',
      '$numberLong',
      '$numberDouble',
      '$numberDecimal',
      '$uuid',
      '$symbol',
    ].includes(key)
  ) {
    return typeof child === 'string'
  }

  if (key === '$date') {
    return typeof child === 'string' || (isPlainRecord(child) && typeof child.$numberLong === 'string')
  }

  if (['$binary', '$regularExpression', '$timestamp', '$dbPointer'].includes(key)) {
    return isPlainRecord(child)
  }

  if (key === '$minKey' || key === '$maxKey') {
    return typeof child === 'number'
  }

  return key === '$undefined' && typeof child === 'boolean'
}

function isLazyMarker(value: unknown): value is { type: 'object' | 'array' } {
  return isPlainRecord(value) && value.__datapadLazyNode === true
}
