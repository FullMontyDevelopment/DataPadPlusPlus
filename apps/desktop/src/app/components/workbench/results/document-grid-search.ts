import {
  compactValue,
  documentRootLabel,
  isExpandableValue,
  pathToFieldPath,
  valueEntries,
} from './document-grid-model'

export interface DocumentGridSearchResult {
  expandedRowIds: Set<string>
  matchedRowIds: Set<string>
  matchCount: number
  visibleRowIds: Set<string>
}

export function searchDocumentRows(
  documents: Array<Record<string, unknown>>,
  query: string,
): DocumentGridSearchResult {
  const needle = query.trim().toLowerCase()
  const result: DocumentGridSearchResult = {
    expandedRowIds: new Set(),
    matchedRowIds: new Set(),
    matchCount: 0,
    visibleRowIds: new Set(),
  }

  if (!needle) {
    return result
  }

  documents.forEach((document, index) => {
    const rootId = `document-${index}`
    visitValue({
      ancestors: [],
      id: rootId,
      label: documentRootLabel(document, index),
      path: [],
      result,
      searchText: needle,
      value: document,
    })
  })

  return result
}

function visitValue({
  ancestors,
  id,
  label,
  path,
  result,
  searchText,
  value,
}: {
  ancestors: string[]
  id: string
  label: string
  path: Array<string | number>
  result: DocumentGridSearchResult
  searchText: string
  value: unknown
}) {
  const fieldPath = path.length === 0 ? '_id' : pathToFieldPath(path)

  if (rowMatchesSearch(label, fieldPath, value, searchText, path.length === 0)) {
    result.matchedRowIds.add(id)
    result.visibleRowIds.add(id)
    result.matchCount += 1

    for (const ancestor of ancestors) {
      result.visibleRowIds.add(ancestor)
      result.expandedRowIds.add(ancestor)
    }
  }

  if (!isExpandableValue(value)) {
    return
  }

  for (const [key, childValue] of valueEntries(value)) {
    const pathKey = key.startsWith('[') ? Number(key.slice(1, -1)) : key
    visitValue({
      ancestors: [...ancestors, id],
      id: `${id}.${key}`,
      label: key,
      path: [...path, pathKey],
      result,
      searchText,
      value: childValue,
    })
  }
}

function rowMatchesSearch(
  label: string,
  fieldPath: string,
  value: unknown,
  searchText: string,
  isRoot: boolean,
) {
  const candidates = [label, fieldPath, compactValue(value)]

  if (!isRoot && isExpandableValue(value)) {
    candidates.push(safeStringify(value))
  }

  return candidates.some((candidate) => candidate.toLowerCase().includes(searchText))
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
