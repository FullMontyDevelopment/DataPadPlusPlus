import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ConnectionProfile,
  DataEditChange,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  DataEditKind,
} from '@datapadplusplus/shared-types'
import { DocumentContextMenu } from './document-context-menu'
import { DeleteConfirmationPanel } from './DeleteConfirmationPanel'
import type { DocumentEditContext } from './document-edit-context'
import { DocumentFieldInspector } from './DocumentFieldInspector'
import {
  DocumentResultsFooter,
  DocumentResultsToolbar,
} from './DocumentResultsChrome'
import {
  buildDocumentDeleteRequest,
  buildDocumentEditRequest,
  pathSegments,
  valueTypeName,
} from './document-edit-requests'
import { DocumentGridRowView } from './DocumentGridRowView'
import { DocumentVirtualGridRows } from './DocumentVirtualGridRows'
import { documentResultBehaviorForConnection } from './datastore-result-behaviors'
import { dataEditErrorMessage, dataEditStatusMessage, executeDataEditWithConfirmation } from './data-edit-confirmation'
import { editablePermissions } from './document-edit-permissions'
import {
  collectExpandableRowIdsCooperative,
  createDocumentTreeIndex,
  createDocumentTreeIndexCooperative,
  isDocumentLazyNode,
  rowAtDocumentRowId,
  type DocumentGridRow,
  type DocumentTreeIndex,
  type DocumentValueType,
} from './document-grid-model'
import { deleteValueAtPath, renameFieldAtPath, setValueAtPath } from './document-path-edits'
import { coerceValue } from './document-value-editing'
import {
  emptyDocumentSearchResult,
  searchDocumentRowsCooperative,
} from './document-grid-search'
import { documentCountText } from './document-results-summary'
import { copyText } from './payload-export'
import { useDataEditConfirmation } from './use-data-edit-confirmation'
import { useDocumentLazyHydration } from './use-document-lazy-hydration'

interface DocumentResultsViewProps {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  documents: Array<Record<string, unknown>>
  database?: string
  collection?: string
  footerControls?: ReactNode
  hydrationMode?: 'full' | 'lazy'
  tabId?: string
  resultDurationMs?: number
  resultRuntimeTitle?: string
  resultSummary?: string
  documentResetToken?: string
  executionLocked?: boolean
  onFetchDocumentNodeChildren?: Parameters<typeof useDocumentLazyHydration>[0]['onFetchDocumentNodeChildren']
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
}

interface ContextMenuState {
  source: Array<Record<string, unknown>>
  x: number
  y: number
  row: DocumentGridRow
}

type DocumentEditCell = 'field' | 'type' | 'value'

const DOCUMENT_SEARCH_DEBOUNCE_MS = 180
const EMPTY_DOCUMENT_SEARCH_RESULT = emptyDocumentSearchResult()

interface ActiveEditorState {
  rowId: string
  cell: DocumentEditCell
}

interface PendingFieldDeleteState {
  source: Array<Record<string, unknown>>
  row: DocumentGridRow
}

interface PendingDocumentDeleteState {
  source: Array<Record<string, unknown>>
  row: DocumentGridRow
}

export function DocumentResultsView({
  connection,
  editContext,
  documents,
  database,
  collection,
  footerControls,
  hydrationMode = 'full',
  tabId,
  resultDurationMs,
  resultRuntimeTitle,
  resultSummary,
  documentResetToken,
  executionLocked = false,
  onFetchDocumentNodeChildren,
  onExecuteDataEdit,
}: DocumentResultsViewProps) {
  const connectionBehavior = documentResultBehaviorForConnection(connection)
  const behavior = executionLocked
    ? {
        ...connectionBehavior,
        canEditDocuments: false,
        canRenameFields: false,
        canChangeTypes: false,
        contextActions: {
          ...connectionBehavior.contextActions,
          renameField: false,
          editValue: false,
          changeType: false,
          deleteField: false,
          deleteDocument: false,
        },
        editModeLabel: 'Result editing is unavailable while the query is running',
      }
    : connectionBehavior
  const [draftState, setDraftState] = useState(() => ({
    source: documents,
    documents,
  }))
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set())
  const [copyMessage, setCopyMessage] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>()
  const [activeEditor, setActiveEditor] = useState<ActiveEditorState>()
  const [searchInput, setSearchInput] = useState('')
  const [searchText, setSearchText] = useState('')
  const [completedSearch, setCompletedSearch] = useState<{
    documents: Array<Record<string, unknown>>
    query: string
    result: ReturnType<typeof emptyDocumentSearchResult>
  }>()
  const [expandAllState, setExpandAllState] = useState<{
    documents: Array<Record<string, unknown>>
    pending: boolean
  }>()
  const [preparedTreeIndex, setPreparedTreeIndex] = useState<{
    documents: Array<Record<string, unknown>>
    expandedRows: Set<string>
    index: DocumentTreeIndex
  }>()
  const [inspectorRowId, setInspectorRowId] = useState<string>()
  const [pendingFieldDelete, setPendingFieldDelete] = useState<PendingFieldDeleteState>()
  const [pendingDocumentDelete, setPendingDocumentDelete] = useState<PendingDocumentDeleteState>()
  const {
    cancelDataEditConfirmation,
    confirmDataEdit,
    confirmationDialog,
  } = useDataEditConfirmation()
  const draftDocuments = draftState.source === documents ? draftState.documents : documents
  const efficiencyModeEnabled = hydrationMode === 'lazy'
  const effectiveActiveEditor = draftState.source === documents ? activeEditor : undefined
  const activeContextMenu = contextMenu?.source === documents ? contextMenu : undefined
  const pendingFieldDeleteRow = pendingFieldDelete?.source === documents
    ? pendingFieldDelete.row
    : undefined
  const pendingDocumentDeleteRow = pendingDocumentDelete?.source === documents
    ? pendingDocumentDelete.row
    : undefined
  const copyTimer = useRef<number | undefined>(undefined)
  const expandAllAbortRef = useRef<AbortController | undefined>(undefined)
  const handledResetTokenRef = useRef<string | undefined>(undefined)
  const normalizedSearchText = searchText.trim()
  const searchResult =
    completedSearch?.documents === draftDocuments &&
    completedSearch.query === normalizedSearchText
      ? completedSearch.result
      : EMPTY_DOCUMENT_SEARCH_RESULT
  const searchRunning =
    normalizedSearchText.length > 0 &&
    (
      completedSearch?.documents !== draftDocuments ||
      completedSearch.query !== normalizedSearchText
    )
  const expandAllPending =
    expandAllState?.documents === draftDocuments && expandAllState.pending
  const searchPending =
    searchInput.trim() !== searchText.trim() || searchRunning
  const hasSearch = normalizedSearchText.length > 0
  const effectiveExpandedRows = useMemo(() => {
    if (!hasSearch) {
      return expandedRows
    }

    return new Set([...expandedRows, ...searchResult.expandedRowIds])
  }, [expandedRows, hasSearch, searchResult.expandedRowIds])
  const treeIndex = useMemo(
    () =>
      !hasSearch &&
      preparedTreeIndex?.documents === draftDocuments &&
      preparedTreeIndex.expandedRows === effectiveExpandedRows
        ? preparedTreeIndex.index
        : createDocumentTreeIndex(
            draftDocuments,
            effectiveExpandedRows,
            hasSearch ? searchResult.visibleRowIds : undefined,
          ),
    [
      draftDocuments,
      effectiveExpandedRows,
      hasSearch,
      preparedTreeIndex,
      searchResult.visibleRowIds,
    ],
  )
  const inspectorRow = inspectorRowId
    ? rowAtDocumentRowId(draftDocuments, inspectorRowId)
    : undefined
  const inspectorDocument =
    inspectorRow && draftDocuments[inspectorRow.documentIndex]
      ? draftDocuments[inspectorRow.documentIndex]
      : undefined
  const inspectorPermissions = inspectorRow
    ? editablePermissions(inspectorRow, behavior)
    : undefined
  const activeDocumentDeleteRequest =
    activeContextMenu && connection && editContext
      ? buildDocumentDeleteRequest(
          connection,
          editContext,
          draftDocuments,
          activeContextMenu.row,
        )
      : undefined
  const documentCountLabel = documentCountText(
    resultSummary,
    draftDocuments.length,
  )

  useEffect(() => {
    return () => {
      if (copyTimer.current !== undefined) {
        window.clearTimeout(copyTimer.current)
      }
      expandAllAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!documentResetToken || handledResetTokenRef.current === documentResetToken) {
      return
    }

    handledResetTokenRef.current = documentResetToken
    expandAllAbortRef.current?.abort()
    expandAllAbortRef.current = undefined
    queueMicrotask(() => {
      cancelDataEditConfirmation()
      setExpandedRows(new Set())
      setPreparedTreeIndex(undefined)
      setExpandAllState({ documents: draftDocuments, pending: false })
      setActiveEditor(undefined)
      setContextMenu(undefined)
      setInspectorRowId(undefined)
      setPendingFieldDelete(undefined)
      setPendingDocumentDelete(undefined)
    })
  }, [cancelDataEditConfirmation, documentResetToken, draftDocuments])

  useEffect(() => {
    if (!executionLocked) {
      return
    }

    queueMicrotask(() => {
      cancelDataEditConfirmation()
      setActiveEditor(undefined)
      setContextMenu(undefined)
      setPendingFieldDelete(undefined)
      setPendingDocumentDelete(undefined)
    })
  }, [cancelDataEditConfirmation, executionLocked])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchText(searchInput)
    }, DOCUMENT_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [searchInput])

  useEffect(() => {
    const controller = new AbortController()
    const query = normalizedSearchText
    if (!query) {
      return () => controller.abort()
    }

    void searchDocumentRowsCooperative(
      draftDocuments,
      query,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setCompletedSearch({
            documents: draftDocuments,
            query,
            result,
          })
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setCopyMessage('Document search could not be completed.')
        }
      })

    return () => controller.abort()
  }, [draftDocuments, normalizedSearchText])

  useEffect(() => {
    if (copyTimer.current !== undefined) {
      window.clearTimeout(copyTimer.current)
      copyTimer.current = undefined
    }

    cancelDataEditConfirmation()
    expandAllAbortRef.current?.abort()
    expandAllAbortRef.current = undefined
    const releasePreparedIndex = window.setTimeout(() => {
      setPreparedTreeIndex(undefined)
    }, 0)
    return () => window.clearTimeout(releasePreparedIndex)
  }, [cancelDataEditConfirmation, documents])

  useEffect(() => {
    if (!activeContextMenu) {
      return
    }

    const close = () => setContextMenu(undefined)
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', close)
    }
  }, [activeContextMenu])

  const updateDraftDocuments = (
    updater: (current: Array<Record<string, unknown>>) => Array<Record<string, unknown>>,
  ) => {
    setDraftState((current) => {
      const currentDocuments = current.source === documents ? current.documents : documents

      return {
        source: documents,
        documents: updater(currentDocuments),
      }
    })
  }

  const {
    hydrationErrors: activeHydrationErrors,
    hydratingRows: activeHydratingRows,
    hydrateLazyRow,
  } = useDocumentLazyHydration({
    collection,
    database,
    documents,
    draftDocuments,
    editContext,
    tabId,
    resetKey: documentResetToken,
    suspended: executionLocked,
    onFetchDocumentNodeChildren,
    onHydrated: (row, response) => {
      updateDraftDocuments((current) =>
        current.map((item, index) =>
          index === row.documentIndex ? setValueAtPath(item, row.path, response.value) : item,
        ),
      )
      setExpandedRows((current) => new Set(current).add(row.id))
      if (response.notices.length > 0) {
        setCopyMessage(response.notices[0] ?? 'Field expanded.')
      }
    },
    onMessage: setCopyMessage,
  })

  const applyDocumentEdit = (
    row: DocumentGridRow,
    editKind: DataEditKind,
    changes: DataEditChange[],
    updater: (current: Array<Record<string, unknown>>) => Array<Record<string, unknown>>,
    successMessage: string,
  ) => {
    if (executionLocked) {
      setCopyMessage('Wait for the running query to finish before editing this result.')
      return
    }
    void (async () => {
      try {
        if (onExecuteDataEdit && editContext && connection) {
          const request = buildDocumentEditRequest(
            connection,
            editContext,
            draftDocuments,
            row,
            editKind,
            changes,
          )

          if (!request) {
            setCopyMessage('Edit kept locally; collection scope or document id is unavailable.')
            updateDraftDocuments(updater)
            return
          }

          const response = await executeDataEditWithConfirmation(
            onExecuteDataEdit,
            request,
            {
              actionLabel: successMessage,
              confirm: confirmDataEdit,
              confirmationTitle: 'Apply this document edit?',
            },
          )
          const failureMessage = dataEditStatusMessage(
            response,
            'Datastore did not confirm the edit.',
          )

          if (!response?.executed) {
            setCopyMessage(failureMessage)
            return
          }
        }

        updateDraftDocuments(updater)
        setCopyMessage(successMessage)
      } catch (error) {
        setCopyMessage(dataEditErrorMessage(error, 'Document edit failed.'))
      }
    })()
  }

  const beginEditing = (row: DocumentGridRow, cell: DocumentEditCell) => {
    if (executionLocked) {
      return
    }
    const permissions = editablePermissions(row, behavior)

    if (
      (cell === 'field' && !permissions.canEditField) ||
      (cell === 'value' && !permissions.canEditLeaf) ||
      (cell === 'type' && !permissions.canChangeType)
    ) {
      return
    }

    setDraftState((current) =>
      current.source === documents ? current : { source: documents, documents },
    )
    setActiveEditor({ rowId: row.id, cell })
  }

  const stopEditing = () => setActiveEditor(undefined)

  const toggleRow = (row: DocumentGridRow) => {
    if (expandedRows.has(row.id)) {
      setExpandedRows((current) => {
        const next = new Set(current)
        next.delete(row.id)
        return next
      })
      return
    }

    if (isDocumentLazyNode(row.value)) {
      void hydrateLazyRow(row)
      return
    }

    setExpandedRows((current) => {
      const next = new Set(current)
      next.add(row.id)
      return next
    })
  }

  const expandAll = () => {
    expandAllAbortRef.current?.abort()
    const controller = new AbortController()
    expandAllAbortRef.current = controller
    setExpandAllState({ documents: draftDocuments, pending: true })
    void collectExpandableRowIdsCooperative(
      draftDocuments,
      controller.signal,
    )
      .then(async (rowIds) => {
        if (controller.signal.aborted) {
          return
        }
        const nextExpandedRows = new Set(rowIds)
        const index = await createDocumentTreeIndexCooperative(
          draftDocuments,
          nextExpandedRows,
          controller.signal,
        )
        if (!controller.signal.aborted) {
          setPreparedTreeIndex({
            documents: draftDocuments,
            expandedRows: nextExpandedRows,
            index,
          })
          setExpandedRows(nextExpandedRows)
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setCopyMessage('Expand All could not be completed.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          expandAllAbortRef.current = undefined
          setExpandAllState({ documents: draftDocuments, pending: false })
        }
      })
  }

  const collapseAll = () => {
    expandAllAbortRef.current?.abort()
    expandAllAbortRef.current = undefined
    setPreparedTreeIndex(undefined)
    setExpandAllState({ documents: draftDocuments, pending: false })
    setExpandedRows(new Set())
  }

  const copyValue = async (value: unknown) => {
    await copyText(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    setCopyMessage('Copied value.')
  }

  const scheduleCopyValue = (value: unknown) => {
    if (copyTimer.current !== undefined) {
      window.clearTimeout(copyTimer.current)
    }

    copyTimer.current = window.setTimeout(() => {
      copyTimer.current = undefined
      void copyValue(value)
    }, 180)
  }

  const cancelScheduledCopy = () => {
    if (copyTimer.current !== undefined) {
      window.clearTimeout(copyTimer.current)
      copyTimer.current = undefined
    }
  }

  const copyDocument = async (row: DocumentGridRow) => {
    await copyText(JSON.stringify(draftDocuments[row.documentIndex], null, 2))
    setCopyMessage('Copied document JSON.')
  }

  const updateRowValue = (
    row: DocumentGridRow,
    nextValue: unknown,
    editKind: 'set-field' | 'change-field-type' = 'set-field',
  ) => {
    if (!behavior.canEditDocuments || row.path.length === 0) {
      return
    }

    applyDocumentEdit(
      row,
      editKind,
      [
        {
          path: pathSegments(row.path),
          value: nextValue,
          valueType: valueTypeName(nextValue),
        },
      ],
      (current) =>
        current.map((document, index) =>
          index === row.documentIndex ? setValueAtPath(document, row.path, nextValue) : document,
        ),
      editKind === 'change-field-type' ? 'Changed field type.' : 'Updated field value.',
    )
  }

  const renameRowField = (row: DocumentGridRow, nextFieldName: string) => {
    if (!behavior.canRenameFields || row.path.length === 0 || !nextFieldName.trim()) {
      return
    }

    const nextName = nextFieldName.trim()

    applyDocumentEdit(
      row,
      'rename-field',
      [
        {
          path: pathSegments(row.path),
          newName: pathSegments([...row.parentPath, nextName]).join('.'),
        },
      ],
      (current) =>
        current.map((document, index) =>
          index === row.documentIndex
            ? renameFieldAtPath(document, row.parentPath, row.path.at(-1), nextName)
            : document,
        ),
      'Renamed field.',
    )
  }

  const deleteRowField = (row: DocumentGridRow) => {
    if (!behavior.canEditDocuments || row.path.length === 0) {
      return
    }

    stopEditing()
    setInspectorRowId(undefined)
    applyDocumentEdit(
      row,
      'unset-field',
      [
        {
          path: pathSegments(row.path),
        },
      ],
      (current) =>
        current.map((document, index) =>
          index === row.documentIndex ? deleteValueAtPath(document, row.path) : document,
        ),
      'Deleted field.',
    )
  }

  const deleteDocument = (row: DocumentGridRow) => {
    if (executionLocked) {
      setCopyMessage('Wait for the running query to finish before deleting this document.')
      return
    }
    void (async () => {
      if (!onExecuteDataEdit || !editContext || !connection) {
        setCopyMessage('Delete unavailable; data edit execution is unavailable.')
        return
      }

      const request = buildDocumentDeleteRequest(connection, editContext, draftDocuments, row)

      if (!request) {
        setCopyMessage('Delete unavailable; DataPad++ needs a collection and stable _id.')
        return
      }

      try {
        const response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
          actionLabel: 'Delete this document.',
          confirm: confirmDataEdit,
          confirmationTitle: 'Delete this document?',
        })
        const failureMessage = dataEditStatusMessage(
          response,
          'Datastore did not confirm the delete.',
        )

        if (!response?.executed) {
          setCopyMessage(failureMessage)
          return
        }

        stopEditing()
        setInspectorRowId(undefined)
        updateDraftDocuments((current) =>
          current.filter((_document, index) => index !== row.documentIndex),
        )
        setCopyMessage(response.messages.at(-1) ?? 'Deleted document.')
      } catch (error) {
        setCopyMessage(dataEditErrorMessage(error, 'Document delete failed.'))
      }
    })()
  }

  const changeRowType = (row: DocumentGridRow, nextType: DocumentValueType) => {
    updateRowValue(row, coerceValue(row.value, nextType), 'change-field-type')
  }

  const renderDocumentRow = (row: DocumentGridRow) => (
    <DocumentGridRowView
      key={row.id}
      row={row}
      error={activeHydrationErrors.get(row.id)}
      expanded={effectiveExpandedRows.has(row.id)}
      loading={activeHydratingRows.has(row.id)}
      matched={hasSearch && searchResult.matchedRowIds.has(row.id)}
      editingCell={
        effectiveActiveEditor?.rowId === row.id ? effectiveActiveEditor.cell : undefined
      }
      onBeginEditing={beginEditing}
      onCancelScheduledCopy={cancelScheduledCopy}
      onContextMenu={(selectedRow, x, y) =>
        setContextMenu({ source: documents, x, y, row: selectedRow })}
      onRenameField={renameRowField}
      onScheduleCopyValue={scheduleCopyValue}
      onStopEditing={stopEditing}
      onToggleRow={toggleRow}
      onUpdateValue={updateRowValue}
    />
  )

  if (documents.length === 0) {
    return <p className="panel-footnote">No documents returned.</p>
  }

  return (
    <div className="document-data-grid-shell" aria-label="Document results">
      <DocumentResultsToolbar
        efficiencyModeEnabled={efficiencyModeEnabled}
        hasSearch={hasSearch}
        hasExpandedRows={expandedRows.size > 0}
        matchCount={searchResult.matchCount}
        expandAllPending={expandAllPending}
        searchInput={searchInput}
        searchPending={searchPending}
        onCollapseAll={collapseAll}
        onExpandAll={expandAll}
        onSearchInputChange={setSearchInput}
      />
      <div className={`document-results-content${inspectorRow && inspectorDocument ? ' has-inspector' : ''}`}>
        <div className="document-data-grid-frame">
          <DocumentVirtualGridRows
            rowCount={treeIndex.rowCount}
            rowAt={treeIndex.rowAt}
            renderRow={renderDocumentRow}
          />
          {hasSearch && treeIndex.rowCount === 0 ? (
            <p className="document-results-empty-search">No loaded documents match this search.</p>
          ) : null}
        </div>
        {inspectorRow && inspectorDocument ? (
          <DocumentFieldInspector
            canChangeType={Boolean(inspectorPermissions?.canChangeType)}
            document={inspectorDocument}
            row={inspectorRow}
            onChangeType={changeRowType}
            onClose={() => setInspectorRowId(undefined)}
          />
        ) : null}
      </div>
      <DocumentResultsFooter
        copyMessage={copyMessage}
        documentCountLabel={documentCountLabel}
        footerControls={footerControls}
        resultDurationMs={resultDurationMs}
        resultRuntimeTitle={resultRuntimeTitle}
      />
      {activeContextMenu ? (
        <DocumentContextMenu
          behavior={behavior}
          row={activeContextMenu.row}
          x={activeContextMenu.x}
          y={activeContextMenu.y}
          onClose={() => setContextMenu(undefined)}
          onCopyDocument={() => void copyDocument(activeContextMenu.row)}
          onCopyPath={() => void copyText(activeContextMenu.row.fieldPath || '$')}
          onCopyValue={() => void copyValue(activeContextMenu.row.value)}
          onDelete={() => {
            setPendingFieldDelete({ source: documents, row: activeContextMenu.row })
            setContextMenu(undefined)
          }}
          onDeleteDocument={() => {
            setPendingDocumentDelete({ source: documents, row: activeContextMenu.row })
            setContextMenu(undefined)
          }}
          documentDeleteUnavailableReason={
            activeContextMenu.row.path.length === 0 && !activeDocumentDeleteRequest
              ? 'DataPad++ needs a collection and stable _id before it can delete this document.'
              : undefined
          }
          onEditValue={() => {
            beginEditing(activeContextMenu.row, 'value')
          }}
          onRename={() => {
            beginEditing(activeContextMenu.row, 'field')
          }}
          onViewRawJson={() => setInspectorRowId(activeContextMenu.row.id)}
        />
      ) : null}
      {pendingFieldDeleteRow ? (
        <DeleteConfirmationPanel
          title={`Delete field ${pendingFieldDeleteRow.fieldPath || pathSegments(pendingFieldDeleteRow.path).join('.')}?`}
          body="DataPad++ will run this guarded field delete with confirmation."
          onCancel={() => setPendingFieldDelete(undefined)}
          onConfirm={() => {
            const row = pendingFieldDeleteRow
            setPendingFieldDelete(undefined)
            deleteRowField(row)
          }}
        />
      ) : null}
      {pendingDocumentDeleteRow ? (
        <DeleteConfirmationPanel
          title={`Delete document ${pendingDocumentDeleteRow.label}?`}
          body="DataPad++ will run this guarded document delete with confirmation."
          onCancel={() => setPendingDocumentDelete(undefined)}
          onConfirm={() => {
            const row = pendingDocumentDeleteRow
            setPendingDocumentDelete(undefined)
            deleteDocument(row)
          }}
        />
      ) : null}
      {confirmationDialog}
    </div>
  )
}
