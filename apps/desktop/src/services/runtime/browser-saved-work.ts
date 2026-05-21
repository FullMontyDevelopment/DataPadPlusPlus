import type { QueryTabState, SavedWorkItem, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createId, editorLabelForConnection, languageForConnection } from '../../app/state/helpers'
import { cloneSnapshot, findTab } from './browser-store'
import { upsertTab } from './browser-tabs'

export function upsertSavedWork(
  snapshot: WorkspaceSnapshot,
  item: SavedWorkItem,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const updated = {
    ...item,
    updatedAt: new Date().toISOString(),
  }
  const index = next.savedWork.findIndex((existing) => existing.id === item.id)

  if (index >= 0) {
    next.savedWork[index] = updated
  } else {
    next.savedWork.push(updated)
  }

  for (const tab of next.tabs) {
    if (tab.savedQueryId === updated.id) {
      tab.queryText = updated.queryText ?? tab.queryText
      tab.title = updated.name
      tab.dirty = false
    }
  }

  next.updatedAt = new Date().toISOString()
  return next
}



export function saveQueryTab(
  snapshot: WorkspaceSnapshot,
  tabId: string,
  item: SavedWorkItem,
): WorkspaceSnapshot {
  const next = upsertSavedWork(snapshot, item)
  const tab = findTab(next, tabId)

  if (tab) {
    tab.savedQueryId = item.id
    tab.title = item.name
    tab.queryText = item.queryText ?? tab.queryText
    tab.dirty = false
  }

  next.updatedAt = new Date().toISOString()
  return next
}



export function deleteSavedWork(
  snapshot: WorkspaceSnapshot,
  savedWorkId: string,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  next.savedWork = next.savedWork.filter((item) => item.id !== savedWorkId)
  next.updatedAt = new Date().toISOString()
  return next
}



export function openSavedWork(
  snapshot: WorkspaceSnapshot,
  savedWorkId: string,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const item = next.savedWork.find((saved) => saved.id === savedWorkId)

  if (!item?.queryText) {
    return next
  }

  const connection =
    next.connections.find((candidate) => candidate.id === item.connectionId) ??
    next.connections.find((candidate) => candidate.id === next.ui.activeConnectionId) ??
    next.connections[0]

  if (!connection) {
    return next
  }

  const tab: QueryTabState = {
    id: createId('tab'),
    title: item.name,
    connectionId: connection.id,
    environmentId:
      item.environmentId ??
      connection.environmentIds[0] ??
      next.ui.activeEnvironmentId,
    family: connection.family,
    language: item.language ?? languageForConnection(connection),
    editorLabel: editorLabelForConnection(connection),
    queryText: item.queryText,
    status: 'idle',
    dirty: false,
    savedQueryId: item.id,
    history: [],
  }

  return upsertTab(next, tab)
}
