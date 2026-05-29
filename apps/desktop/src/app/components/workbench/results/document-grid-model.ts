export type DocumentValueType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'objectid'
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

export function buildRows(documents: Array<Record<string, unknown>>, expandedRows: Set<string>) {
  const rows: DocumentGridRow[] = []

  documents.forEach((document, index) => {
    const rootId = `document-${index}`
    const rootLabel = documentRootLabel(document, index)
    rows.push(rowForValue(rootId, index, 0, rootLabel, '_id', document, [], []))

    if (expandedRows.has(rootId)) {
      rows.push(...childRows(document, index, rootId, 1, [], expandedRows))
    }
  })

  return rows
}

export function collectExpandableRowIds(documents: Array<Record<string, unknown>>): string[] {
  const ids: string[] = []

  documents.forEach((document, index) => {
    const rootId = `document-${index}`
    ids.push(rootId)
    collectExpandableChildren(document, rootId, ids)
  })

  return ids
}

export function editableValue(value: unknown) {
  if (value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value)
}

export function parseEditedValue(value: string, type: DocumentValueType) {
  if (type === 'objectid') {
    return { $oid: value.trim() }
  }

  if (type === 'date') {
    return { $date: value.trim() }
  }

  if (type === 'decimal') {
    return { $numberDecimal: value.trim() }
  }

  if (type === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (type === 'boolean') {
    return value.toLowerCase() === 'true'
  }

  if (type === 'null') {
    return null
  }

  if (type === 'object' || type === 'array') {
    try {
      return JSON.parse(value)
    } catch {
      return type === 'array' ? [] : {}
    }
  }

  return value
}

export function coerceValue(value: unknown, type: DocumentValueType) {
  if (type === 'objectid') {
    return { $oid: typeof value === 'string' ? value : '' }
  }

  if (type === 'date') {
    return { $date: typeof value === 'string' ? value : new Date().toISOString() }
  }

  if (type === 'decimal') {
    return { $numberDecimal: typeof value === 'number' ? String(value) : '0' }
  }

  if (type === 'string') {
    return value === null ? '' : String(value)
  }

  if (type === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (type === 'boolean') {
    return Boolean(value)
  }

  if (type === 'null') {
    return null
  }

  if (type === 'array') {
    return Array.isArray(value) ? value : []
  }

  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
}

export function setValueAtPath(
  document: Record<string, unknown>,
  path: Array<string | number>,
  nextValue: unknown,
) {
  const clone = structuredClone(document) as Record<string, unknown>
  const parent = valueAtPath(clone, path.slice(0, -1))
  const key = path.at(-1)

  if (parent && key !== undefined) {
    ;(parent as Record<string, unknown> | Array<unknown>)[key as never] = nextValue as never
  }

  return clone
}

export function renameFieldAtPath(
  document: Record<string, unknown>,
  parentPath: Array<string | number>,
  oldKey: string | number | undefined,
  nextName: string,
) {
  const clone = structuredClone(document) as Record<string, unknown>
  const parent = valueAtPath(clone, parentPath)

  if (!parent || oldKey === undefined || Array.isArray(parent)) {
    return clone
  }

  const record = parent as Record<string, unknown>
  record[nextName] = record[String(oldKey)]
  delete record[String(oldKey)]
  return clone
}

export function deleteValueAtPath(document: Record<string, unknown>, path: Array<string | number>) {
  const clone = structuredClone(document) as Record<string, unknown>
  const parent = valueAtPath(clone, path.slice(0, -1))
  const key = path.at(-1)

  if (!parent || key === undefined) {
    return clone
  }

  if (Array.isArray(parent) && typeof key === 'number') {
    parent.splice(key, 1)
  } else {
    delete (parent as Record<string, unknown>)[String(key)]
  }

  return clone
}

function childRows(
  value: unknown,
  documentIndex: number,
  parentId: string,
  depth: number,
  parentPath: Array<string | number>,
  expandedRows: Set<string>,
): DocumentGridRow[] {
  if (!isExpandableValue(value)) {
    return []
  }

  const entries = valueEntries(value)

  return entries.flatMap(([key, childValue]) => {
    const pathKey = key.startsWith('[') ? Number(key.slice(1, -1)) : key
    const path = [...parentPath, pathKey]
    const fieldPath = pathToFieldPath(path)
    const id = `${parentId}.${key}`
    const row = rowForValue(id, documentIndex, depth, key, fieldPath, childValue, parentPath, path)

    if (!expandedRows.has(id)) {
      return [row]
    }

    return [row, ...childRows(childValue, documentIndex, id, depth + 1, path, expandedRows)]
  })
}

function collectExpandableChildren(value: unknown, parentId: string, ids: string[]): void {
  if (!isExpandableValue(value)) {
    return
  }

  const entries = valueEntries(value)

  entries.forEach(([key, childValue]) => {
    if (!isExpandableValue(childValue)) {
      return
    }

    const id = `${parentId}.${key}`
    ids.push(id)
    collectExpandableChildren(childValue, id, ids)
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
    .map((item) => (typeof item === 'number' ? `[${item}]` : item))
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
    Array.isArray(record.path)
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

export function valueEntries(value: Array<unknown> | Record<string, unknown> | DocumentLazyNode): Array<[string, unknown]> {
  if (isDocumentLazyNode(value)) {
    return []
  }

  return Array.isArray(value)
    ? value.map((item, index) => [`[${index}]`, item])
    : Object.entries(value)
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

function bsonScalarInfo(value: unknown): { type: DocumentValueType; label: string } | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  if (typeof value.$oid === 'string') {
    return { type: 'objectid', label: `ObjectId("${value.$oid}")` }
  }

  if (typeof value.$date === 'string') {
    return { type: 'date', label: `ISODate("${value.$date}")` }
  }

  if (isRecord(value.$date) && typeof value.$date.$numberLong === 'string') {
    return { type: 'date', label: dateLabelFromMilliseconds(value.$date.$numberLong) }
  }

  if (typeof value.$numberDecimal === 'string') {
    return { type: 'decimal', label: `Decimal128("${value.$numberDecimal}")` }
  }

  if (typeof value.$numberLong === 'string') {
    return { type: 'number', label: `NumberLong("${value.$numberLong}")` }
  }

  if (typeof value.$numberInt === 'string') {
    return { type: 'number', label: value.$numberInt }
  }

  if (typeof value.$numberDouble === 'string') {
    return { type: 'number', label: value.$numberDouble }
  }

  if (isRecord(value.$binary)) {
    const subType = typeof value.$binary.subType === 'string' ? value.$binary.subType : undefined
    return { type: 'binary', label: subType ? `Binary(${subType})` : 'Binary' }
  }

  if (isRecord(value.$regularExpression)) {
    const pattern =
      typeof value.$regularExpression.pattern === 'string' ? value.$regularExpression.pattern : ''
    const options =
      typeof value.$regularExpression.options === 'string' ? value.$regularExpression.options : ''
    return { type: 'regex', label: `/${pattern}/${options}` }
  }

  if (isRecord(value.$timestamp)) {
    const timestamp = value.$timestamp
    const t = typeof timestamp.t === 'number' ? timestamp.t : timestamp.t
    const i = typeof timestamp.i === 'number' ? timestamp.i : timestamp.i
    return { type: 'timestamp', label: `Timestamp(${String(t)}, ${String(i)})` }
  }

  if (value.$minKey === 1) {
    return { type: 'object', label: 'MinKey' }
  }

  if (value.$maxKey === 1) {
    return { type: 'object', label: 'MaxKey' }
  }

  return undefined
}

function dateLabelFromMilliseconds(value: string) {
  const milliseconds = Number(value)

  if (!Number.isFinite(milliseconds)) {
    return `Date(${value})`
  }

  return `ISODate("${new Date(milliseconds).toISOString()}")`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function valueAtPath(value: unknown, path: Array<string | number>) {
  return path.reduce<unknown>((current, key) => {
    if (current === null || current === undefined) {
      return undefined
    }

    return (current as Record<string, unknown> | Array<unknown>)[key as never]
  }, value)
}
