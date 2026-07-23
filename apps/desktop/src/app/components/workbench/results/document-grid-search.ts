import {
  compactValue,
  documentRowId,
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
    const rootId = documentRowId(index, [])
    visitValue({
      ancestors: [],
      documentIndex: index,
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

export async function searchDocumentRowsCooperative(
  documents: Array<Record<string, unknown>>,
  query: string,
  signal?: AbortSignal,
): Promise<DocumentGridSearchResult> {
  const needle = query.trim().toLowerCase()
  const result = emptyDocumentSearchResult()
  if (!needle) {
    return result
  }

  const stack = documents
    .map((document, documentIndex) => ({
      ancestors: [] as string[],
      documentIndex,
      id: documentRowId(documentIndex, []),
      label: documentRootLabel(document, documentIndex),
      path: [] as Array<string | number>,
      value: document as unknown,
    }))
    .reverse()
  let visited = 0

  while (stack.length > 0) {
    if (signal?.aborted) {
      throw new DOMException('Document search was cancelled.', 'AbortError')
    }

    const current = stack.pop()
    if (!current) {
      break
    }
    visitCurrentValue(current, needle, result)

    if (isExpandableValue(current.value)) {
      const entries = valueEntries(current.value)
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (!entry) {
          continue
        }
        const childPath = [...current.path, entry.pathSegment]
        stack.push({
          ancestors: [...current.ancestors, current.id],
          documentIndex: current.documentIndex,
          id: documentRowId(current.documentIndex, childPath),
          label: entry.label,
          path: childPath,
          value: entry.value,
        })
      }
    }

    visited += 1
    if (visited % 400 === 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
    }
  }

  return result
}

export function emptyDocumentSearchResult(): DocumentGridSearchResult {
  return {
    expandedRowIds: new Set(),
    matchedRowIds: new Set(),
    matchCount: 0,
    visibleRowIds: new Set(),
  }
}

function visitValue({
  ancestors,
  documentIndex,
  id,
  label,
  path,
  result,
  searchText,
  value,
}: {
  ancestors: string[]
  documentIndex: number
  id: string
  label: string
  path: Array<string | number>
  result: DocumentGridSearchResult
  searchText: string
  value: unknown
}) {
  visitCurrentValue(
    { ancestors, documentIndex, id, label, path, value },
    searchText,
    result,
  )

  if (!isExpandableValue(value)) {
    return
  }

  for (const { label, pathSegment, value: childValue } of valueEntries(value)) {
    const childPath = [...path, pathSegment]
    visitValue({
      ancestors: [...ancestors, id],
      documentIndex,
      id: documentRowId(documentIndex, childPath),
      label,
      path: childPath,
      result,
      searchText,
      value: childValue,
    })
  }
}

function visitCurrentValue(
  {
    ancestors,
    id,
    label,
    path,
    value,
  }: {
    ancestors: string[]
    documentIndex: number
    id: string
    label: string
    path: Array<string | number>
    value: unknown
  },
  searchText: string,
  result: DocumentGridSearchResult,
) {
  const fieldPath = path.length === 0 ? '_id' : pathToFieldPath(path)

  if (rowMatchesSearch(label, fieldPath, value, searchText)) {
    result.matchedRowIds.add(id)
    result.visibleRowIds.add(id)
    result.matchCount += 1

    for (const ancestor of ancestors) {
      result.visibleRowIds.add(ancestor)
      result.expandedRowIds.add(ancestor)
    }
  }

}

function rowMatchesSearch(
  label: string,
  fieldPath: string,
  value: unknown,
  searchText: string,
) {
  const candidates = [label, fieldPath, compactValue(value)]

  return candidates.some((candidate) => candidate.toLowerCase().includes(searchText))
}
