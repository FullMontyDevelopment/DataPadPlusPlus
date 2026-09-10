import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  DocumentNodeChildrenRequest,
  DocumentNodeChildrenResponse,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from './document-edit-context'
import type { DocumentGridRow } from './document-grid-model'
import { dataEditErrorMessage } from './data-edit-confirmation'

const EMPTY_ROW_ID_SET = new Set<string>()
const EMPTY_ROW_ERROR_MAP = new Map<string, string>()

interface SourceScopedRows<T> {
  source: Array<Record<string, unknown>>
  value: T
}

interface DocumentLazyHydrationOptions {
  collection?: string
  database?: string
  documents: Array<Record<string, unknown>>
  draftDocuments: Array<Record<string, unknown>>
  editContext?: DocumentEditContext
  tabId?: string
  resetKey?: string
  suspended?: boolean
  scopeKey?: string
  isDocumentPreparing?(index: number): boolean
  onFetchDocumentNodeChildren?(
    request: DocumentNodeChildrenRequest,
  ): Promise<DocumentNodeChildrenResponse | undefined>
  onHydrated(row: DocumentGridRow, response: DocumentNodeChildrenResponse): void
  onMessage(message: string): void
}

export function useDocumentLazyHydration({
  collection,
  database,
  documents,
  draftDocuments,
  editContext,
  tabId,
  resetKey,
  suspended = false,
  scopeKey,
  isDocumentPreparing,
  onFetchDocumentNodeChildren,
  onHydrated,
  onMessage,
}: DocumentLazyHydrationOptions) {
  const [hydratingRows, setHydratingRows] = useState<SourceScopedRows<Set<string>>>(() => ({
    source: documents,
    value: new Set(),
  }))
  const [hydrationErrors, setHydrationErrors] = useState<SourceScopedRows<Map<string, string>>>(() => ({
    source: documents,
    value: new Map(),
  }))
  const documentsRef = useRef(documents)
  const draftsRef = useRef(draftDocuments)
  const generationRef = useRef(0)
  const suspendedRef = useRef(suspended)
  const requestsRef = useRef(new Map<Array<Record<string, unknown>>, Set<string>>())
  const documentGenerations = useRef(new Map<number, number>())

  useLayoutEffect(() => {
    documentsRef.current = documents
    draftsRef.current = draftDocuments
  }, [documents, draftDocuments])

  useEffect(() => {
    suspendedRef.current = suspended
    generationRef.current += 1
    requestsRef.current.clear()
    queueMicrotask(() => {
      setHydratingRows({ source: documents, value: new Set() })
      setHydrationErrors({ source: documents, value: new Map() })
    })
    return () => { generationRef.current += 1 }
  }, [documents, resetKey, suspended, scopeKey])

  const hydrateLazyRow = async (
    row: DocumentGridRow,
    mode: DocumentNodeChildrenRequest['mode'] = 'children',
  ) => {
    if (suspendedRef.current) {
      onMessage('Wait for the running query to finish before loading this field.')
      return undefined
    }
    if (isDocumentPreparing?.(row.documentIndex)) return undefined
    if (!onFetchDocumentNodeChildren || !editContext || !tabId || !collection) {
      onMessage('Run a full query or select a collection before expanding this field.')
      return undefined
    }

    const documentId = draftDocuments[row.documentIndex]?._id
    if (documentId === undefined) {
      onMessage('This document cannot be expanded because its _id is unavailable.')
      return undefined
    }

    const sourceDocuments = documents
    const sourceGeneration = generationRef.current
    const documentGeneration = documentGenerations.current.get(row.documentIndex) ?? 0
    const sourceRequests = requestsRef.current.get(sourceDocuments) ?? new Set<string>()
    if (sourceRequests.has(row.id)) {
      return undefined
    }
    sourceRequests.add(row.id)
    requestsRef.current.set(sourceDocuments, sourceRequests)
    setRowError(setHydrationErrors, sourceDocuments, row.id, undefined)
    setRowLoading(setHydratingRows, sourceDocuments, row.id, true)

    try {
      const response = await onFetchDocumentNodeChildren({
        tabId,
        connectionId: editContext.connectionId,
        environmentId: editContext.environmentId,
        database,
        collection,
        documentId,
        path: row.path,
        mode,
        queryText: editContext.queryText,
      })
      validateResponse(response, tabId, documentId, row.path)
      if (
        generationRef.current === sourceGeneration &&
        (documentGenerations.current.get(row.documentIndex) ?? 0) === documentGeneration &&
        JSON.stringify(draftsRef.current[row.documentIndex]?._id) === JSON.stringify(documentId) &&
        !suspendedRef.current &&
        documentsRef.current === sourceDocuments
      ) {
        onHydrated(row, response)
        return response
      }
      return undefined
    } catch (error) {
      const message = dataEditErrorMessage(error, 'Unable to expand this field.')
      if (
        generationRef.current === sourceGeneration &&
        (documentGenerations.current.get(row.documentIndex) ?? 0) === documentGeneration &&
        JSON.stringify(draftsRef.current[row.documentIndex]?._id) === JSON.stringify(documentId) &&
        !suspendedRef.current &&
        documentsRef.current === sourceDocuments
      ) {
        setRowError(setHydrationErrors, sourceDocuments, row.id, message)
        onMessage(message)
      }
      return undefined
    } finally {
      sourceRequests.delete(row.id)
      if (sourceRequests.size === 0 && requestsRef.current.get(sourceDocuments) === sourceRequests) {
        requestsRef.current.delete(sourceDocuments)
      }
      if (generationRef.current === sourceGeneration && documentsRef.current === sourceDocuments &&
          (documentGenerations.current.get(row.documentIndex) ?? 0) === documentGeneration) {
        setRowLoading(setHydratingRows, sourceDocuments, row.id, false)
      }
    }
  }

  return {
    hydrationErrors: hydrationErrors.source === documents
      ? hydrationErrors.value
      : EMPTY_ROW_ERROR_MAP,
    hydratingRows: hydratingRows.source === documents
      ? hydratingRows.value
      : EMPTY_ROW_ID_SET,
    hydrateLazyRow,
    invalidateDocumentHydration: (index: number) => {
      documentGenerations.current.set(index, (documentGenerations.current.get(index) ?? 0) + 1)
      const prefix = `document:${index}:`
      setHydratingRows((current) => ({ ...current, value: new Set([...current.value].filter((id) => !id.startsWith(prefix))) }))
      setHydrationErrors((current) => ({ ...current, value: new Map([...current.value].filter(([id]) => !id.startsWith(prefix))) }))
    },
  }
}

function validateResponse(
  response: DocumentNodeChildrenResponse | undefined,
  tabId: string,
  documentId: unknown,
  path: Array<string | number>,
): asserts response is DocumentNodeChildrenResponse {
  if (!response) {
    throw new Error('The document node request completed without a response.')
  }
  if (
    response.tabId !== tabId ||
    JSON.stringify(response.documentId) !== JSON.stringify(documentId) ||
    response.path.length !== path.length ||
    response.path.some((segment, index) => segment !== path[index])
  ) {
    throw new Error('The document node response did not match the requested field.')
  }
}

function setRowError(
  setter: Dispatch<SetStateAction<SourceScopedRows<Map<string, string>>>>,
  source: Array<Record<string, unknown>>,
  rowId: string,
  message: string | undefined,
) {
  setter((current) => {
    const value = new Map(current.source === source ? current.value : [])
    if (message) {
      value.set(rowId, message)
    } else {
      value.delete(rowId)
    }
    return { source, value }
  })
}

function setRowLoading(
  setter: Dispatch<SetStateAction<SourceScopedRows<Set<string>>>>,
  source: Array<Record<string, unknown>>,
  rowId: string,
  loading: boolean,
) {
  setter((current) => {
    const value = new Set(current.source === source ? current.value : EMPTY_ROW_ID_SET)
    if (loading) {
      value.add(rowId)
    } else {
      value.delete(rowId)
    }
    return { source, value }
  })
}
