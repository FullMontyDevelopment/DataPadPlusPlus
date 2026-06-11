import { useEffect, useState } from 'react'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from '../../../results/document-edit-context'
import {
  dataEditStatusMessage,
  executeDataEditWithConfirmation,
} from '../../../results/data-edit-confirmation'
import { useDataEditConfirmation } from '../../../results/use-data-edit-confirmation'
import { JsonTreeView } from '../../../results/JsonTreeView'
import { SearchHitsContextMenu } from './SearchHitsContextMenu'
import {
  SearchDocumentDeletePanel,
  SearchDocumentEditorPanel,
  SearchDocumentIndexPanel,
} from './SearchHitsEditPanels'
import { SearchHitsHeader } from './SearchHitsHeader'
import { SearchHitsRows } from './SearchHitsRows'
import { usePayloadBackedSearchHits } from './SearchHitsState'
import { hitByTarget, hitIdAt, type SearchHitTarget } from './SearchHitsTargeting'
import { parseSearchHitSourceJson, stringifySearchHitSource } from '../../../results/search-hit-json'
import {
  buildSearchDocumentEditRequest,
  buildSearchDocumentIndexRequest,
  searchCanEdit,
  searchHitId,
  searchHitIndex,
  searchHitSource,
  searchIndexFromQueryText,
} from '../../../results/search-hit-edit-requests'

type SearchHitsPayload = Extract<ResultPayload, { renderer: 'searchHits' }>

interface SearchHitsResultsViewProps {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  payload: SearchHitsPayload
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
}

interface ContextMenuState extends SearchHitTarget {
  x: number
  y: number
}

type PendingDeleteState = SearchHitTarget

interface PendingUpdateState extends SearchHitTarget {
  error?: string
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
  const { hits, updateHits } = usePayloadBackedSearchHits(payload.hits)
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
  const contextMenuHit = hitByTarget(hits, contextMenu)

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

    const hit = hitByTarget(hits, pendingUpdate)
    if (!hit) {
      setPendingUpdate(undefined)
      setStatusMessage('Search document is no longer loaded.')
      return
    }

    const source = parseSearchHitSourceJson(pendingUpdate.sourceText)
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
      hit,
      source,
    })
    const hitIndex = pendingUpdate.hitIndex
    setPendingUpdate(undefined)

    if (!request) {
      setStatusMessage('Update unavailable; DataPad++ could not identify the search index and document id.')
      return
    }

    let response: DataEditExecutionResponse | undefined
    try {
      response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
        actionLabel: 'Update this search document.',
        confirm: confirmDataEdit,
        confirmationTitle: 'Apply this document update?',
      })
    } catch {
      setStatusMessage('Search document update failed.')
      return
    }
    if (response?.executed) {
      updateHits((current) =>
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

    const source = parseSearchHitSourceJson(pendingIndex.sourceText)
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

    let response: DataEditExecutionResponse | undefined
    try {
      response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
        actionLabel: `Index document ${documentId}.`,
        confirm: confirmDataEdit,
        confirmationTitle: 'Index this document?',
      })
    } catch {
      setStatusMessage('Search document index failed.')
      return
    }
    if (response?.executed) {
      updateHits((current) => [
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

    const hit = hitByTarget(hits, pendingDelete)
    if (!hit) {
      setPendingDelete(undefined)
      setStatusMessage('Search document is no longer loaded.')
      return
    }

    const request = buildSearchDocumentEditRequest({
      connection,
      editContext,
      editKind: 'delete-document',
      hit,
    })
    const hitIndex = pendingDelete.hitIndex
    setPendingDelete(undefined)

    if (!request) {
      setStatusMessage('Delete unavailable; DataPad++ could not identify the search index and document id.')
      return
    }

    let response: DataEditExecutionResponse | undefined
    try {
      response = await executeDataEditWithConfirmation(
        onExecuteDataEdit,
        request,
        {
          actionLabel: 'Delete this search document.',
          confirm: confirmDataEdit,
          confirmationTitle: 'Delete this document?',
        },
      )
    } catch {
      setStatusMessage('Search document deletion failed.')
      return
    }
    if (response?.executed) {
      updateHits((current) => current.filter((_, index) => index !== hitIndex))
      setStatusMessage('Deleted search document.')
    } else {
      setStatusMessage(dataEditStatusMessage(response, 'Unable to delete search document.'))
    }
  }

  return (
    <div className="search-hits-results" role="region" aria-label="Search hits results">
      <SearchHitsHeader />
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
              hitId: hitIdAt(hits, hitIndex),
              hitIndex,
              sourceText: stringifySearchHitSource(source, 2),
            })
          }
          onOpenContextMenu={(hitIndex, x, y) =>
            setContextMenu({ hitId: hitIdAt(hits, hitIndex), hitIndex, x, y })
          }
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
      {contextMenu && contextMenuHit ? (
        <SearchHitsContextMenu
          canEdit={canEdit}
          documentId={searchHitId(contextMenuHit) ?? ''}
          sourceText={stringifySearchHitSource(searchHitSource(contextMenuHit))}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(undefined)}
          onUpdate={() =>
            setPendingUpdate({
              hitId: contextMenu.hitId,
              hitIndex: contextMenu.hitIndex,
              sourceText: stringifySearchHitSource(searchHitSource(contextMenuHit), 2),
            })
          }
          onDelete={() => {
            if (!connection) {
              return
            }
            setPendingDelete({
              hitId: contextMenu.hitId,
              hitIndex: contextMenu.hitIndex,
            })
          }}
        />
      ) : null}
    </div>
  )
}
