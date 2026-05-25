import { useEffect, useState } from 'react'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from './document-edit-context'
import {
  dataEditStatusMessage,
  executeDataEditWithConfirmation,
} from './data-edit-confirmation'
import { useDataEditConfirmation } from './use-data-edit-confirmation'
import { JsonTreeView } from './JsonTreeView'
import { SearchHitsContextMenu } from './SearchHitsContextMenu'
import {
  SearchDocumentDeletePanel,
  SearchDocumentEditorPanel,
  SearchDocumentIndexPanel,
} from './SearchHitsEditPanels'
import { SearchHitsRows } from './SearchHitsRows'
import {
  buildSearchDocumentEditRequest,
  buildSearchDocumentIndexRequest,
  searchCanEdit,
  searchHitId,
  searchHitIndex,
  searchHitSource,
  searchIndexFromQueryText,
  type SearchHit,
} from './search-hit-edit-requests'

type SearchHitsPayload = Extract<ResultPayload, { renderer: 'searchHits' }>

interface SearchHitsResultsViewProps {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  payload: SearchHitsPayload
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
}

interface ContextMenuState {
  hitIndex: number
  x: number
  y: number
}

interface PendingDeleteState {
  hitIndex: number
}

interface PendingUpdateState {
  error?: string
  hitIndex: number
  sourceText: string
}

interface PendingIndexState {
  documentId: string
  editingSource: boolean
  error?: string
  index?: string
  sourceText: string
}

export function SearchHitsResultsView({
  connection,
  editContext,
  payload,
  onExecuteDataEdit,
}: SearchHitsResultsViewProps) {
  const [hits, setHits] = useState<SearchHit[]>(payload.hits)
  const [expandedHits, setExpandedHits] = useState<Set<number>>(new Set())
  const [contextMenu, setContextMenu] = useState<ContextMenuState>()
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState>()
  const [pendingIndex, setPendingIndex] = useState<PendingIndexState>()
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdateState>()
  const [statusMessage, setStatusMessage] = useState('')
  const { confirmDataEdit, confirmationDialog } = useDataEditConfirmation()
  const canEdit = searchCanEdit(connection, editContext) && Boolean(onExecuteDataEdit)
  const defaultIndex =
    searchHitIndex(hits[0], editContext) ??
    searchIndexFromQueryText(editContext?.queryText)

  useEffect(() => {
    if (!contextMenu) {
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
  }, [contextMenu])

  const updateDocument = async () => {
    if (!pendingUpdate || !onExecuteDataEdit) {
      return
    }

    const source = parseSourceJson(pendingUpdate.sourceText)
    if (!source) {
      setPendingUpdate((current) =>
        current ? { ...current, error: 'Source JSON must be an object.' } : current,
      )
      return
    }

    const request = buildSearchDocumentEditRequest({
      connection,
      editContext,
      editKind: 'update-document',
      hit: hits[pendingUpdate.hitIndex]!,
      source,
    })
    const hitIndex = pendingUpdate.hitIndex
    setPendingUpdate(undefined)

    if (!request) {
      setStatusMessage('Update unavailable; DataPad++ could not identify the search index and document id.')
      return
    }

    const response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
      actionLabel: 'Update this search document.',
      confirm: confirmDataEdit,
      confirmationTitle: 'Apply this document update?',
    })
    if (response?.executed) {
      setHits((current) =>
        current.map((hit, index) =>
          index === hitIndex ? { ...hit, source, _source: source } : hit,
        ),
      )
      setStatusMessage('Updated search document.')
    } else {
      setStatusMessage(dataEditStatusMessage(response, 'Unable to update search document.'))
    }
  }

  const indexDocument = async () => {
    if (!pendingIndex || !onExecuteDataEdit) {
      return
    }

    const source = parseSourceJson(pendingIndex.sourceText)
    if (!source) {
      setPendingIndex((current) =>
        current ? { ...current, error: 'Source JSON must be an object.' } : current,
      )
      return
    }

    const request = buildSearchDocumentIndexRequest({
      connection,
      documentId: pendingIndex.documentId,
      editContext,
      index: pendingIndex.index,
      source,
    })
    const documentId = pendingIndex.documentId.trim()
    const index = pendingIndex.index?.trim()
    setPendingIndex(undefined)

    if (!request || !index) {
      setStatusMessage('Index unavailable; DataPad++ needs an index and document id.')
      return
    }

    const response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
      actionLabel: `Index document ${documentId}.`,
      confirm: confirmDataEdit,
      confirmationTitle: 'Index this document?',
    })
    if (response?.executed) {
      setHits((current) => [
        { id: documentId, _id: documentId, _index: index, source, _source: source },
        ...current,
      ])
      setStatusMessage('Indexed search document.')
    } else {
      setStatusMessage(dataEditStatusMessage(response, 'Unable to index search document.'))
    }
  }

  const deleteDocument = async () => {
    if (!pendingDelete || !onExecuteDataEdit) {
      return
    }

    const request = buildSearchDocumentEditRequest({
      connection,
      editContext,
      editKind: 'delete-document',
      hit: hits[pendingDelete.hitIndex]!,
    })
    const hitIndex = pendingDelete.hitIndex
    setPendingDelete(undefined)

    if (!request) {
      setStatusMessage('Delete unavailable; DataPad++ could not identify the search index and document id.')
      return
    }

    const response = await executeDataEditWithConfirmation(
      onExecuteDataEdit,
      request,
      {
        actionLabel: 'Delete this search document.',
        confirm: confirmDataEdit,
        confirmationTitle: 'Delete this document?',
      },
    )
    if (response?.executed) {
      setHits((current) => current.filter((_, index) => index !== hitIndex))
      setStatusMessage('Deleted search document.')
    } else {
      setStatusMessage(dataEditStatusMessage(response, 'Unable to delete search document.'))
    }
  }

  return (
    <div className="search-hits-results" role="region" aria-label="Search hits results">
      <div className="search-hits-header" role="row">
        <span>Index</span>
        <span>ID</span>
        <span>Score</span>
        <span>Source</span>
      </div>
      {canEdit ? (
        <div className="search-hit-actions">
          <button
            type="button"
            className="drawer-button"
            onClick={() =>
              setPendingIndex({
                documentId: '',
                editingSource: false,
                index: defaultIndex,
                sourceText: '{\n  "status": "new"\n}',
              })
            }
          >
            Add Document
          </button>
        </div>
      ) : null}
      {pendingIndex && !pendingIndex.editingSource ? (
        <SearchDocumentIndexPanel
          documentId={pendingIndex.documentId}
          index={pendingIndex.index ?? ''}
          indexMissing={!pendingIndex.index}
          onCancel={() => setPendingIndex(undefined)}
          onDocumentIdChange={(documentId) =>
            setPendingIndex((current) => (current ? { ...current, documentId } : current))
          }
          onOpenEditor={() =>
            setPendingIndex((current) =>
              current ? { ...current, editingSource: true } : current,
            )
          }
        />
      ) : null}
      <div className="search-hits-body">
        <SearchHitsRows
          canEdit={canEdit}
          editContext={editContext}
          expandedHits={expandedHits}
          hits={hits}
          onBeginUpdate={(hitIndex, source) =>
            setPendingUpdate({
              hitIndex,
              sourceText: JSON.stringify(source, null, 2),
            })
          }
          onOpenContextMenu={(hitIndex, x, y) => setContextMenu({ hitIndex, x, y })}
          onToggleExpanded={(hitIndex) =>
            setExpandedHits((current) => {
              const next = new Set(current)
              if (next.has(hitIndex)) {
                next.delete(hitIndex)
              } else {
                next.add(hitIndex)
              }
              return next
            })
          }
        />
        {payload.aggregations && Object.keys(payload.aggregations).length > 0 ? (
          <div className="search-hit-detail">
            <JsonTreeView value={payload.aggregations} label="aggregations" />
          </div>
        ) : null}
      </div>
      {pendingIndex?.editingSource ? (
        <SearchDocumentEditorPanel
          error={pendingIndex.error}
          mode="index"
          sourceText={pendingIndex.sourceText}
          onCancel={() => setPendingIndex(undefined)}
          onSourceTextChange={(sourceText) =>
            setPendingIndex((current) =>
              current ? { ...current, sourceText, error: undefined } : current,
            )
          }
          onSubmit={() => void indexDocument()}
        />
      ) : null}
      {pendingUpdate ? (
        <SearchDocumentEditorPanel
          error={pendingUpdate.error}
          mode="update"
          sourceText={pendingUpdate.sourceText}
          onCancel={() => setPendingUpdate(undefined)}
          onSourceTextChange={(sourceText) =>
            setPendingUpdate((current) =>
              current ? { ...current, sourceText, error: undefined } : current,
            )
          }
          onSubmit={() => void updateDocument()}
        />
      ) : null}
      {pendingDelete ? (
        <SearchDocumentDeletePanel
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={() => void deleteDocument()}
        />
      ) : null}
      {confirmationDialog}
      {statusMessage ? <div className="data-grid-status">{statusMessage}</div> : null}
      {contextMenu ? (
        <SearchHitsContextMenu
          canEdit={canEdit}
          documentId={searchHitId(hits[contextMenu.hitIndex]!) ?? ''}
          sourceText={JSON.stringify(searchHitSource(hits[contextMenu.hitIndex]!))}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(undefined)}
          onUpdate={() =>
            setPendingUpdate({
              hitIndex: contextMenu.hitIndex,
              sourceText: JSON.stringify(searchHitSource(hits[contextMenu.hitIndex]!), null, 2),
            })
          }
          onDelete={() => {
            if (!connection) {
              return
            }
            setPendingDelete({
              hitIndex: contextMenu.hitIndex,
            })
          }}
        />
      ) : null}
    </div>
  )
}

function parseSourceJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}
