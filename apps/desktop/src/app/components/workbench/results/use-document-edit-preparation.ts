import { useLayoutEffect, useRef, useState } from 'react'
import type { DocumentNodeChildrenRequest, DocumentNodeChildrenResponse } from '@datapadplusplus/shared-types'
import { dataEditErrorMessage } from './data-edit-confirmation'
import { containsUnavailableValue } from './document-edit-validation'
import { isDocumentLazyNode, rowAtDocumentRowId, type DocumentGridRow } from './document-grid-model'
import { isObjectRecord, valueAtPath } from './document-path-edits'

type Document = Record<string, unknown>

interface Options {
  documents: Document[]
  draftDocuments: Document[]
  scopeKey: string
  enabled: boolean
  locked: boolean
  request?: Omit<DocumentNodeChildrenRequest, 'documentId' | 'path' | 'mode'>
  fetch?: (request: DocumentNodeChildrenRequest) => Promise<DocumentNodeChildrenResponse | undefined>
  invalidateHydration(index: number): void
  onPrepared(index: number, document: Document): void
  onMessage(message: string): void
}

/** The fetched object is never mutated or refreshed between opening and saving an edit. */
export function useDocumentEditPreparation(options: Options) {
  const current = useRef(options)
  const generation = useRef(0)
  const pending = useRef(false)
  const pendingIndex = useRef<number | undefined>(undefined)
  const complete = useRef(new WeakSet<Document>())
  const baseline = useRef<{ index: number; document: Document } | undefined>(undefined)
  const [preparing, setPreparing] = useState(false)

  useLayoutEffect(() => { current.current = options })
  useLayoutEffect(() => {
    generation.current += 1
    pending.current = false
    baseline.current = undefined
    queueMicrotask(() => setPreparing(false))
    return () => { generation.current += 1 }
  }, [options.documents, options.scopeKey, options.locked, options.enabled])
  useLayoutEffect(() => { complete.current = new WeakSet() }, [options.documents, options.scopeKey])

  const cancel = () => {
    generation.current += 1
    pending.current = false
    baseline.current = undefined
    setPreparing(false)
  }

  const prepare = async (row: DocumentGridRow): Promise<DocumentGridRow | undefined> => {
    const source = current.current
    if (source.locked || pending.current) return undefined
    const original = source.draftDocuments[row.documentIndex]
    if (!original) return undefined
    const token = ++generation.current
    const isCurrent = () => token === generation.current && !current.current.locked &&
      current.current.documents === source.documents && current.current.scopeKey === source.scopeKey &&
      current.current.draftDocuments[row.documentIndex] === original
    baseline.current = undefined
    source.invalidateHydration(row.documentIndex)
    let document = original
    try {
      if (source.enabled && !complete.current.has(original)) {
        if (!source.fetch || !source.request || original._id === undefined) {
          throw new Error('Load the complete document before editing. Rerun the query with collection scope, then retry.')
        }
        pending.current = true
        pendingIndex.current = row.documentIndex
        setPreparing(true)
        const response = await source.fetch({ ...source.request, documentId: original._id, path: [], mode: 'full-value' })
        if (!isCurrent()) return undefined
        if (!response || response.tabId !== source.request.tabId || response.path.length !== 0 ||
            !sameDocumentIdentity(response.documentId, original._id) || !isObjectRecord(response.value) ||
            !sameDocumentIdentity(response.value._id, original._id) || containsUnavailableValue(response.value)) {
          throw new Error('The complete document could not be loaded losslessly. Retry loading before editing.')
        }
        document = response.value
        complete.current.add(document)
        source.invalidateHydration(row.documentIndex)
        source.onPrepared(row.documentIndex, document)
        const nextValue = valueAtPath(document, row.path)
        if (nextValue === undefined || !visibleValueMatches(row.value, nextValue)) {
          source.onMessage('The selected value changed while loading. The document has been refreshed; review it and retry the edit.')
          return undefined
        }
      }
      if (containsUnavailableValue(document)) {
        throw new Error('Load the complete document before editing; some values are still unavailable.')
      }
      baseline.current = { index: row.documentIndex, document }
      const next = source.draftDocuments.map((item, index) => index === row.documentIndex ? document : item)
      return rowAtDocumentRowId(next, row.id)
    } catch (error) {
      if (isCurrent()) source.onMessage(dataEditErrorMessage(error, 'Unable to load the document for editing. Retry the edit to load it again.'))
      return undefined
    } finally {
      if (token === generation.current) {
        pending.current = false
        setPreparing(false)
      }
    }
  }

  const getBaseline = (row: DocumentGridRow) => {
    const value = baseline.current
    if (current.current.locked || !value || value.index !== row.documentIndex) return undefined
    return value.document
  }

  // Capture before awaiting confirmation/execution. Never apply a response to a replacement result.
  const responseGuard = (row: DocumentGridRow) => {
    const token = generation.current
    const document = getBaseline(row)
    return () => token === generation.current && Boolean(document) && !current.current.locked
  }

  const accept = (row: DocumentGridRow, document: Document) => {
    complete.current.add(document)
    baseline.current = { index: row.documentIndex, document }
  }

  return { preparing, prepare, cancel, getBaseline, responseGuard, accept,
    isPreparingDocument: (index: number) => pending.current && pendingIndex.current === index,
  }
}

/** Ignore only unavailable preview branches; changed visible fields must be reviewed. */
export function visibleValueMatches(preview: unknown, full: unknown): boolean {
  if (typeof preview === 'number' && isObjectRecord(full) && Object.keys(full).length === 1) {
    if (typeof full.$numberDouble === 'string') return Object.is(preview, Number(full.$numberDouble))
    const integer = full.$numberInt ?? full.$numberLong
    if (typeof integer === 'string' && Number.isSafeInteger(preview)) return String(preview) === integer
  }
  if (isDocumentLazyNode(preview)) {
    return preview.type === 'array' ? Array.isArray(full) : isObjectRecord(full)
  }
  if (Array.isArray(preview)) {
    return Array.isArray(full) && preview.length === full.length && preview.every((value, index) => visibleValueMatches(value, full[index]))
  }
  if (isObjectRecord(preview) && isObjectRecord(full)) {
    return Object.keys(preview).length === Object.keys(full).length &&
      Object.entries(preview).every(([key, value]) => Object.hasOwn(full, key) &&
        (key === '_id' ? sameDocumentIdentity(value, full[key]) : visibleValueMatches(value, full[key])))
  }
  return Object.is(preview, full)
}

// Lazy result identities use canonical Extended JSON; hydration uses readable dates/UUIDs.
export function sameDocumentIdentity(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeIdentity(left)) === JSON.stringify(normalizeIdentity(right))
}

function normalizeIdentity(value: unknown): unknown {
  if (typeof value === 'number') return Number.isInteger(value) ? { $integer: String(value) } : value
  if (Array.isArray(value)) return value.map(normalizeIdentity)
  if (!isObjectRecord(value)) return value
  if (Object.keys(value).length === 1) {
    if (typeof value.$numberLong === 'string' || typeof value.$numberInt === 'string') {
      return { $integer: value.$numberLong ?? value.$numberInt }
    }
    if (typeof value.$numberDouble === 'string') {
      const number = Number(value.$numberDouble)
      return Number.isFinite(number) ? normalizeIdentity(number) : { $numberDouble: value.$numberDouble }
    }
    if (typeof value.$uuid === 'string') return { $uuid: value.$uuid.toLowerCase() }
    if (isObjectRecord(value.$binary) && value.$binary.subType === '04' && typeof value.$binary.base64 === 'string') {
      try {
        const bytes = atob(value.$binary.base64)
        if (bytes.length === 16) {
          const hex = Array.from(bytes, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
          return { $uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` }
        }
      } catch { /* Invalid identities cannot match a valid UUID. */ }
    }
    if (typeof value.$date === 'string') return { $date: String(new Date(value.$date).getTime()) }
    if (isObjectRecord(value.$date) && typeof value.$date.$numberLong === 'string') return { $date: value.$date.$numberLong }
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeIdentity(item)]))
}
