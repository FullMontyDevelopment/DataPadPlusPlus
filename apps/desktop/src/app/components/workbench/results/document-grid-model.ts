export type DocumentValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export interface DocumentGridRow {
  id: string
  depth: number
  label: string
  fieldPath: string
  type: DocumentValueType
  valueLabel: string
  value: unknown
  expandable: boolean
  documentIndex: number
  parentPath: Array<string | number>
  path: Array<string | number>
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

export function isExpandableValue(value: unknown): value is Array<unknown> | Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0
}

export function valueEntries(value: Array<unknown> | Record<string, unknown>): Array<[string, unknown]> {
  return Array.isArray(value)
    ? value.map((item, index) => [`[${index}]`, item])
    : Object.entries(value)
}

function valueType(value: unknown): DocumentValueType {
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

export function valueAtPath(value: unknown, path: Array<string | number>) {
  return path.reduce<unknown>((current, key) => {
    if (current === null || current === undefined) {
      return undefined
    }

    return (current as Record<string, unknown> | Array<unknown>)[key as never]
  }, value)
}
