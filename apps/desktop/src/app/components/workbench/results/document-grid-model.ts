import { bsonScalarInfo } from './document-bson-values'

export type DocumentValueType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'objectid'
  | 'uuid'
  | 'date'
  | 'decimal'
  | 'binary'
  | 'regex'
  | 'timestamp'

export interface DocumentGridRow {
  id: string
  depth: number
  label: string
  fieldPath: string
  type: DocumentValueType
  valueLabel: string
  value: unknown
  expandable: boolean
  lazy: boolean
  childCount?: number
  documentIndex: number
  parentPath: Array<string | number>
  path: Array<string | number>
}

export interface DocumentLazyNode {
  __datapadLazyNode: true
  type: 'object' | 'array'
  childCount: number
  path: Array<string | number>
  loaded?: false
}

export interface DocumentValueEntry {
  label: string
  pathSegment: string | number
  value: unknown
}

export interface DocumentTreeIndex {
  rowCount: number
  rowAt(index: number): DocumentGridRow | undefined
}

const DOCUMENT_INLINE_PREVIEW_LIMIT = 2_048

export function buildRows(documents: Array<Record<string, unknown>>, expandedRows: Set<string>) {
  const rows: DocumentGridRow[] = []

  documents.forEach((document, index) => {
    const rootId = documentRowId(index, [])
    const rootLabel = documentRootLabel(document, index)
    rows.push(rowForValue(rootId, index, 0, rootLabel, '_id', document, [], []))

    if (expandedRows.has(rootId)) {
      rows.push(...childRows(document, index, 1, [], expandedRows))
    }
  })

  return rows
}

export function createDocumentTreeIndex(
  documents: Array<Record<string, unknown>>,
  expandedRows: Set<string>,
  visibleRowIds?: Set<string>,
): DocumentTreeIndex {
  const countCache = new Map<string, number>()
  documents.forEach((document, documentIndex) => {
    countVisibleRows(
      document,
      documentIndex,
      [],
      expandedRows,
      visibleRowIds,
      countCache,
    )
  })
  return documentTreeIndexFromCounts(documents, expandedRows, countCache)
}

export async function createDocumentTreeIndexCooperative(
  documents: Array<Record<string, unknown>>,
  expandedRows: Set<string>,
  signal?: AbortSignal,
): Promise<DocumentTreeIndex> {
  const countCache = new Map<string, number>()
  const stack = documents
    .map((document, documentIndex) => ({
      documentIndex,
      expanded: false,
      path: [] as Array<string | number>,
      value: document as unknown,
    }))
    .reverse()
  let visited = 0

  while (stack.length > 0) {
    if (signal?.aborted) {
      throw new DOMException('Document indexing was cancelled.', 'AbortError')
    }

    const current = stack.pop()
    if (!current) {
      break
    }
    const id = documentRowId(current.documentIndex, current.path)

    if (
      !current.expanded &&
      expandedRows.has(id) &&
      isExpandableValue(current.value)
    ) {
      stack.push({ ...current, expanded: true })
      const entries = valueEntries(current.value)
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (entry) {
          stack.push({
            documentIndex: current.documentIndex,
            expanded: false,
            path: [...current.path, entry.pathSegment],
            value: entry.value,
          })
        }
      }
    } else {
      let count = 1
      if (current.expanded && isExpandableValue(current.value)) {
        count += valueEntries(current.value).reduce(
          (total, entry) =>
            total +
            (countCache.get(
              documentRowId(current.documentIndex, [
                ...current.path,
                entry.pathSegment,
              ]),
            ) ?? 0),
          0,
        )
      }
      countCache.set(id, count)
    }

    visited += 1
    if (visited % 400 === 0) {
      await yieldToRenderer()
    }
  }

  return documentTreeIndexFromCounts(documents, expandedRows, countCache)
}

function countVisibleRows(
  value: unknown,
  documentIndex: number,
  path: Array<string | number>,
  expandedRows: Set<string>,
  visibleRowIds: Set<string> | undefined,
  countCache: Map<string, number>,
): number {
  const id = documentRowId(documentIndex, path)
  if (visibleRowIds && !visibleRowIds.has(id)) {
    countCache.set(id, 0)
    return 0
  }

  let count = 1
  if (expandedRows.has(id) && isExpandableValue(value)) {
    for (const entry of valueEntries(value)) {
      count += countVisibleRows(
        entry.value,
        documentIndex,
        [...path, entry.pathSegment],
        expandedRows,
        visibleRowIds,
        countCache,
      )
    }
  }
  countCache.set(id, count)
  return count
}

function documentTreeIndexFromCounts(
  documents: Array<Record<string, unknown>>,
  expandedRows: Set<string>,
  countCache: Map<string, number>,
): DocumentTreeIndex {
  const starts: number[] = []
  let rowCount = 0

  documents.forEach((_document, documentIndex) => {
    starts.push(rowCount)
    rowCount += countCache.get(documentRowId(documentIndex, [])) ?? 0
  })

  return {
    rowCount,
    rowAt(index) {
      if (!Number.isInteger(index) || index < 0 || index >= rowCount) {
        return undefined
      }

      const documentIndex = documentIndexAtRow(starts, index)
      const document = documents[documentIndex]
      if (!document) {
        return undefined
      }
      return rowAtVisibleOffset(
        document,
        documentIndex,
        [],
        index - (starts[documentIndex] ?? 0),
        expandedRows,
        countCache,
      )
    },
  }
}

function documentIndexAtRow(starts: number[], rowIndex: number) {
  let low = 0
  let high = starts.length - 1
  let match = 0

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if ((starts[middle] ?? 0) <= rowIndex) {
      match = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return match
}

function rowAtVisibleOffset(
  value: unknown,
  documentIndex: number,
  path: Array<string | number>,
  offset: number,
  expandedRows: Set<string>,
  countCache: Map<string, number>,
): DocumentGridRow | undefined {
  const id = documentRowId(documentIndex, path)
  if ((countCache.get(id) ?? 0) === 0) {
    return undefined
  }
  const document = path.length === 0
    ? value as Record<string, unknown>
    : undefined
  const label = path.length === 0
    ? documentRootLabel(document ?? {}, documentIndex)
    : typeof path.at(-1) === 'number'
      ? `[${path.at(-1)}]`
      : String(path.at(-1))

  if (offset === 0) {
    return rowForValue(
      id,
      documentIndex,
      path.length,
      label,
      path.length === 0 ? '_id' : pathToFieldPath(path),
      value,
      path.slice(0, -1),
      path,
    )
  }
  if (!expandedRows.has(id) || !isExpandableValue(value)) {
    return undefined
  }

  let remaining = offset - 1
  for (const entry of valueEntries(value)) {
    const childPath = [...path, entry.pathSegment]
    const childCount =
      countCache.get(documentRowId(documentIndex, childPath)) ?? 0
    if (remaining < childCount) {
      return rowAtVisibleOffset(
        entry.value,
        documentIndex,
        childPath,
        remaining,
        expandedRows,
        countCache,
      )
    }
    remaining -= childCount
  }

  return undefined
}

export function collectExpandableRowIds(documents: Array<Record<string, unknown>>): string[] {
  const ids: string[] = []

  documents.forEach((document, index) => {
    const rootId = documentRowId(index, [])
    ids.push(rootId)
    collectExpandableChildren(document, index, [], ids)
  })

  return ids
}

export async function collectExpandableRowIdsCooperative(
  documents: Array<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<string[]> {
  const ids: string[] = []
  const stack = documents
    .map((document, documentIndex) => ({
      documentIndex,
      path: [] as Array<string | number>,
      value: document as unknown,
    }))
    .reverse()
  let visited = 0

  while (stack.length > 0) {
    if (signal?.aborted) {
      throw new DOMException('Expand all was cancelled.', 'AbortError')
    }

    const current = stack.pop()
    if (!current) {
      break
    }

    if (current.path.length === 0 || isExpandableValue(current.value)) {
      ids.push(documentRowId(current.documentIndex, current.path))
    }

    if (isExpandableValue(current.value)) {
      const entries = valueEntries(current.value)
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (entry && isExpandableValue(entry.value)) {
          stack.push({
            documentIndex: current.documentIndex,
            path: [...current.path, entry.pathSegment],
            value: entry.value,
          })
        }
      }
    }

    visited += 1
    if (visited % 400 === 0) {
      await yieldToRenderer()
    }
  }

  return ids
}

export function rowAtDocumentRowId(
  documents: Array<Record<string, unknown>>,
  rowId: string,
): DocumentGridRow | undefined {
  const match = /^document:(\d+):(.*)$/.exec(rowId)
  if (!match) {
    return undefined
  }

  const documentIndex = Number(match[1])
  const document = documents[documentIndex]
  if (!document) {
    return undefined
  }

  let path: Array<string | number>
  try {
    path = JSON.parse(match[2] ?? '[]') as Array<string | number>
  } catch {
    return undefined
  }
  if (
    !Array.isArray(path) ||
    path.some((segment) => typeof segment !== 'string' && typeof segment !== 'number')
  ) {
    return undefined
  }

  let value: unknown = document
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(value) || segment < 0 || segment >= value.length) {
        return undefined
      }
      value = value[segment]
      continue
    }

    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !Object.hasOwn(value, segment)
    ) {
      return undefined
    }
    value = (value as Record<string, unknown>)[segment]
  }

  const label = path.length === 0
    ? documentRootLabel(document, documentIndex)
    : typeof path.at(-1) === 'number'
      ? `[${path.at(-1)}]`
      : String(path.at(-1))
  return rowForValue(
    rowId,
    documentIndex,
    path.length,
    label,
    path.length === 0 ? '_id' : pathToFieldPath(path),
    value,
    path.slice(0, -1),
    path,
  )
}

function childRows(
  value: unknown,
  documentIndex: number,
  depth: number,
  parentPath: Array<string | number>,
  expandedRows: Set<string>,
): DocumentGridRow[] {
  if (!isExpandableValue(value)) {
    return []
  }

  const entries = valueEntries(value)

  return entries.flatMap(({ label, pathSegment, value: childValue }) => {
    const path = [...parentPath, pathSegment]
    const fieldPath = pathToFieldPath(path)
    const id = documentRowId(documentIndex, path)
    const row = rowForValue(id, documentIndex, depth, label, fieldPath, childValue, parentPath, path)

    if (!expandedRows.has(id)) {
      return [row]
    }

    return [row, ...childRows(childValue, documentIndex, depth + 1, path, expandedRows)]
  })
}

function collectExpandableChildren(
  value: unknown,
  documentIndex: number,
  parentPath: Array<string | number>,
  ids: string[],
): void {
  if (!isExpandableValue(value)) {
    return
  }

  const entries = valueEntries(value)

  entries.forEach(({ pathSegment, value: childValue }) => {
    if (!isExpandableValue(childValue)) {
      return
    }

    const path = [...parentPath, pathSegment]
    const id = documentRowId(documentIndex, path)
    ids.push(id)
    collectExpandableChildren(childValue, documentIndex, path, ids)
  })
}

function rowForValue(
  id: string,
  documentIndex: number,
  depth: number,
  label: string,
  fieldPath: string,
  value: unknown,
  parentPath: Array<string | number>,
  path: Array<string | number>,
): DocumentGridRow {
  const type = valueType(value)

  return {
    id,
    depth,
    documentIndex,
    label,
    fieldPath,
    parentPath,
    path,
    type,
    value,
    valueLabel: compactValue(value),
    expandable: isExpandableValue(value),
    lazy: isDocumentLazyNode(value),
    childCount: isDocumentLazyNode(value) ? value.childCount : undefined,
  }
}

export function documentRootLabel(document: Record<string, unknown>, index: number) {
  if (Object.hasOwn(document, '_id')) {
    return rootIdentityLabel(document._id)
  }

  const id = document.id ?? document.key

  if (typeof id === 'string' || typeof id === 'number') {
    return String(id)
  }

  const firstKey = Object.keys(document)[0]
  return firstKey ? `${firstKey}: ${compactValue(document[firstKey])}` : `document ${index + 1}`
}

function rootIdentityLabel(value: unknown) {
  const bsonScalar = bsonScalarInfo(value)
  if (bsonScalar) {
    return bsonScalar.label
  }

  if (typeof value === 'string') {
    return value.length > DOCUMENT_INLINE_PREVIEW_LIMIT
      ? `${value.slice(0, DOCUMENT_INLINE_PREVIEW_LIMIT)}... (${value.length.toLocaleString()} characters)`
      : value
  }

  if (value === null || value === undefined) {
    return String(value)
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return String(value)
}

export function pathToFieldPath(path: Array<string | number>) {
  return path
    .map((item) => {
      if (typeof item === 'number') {
        return `[${item}]`
      }

      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(item)
        ? item
        : `[${JSON.stringify(item)}]`
    })
    .reduce((current, item) => {
      if (item.startsWith('[')) {
        return `${current}${item}`
      }

      return current ? `${current}.${item}` : item
    }, '')
}

export function isDocumentLazyNode(value: unknown): value is DocumentLazyNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    record.__datapadLazyNode === true &&
    (record.type === 'object' || record.type === 'array') &&
    typeof record.childCount === 'number' &&
    Number.isInteger(record.childCount) &&
    record.childCount >= 0 &&
    Array.isArray(record.path) &&
    record.path.every(
      (segment) =>
        typeof segment === 'string' ||
        (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0),
    )
  )
}

export function isExpandableValue(value: unknown): value is Array<unknown> | Record<string, unknown> | DocumentLazyNode {
  if (isDocumentLazyNode(value)) {
    return value.childCount > 0
  }

  if (bsonScalarInfo(value)) {
    return false
  }

  return typeof value === 'object' && value !== null && Object.keys(value).length > 0
}

export function valueEntries(
  value: Array<unknown> | Record<string, unknown> | DocumentLazyNode,
): DocumentValueEntry[] {
  if (isDocumentLazyNode(value)) {
    return []
  }

  return Array.isArray(value)
    ? value.map((item, index) => ({
        label: `[${index}]`,
        pathSegment: index,
        value: item,
      }))
    : Object.entries(value).map(([key, item]) => ({
        label: key,
        pathSegment: key,
        value: item,
      }))
}

export function documentRowId(documentIndex: number, path: Array<string | number>) {
  return `document:${documentIndex}:${JSON.stringify(path)}`
}

function valueType(value: unknown): DocumentValueType {
  if (isDocumentLazyNode(value)) {
    return value.type
  }

  const bsonScalar = bsonScalarInfo(value)
  if (bsonScalar) {
    return bsonScalar.type
  }

  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  if (typeof value === 'object') {
    return 'object'
  }

  return typeof value as DocumentValueType
}

export function compactValue(value: unknown) {
  if (isDocumentLazyNode(value)) {
    return value.type === 'array'
      ? `[${value.childCount} item(s)]`
      : `{${value.childCount} field(s)}`
  }

  const bsonScalar = bsonScalarInfo(value)
  if (bsonScalar) {
    return bsonScalar.label
  }

  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return `[${value.length} item(s)]`
  }

  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).length} field(s)}`
  }

  if (typeof value === 'string') {
    return value.length > DOCUMENT_INLINE_PREVIEW_LIMIT
      ? `${value.slice(0, DOCUMENT_INLINE_PREVIEW_LIMIT)}... (${value.length.toLocaleString()} characters)`
      : value
  }

  return String(value)
}

function yieldToRenderer() {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
}

export function documentValueTypeLabel(type: DocumentValueType) {
  if (type === 'objectid') {
    return 'ObjectId'
  }

  if (type === 'uuid') {
    return 'UUID'
  }

  if (type === 'date') {
    return 'Date'
  }

  if (type === 'decimal') {
    return 'Decimal'
  }

  if (type === 'binary') {
    return 'Binary'
  }

  if (type === 'regex') {
    return 'Regex'
  }

  if (type === 'timestamp') {
    return 'Timestamp'
  }

  return type
}

export function isEditableDocumentValueType(type: DocumentValueType) {
  return ['string', 'number', 'boolean', 'null', 'object', 'array'].includes(type)
}
