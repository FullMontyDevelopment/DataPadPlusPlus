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

export function collectExpandableRowIds(documents: Array<Record<string, unknown>>): string[] {
  const ids: string[] = []

  documents.forEach((document, index) => {
    const rootId = documentRowId(index, [])
    ids.push(rootId)
    collectExpandableChildren(document, index, [], ids)
  })

  return ids
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
    return value
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
    return value
  }

  return String(value)
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
