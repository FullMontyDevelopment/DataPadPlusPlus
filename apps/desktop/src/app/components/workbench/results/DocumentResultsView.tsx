import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ConnectionProfile,
  DataEditChange,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  DataEditKind,
  DocumentNodeChildrenRequest,
  DocumentNodeChildrenResponse,
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
  buildDocumentEditRequest,
  pathSegments,
  valueTypeName,
} from './document-edit-requests'
import { DocumentGridRowView } from './DocumentGridRowView'
import { DocumentVirtualGridRows } from './DocumentVirtualGridRows'
import { documentResultBehaviorForConnection } from './datastore-result-behaviors'
import {
  dataEditStatusMessage,
  executeDataEditWithConfirmation,
} from './data-edit-confirmation'
import { editablePermissions } from './document-edit-permissions'
import {
  buildRows,
  collectExpandableRowIds,
  coerceValue,
  deleteValueAtPath,
  isDocumentLazyNode,
  renameFieldAtPath,
  setValueAtPath,
  type DocumentGridRow,
  type DocumentValueType,
} from './document-grid-model'
import { searchDocumentRows } from './document-grid-search'
import { documentCountText } from './document-results-summary'
import { copyText } from './payload-export'
import { useDataEditConfirmation } from './use-data-edit-confirmation'

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
  onFetchDocumentNodeChildren?(
    request: DocumentNodeChildrenRequest,
  ): Promise<DocumentNodeChildrenResponse | undefined>
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
const EMPTY_ROW_ID_SET = new Set<string>()

interface ActiveEditorState {
  rowId: string
  cell: DocumentEditCell
}

interface SourceScopedRowIds {
  source: Array<Record<string, unknown>>
  ids: Set<string>
}

interface PendingFieldDeleteState {
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
  onFetchDocumentNodeChildren,
  onExecuteDataEdit,
}: DocumentResultsViewProps) {
  const behavior = documentResultBehaviorForConnection(connection)
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
  const [inspectorRowId, setInspectorRowId] = useState<string>()
  const [pendingFieldDelete, setPendingFieldDelete] = useState<PendingFieldDeleteState>()
  const [hydratingRows, setHydratingRows] = useState<SourceScopedRowIds>(() => ({
    source: documents,
    ids: new Set(),
  }))
  const {
    cancelDataEditConfirmation,
    confirmDataEdit,
    confirmationDialog,
  } = useDataEditConfirmation()
  const draftDocuments = draftState.source === documents ? draftState.documents : documents
  const efficiencyModeEnabled = hydrationMode === 'lazy'
  const effectiveActiveEditor = draftState.source === documents ? activeEditor : undefined
  const activeContextMenu = contextMenu?.source === documents ? contextMenu : undefined
  const activeHydratingRows = hydratingRows.source === documents
    ? hydratingRows.ids
    : EMPTY_ROW_ID_SET
  const pendingFieldDeleteRow = pendingFieldDelete?.source === documents
    ? pendingFieldDelete.row
    : undefined
  const copyTimer = useRef<number | undefined>(undefined)
  const searchPending = searchInput.trim() !== searchText.trim()
  const searchResult = useMemo(
    () => searchDocumentRows(draftDocuments, searchText),
    [draftDocuments, searchText],
  )
  const hasSearch = searchText.trim().length > 0
  const effectiveExpandedRows = useMemo(() => {
    if (!hasSearch) {
      return expandedRows
    }

    return new Set([...expandedRows, ...searchResult.expandedRowIds])
  }, [expandedRows, hasSearch, searchResult.expandedRowIds])
  const rows = useMemo(
    () => buildRows(draftDocuments, effectiveExpandedRows),
    [draftDocuments, effectiveExpandedRows],
  )
  const visibleRows = useMemo(
    () => (hasSearch ? rows.filter((row) => searchResult.visibleRowIds.has(row.id)) : rows),
    [hasSearch, rows, searchResult.visibleRowIds],
  )
  const inspectorVisibleRow = inspectorRowId
    ? rows.find((row) => row.id === inspectorRowId)
    : undefined
  const inspectorFallbackRows = useMemo(
    () =>
      inspectorRowId && !inspectorVisibleRow
        ? buildRows(draftDocuments, new Set(collectExpandableRowIds(draftDocuments)))
        : [],
    [draftDocuments, inspectorRowId, inspectorVisibleRow],
  )
  const inspectorRow =
    inspectorVisibleRow ??
    (inspectorRowId
      ? inspectorFallbackRows.find((row) => row.id === inspectorRowId)
      : undefined)
  const inspectorDocument =
    inspectorRow && draftDocuments[inspectorRow.documentIndex]
      ? draftDocuments[inspectorRow.documentIndex]
      : undefined
  const inspectorPermissions = inspectorRow
    ? editablePermissions(inspectorRow, behavior)
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
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchText(searchInput)
    }, DOCUMENT_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [searchInput])

  useEffect(() => {
    if (copyTimer.current !== undefined) {
      window.clearTimeout(copyTimer.current)
      copyTimer.current = undefined
    }

    cancelDataEditConfirmation()
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

  const applyDocumentEdit = (
    row: DocumentGridRow,
    editKind: DataEditKind,
    changes: DataEditChange[],
    updater: (current: Array<Record<string, unknown>>) => Array<Record<string, unknown>>,
    successMessage: string,
  ) => {
    void (async () => {
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
    })()
  }

  const beginEditing = (row: DocumentGridRow, cell: DocumentEditCell) => {
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

  const hydrateLazyRow = async (row: DocumentGridRow) => {
    if (!onFetchDocumentNodeChildren || !editContext || !tabId || !collection) {
      setCopyMessage('Run a full query or select a collection before expanding this field.')
      return
    }

    const document = draftDocuments[row.documentIndex]
    const documentId = document?._id

    if (documentId === undefined) {
      setCopyMessage('This document cannot be expanded because its _id is unavailable.')
      return
    }

    setHydratingRows((current) => {
      const ids = new Set(current.source === documents ? current.ids : EMPTY_ROW_ID_SET)
      ids.add(row.id)
      return { source: documents, ids }
    })

    try {
      const response = await onFetchDocumentNodeChildren({
        tabId,
        connectionId: editContext.connectionId,
        environmentId: editContext.environmentId,
        database,
        collection,
        documentId,
        path: row.path,
        queryText: editContext.queryText,
      })

      if (!response) {
        setCopyMessage('Unable to expand this field.')
        return
      }

      updateDraftDocuments((current) =>
        current.map((item, index) =>
          index === row.documentIndex ? setValueAtPath(item, row.path, response.value) : item,
        ),
      )
      setExpandedRows((current) => new Set(current).add(row.id))
      if (response.notices.length > 0) {
        setCopyMessage(response.notices[0] ?? 'Field expanded.')
      }
    } catch {
      setCopyMessage('Unable to expand this field.')
    } finally {
      setHydratingRows((current) => {
        const next = new Set(current.source === documents ? current.ids : EMPTY_ROW_ID_SET)
        next.delete(row.id)
        return { source: documents, ids: next }
      })
    }
  }

  const expandAll = () => {
    setExpandedRows(new Set(collectExpandableRowIds(draftDocuments)))
  }

  const collapseAll = () => {
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

  const changeRowType = (row: DocumentGridRow, nextType: DocumentValueType) => {
    updateRowValue(row, coerceValue(row.value, nextType), 'change-field-type')
  }

  const renderDocumentRow = (row: DocumentGridRow) => (
    <DocumentGridRowView
      key={row.id}
      row={row}
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
        matchCount={searchResult.matchCount}
        searchInput={searchInput}
        searchPending={searchPending}
        onCollapseAll={collapseAll}
        onExpandAll={expandAll}
        onSearchInputChange={setSearchInput}
      />
      <div className={`document-results-content${inspectorRow && inspectorDocument ? ' has-inspector' : ''}`}>
        <div className="document-data-grid-frame">
          <DocumentVirtualGridRows rows={visibleRows} renderRow={renderDocumentRow} />
          {hasSearch && visibleRows.length === 0 ? (
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
      {confirmationDialog}
    </div>
  )
}
