import type {
  LibraryCreateFolderRequest,
  LibraryDeleteNodeRequest,
  LibraryMoveNodeRequest,
  LibraryNode,
  LibraryRenameNodeRequest,
  LibrarySetEnvironmentRequest,
  QueryTabState,
  SaveQueryTabToLibraryRequest,
  SaveQueryTabToLocalFileRequest,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { createId, editorLabelForConnection, languageForConnection } from '../../app/state/helpers'
import { cloneSnapshot } from './browser-store'
import {
  defaultLibraryFolderForConnection,
  effectiveConnectionEnvironmentId,
  ensureConnectionLibraryNodes,
} from './library-connection-helpers'

export function createLibraryFolder(
  snapshot: WorkspaceSnapshot,
  request: LibraryCreateFolderRequest,
) {
  const next = cloneSnapshot(snapshot)
  const name = request.name.trim()

  if (!name) {
    return next
  }

  const timestamp = new Date().toISOString()
  next.libraryNodes.push({
    id: createId('library-folder'),
    kind: 'folder',
    parentId: request.parentId,
    name,
    environmentId: request.environmentId,
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  next.updatedAt = timestamp
  return next
}

export function renameLibraryNode(
  snapshot: WorkspaceSnapshot,
  request: LibraryRenameNodeRequest,
) {
  const next = cloneSnapshot(snapshot)
  const name = request.name.trim()
  const node = next.libraryNodes.find((item) => item.id === request.nodeId)

  if (!node || !name) {
    return next
  }

  node.name = name
  node.updatedAt = new Date().toISOString()
  next.tabs.forEach((tab) => {
    if (tab.saveTarget?.kind === 'library' && tab.saveTarget.libraryItemId === node.id) {
      tab.title = name
    }
  })
  next.updatedAt = node.updatedAt
  return next
}

export function moveLibraryNode(
  snapshot: WorkspaceSnapshot,
  request: LibraryMoveNodeRequest,
) {
  const next = cloneSnapshot(snapshot)
  ensureConnectionLibraryNodes(next)
  const node = next.libraryNodes.find((item) => item.id === request.nodeId)
  const descendantIds = collectDescendantIds(next.libraryNodes, request.nodeId)

  if (
    !node ||
    (request.parentId && descendantIds.has(request.parentId)) ||
    (request.parentId &&
      next.libraryNodes.find((item) => item.id === request.parentId)?.kind !== 'folder')
  ) {
    return next
  }

  node.parentId = request.parentId
  node.updatedAt = new Date().toISOString()
  next.updatedAt = node.updatedAt
  return next
}

export function setLibraryNodeEnvironment(
  snapshot: WorkspaceSnapshot,
  request: LibrarySetEnvironmentRequest,
) {
  const next = cloneSnapshot(snapshot)
  const node = next.libraryNodes.find((item) => item.id === request.nodeId)

  if (!node) {
    return next
  }

  if (
    request.environmentId &&
    next.environments.every((environment) => environment.id !== request.environmentId)
  ) {
    return next
  }

  node.environmentId = request.environmentId?.trim() || undefined
  node.updatedAt = new Date().toISOString()
  next.updatedAt = node.updatedAt
  return next
}

export function deleteLibraryNode(
  snapshot: WorkspaceSnapshot,
  request: LibraryDeleteNodeRequest,
) {
  const next = cloneSnapshot(snapshot)
  const deletedIds = collectDescendantIds(next.libraryNodes, request.nodeId)

  next.libraryNodes = next.libraryNodes.filter((node) => !deletedIds.has(node.id))
  next.tabs.forEach((tab) => {
    if (tab.saveTarget?.kind === 'library' && deletedIds.has(tab.saveTarget.libraryItemId)) {
      tab.saveTarget = undefined
      tab.savedQueryId = undefined
      tab.dirty = true
    }
  })
  next.closedTabs.forEach((tab) => {
    if (tab.saveTarget?.kind === 'library' && deletedIds.has(tab.saveTarget.libraryItemId)) {
      tab.saveTarget = undefined
      tab.savedQueryId = undefined
    }
  })
  next.updatedAt = new Date().toISOString()
  return next
}

export function saveQueryTabToLibrary(
  snapshot: WorkspaceSnapshot,
  request: SaveQueryTabToLibraryRequest,
) {
  const next = cloneSnapshot(snapshot)
  const tab = next.tabs.find((item) => item.id === request.tabId)
  const name = request.name.trim()

  if (!tab || !name) {
    return next
  }

  const timestamp = new Date().toISOString()
  const itemId =
    request.itemId ??
    (tab.saveTarget?.kind === 'library' ? tab.saveTarget.libraryItemId : undefined) ??
    tab.savedQueryId ??
    createId('library-item')
  const kind = request.kind ?? 'query'
  const existingIndex = next.libraryNodes.findIndex((item) => item.id === itemId)
  const existingNode = existingIndex >= 0 ? next.libraryNodes[existingIndex] : undefined
  const parentId =
    request.folderId !== undefined
      ? request.folderId
      : existingNode
        ? existingNode.parentId
        : defaultLibraryFolderForConnection(next, tab.connectionId)
  const node: LibraryNode = {
    id: itemId,
    kind,
    parentId,
    name,
    summary: connectionSummary(next, tab),
    tags: request.tags ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    connectionId: tab.connectionId,
    environmentId: request.environmentId,
    language: tab.language,
    queryText: kind === 'script' || kind === 'test-suite' ? undefined : tab.queryText,
    queryViewMode: tab.queryViewMode,
    documentEfficiencyMode: tab.documentEfficiencyMode,
    scopedTarget: tab.scopedTarget,
    builderState: tab.builderState,
    scriptText: tab.scriptText ?? (kind === 'script' ? tab.queryText : undefined),
    testSuite: kind === 'test-suite' ? tab.testSuite : undefined,
  }
  if (existingIndex >= 0) {
    const existing = next.libraryNodes[existingIndex]
    node.createdAt = existing?.createdAt ?? timestamp
    next.libraryNodes[existingIndex] = node
  } else {
    next.libraryNodes.push(node)
  }

  tab.saveTarget = { kind: 'library', libraryItemId: itemId }
  tab.savedQueryId = itemId
  tab.title = name
  tab.dirty = false
  next.updatedAt = timestamp
  return next
}

export function saveQueryTabToLocalFile(
  snapshot: WorkspaceSnapshot,
  request: SaveQueryTabToLocalFileRequest,
) {
  const next = cloneSnapshot(snapshot)
  const tab = next.tabs.find((item) => item.id === request.tabId)
  const path = request.path?.trim()

  if (!tab || !path) {
    return next
  }

  tab.saveTarget = { kind: 'local-file', path }
  tab.savedQueryId = undefined
  tab.title = path.split(/[\\/]/).pop() || tab.title
  tab.dirty = false
  next.updatedAt = new Date().toISOString()
  return next
}

export function openLibraryItem(snapshot: WorkspaceSnapshot, libraryItemId: string) {
  const next = cloneSnapshot(snapshot)
  const item = next.libraryNodes.find((node) => node.id === libraryItemId)
  const queryText =
    item?.queryText ??
    item?.scriptText ??
    (item?.testSuite ? JSON.stringify(item.testSuite, null, 2) : undefined)

  if (!item || item.kind === 'folder' || item.kind === 'connection' || !queryText) {
    return next
  }

  const openedAt = new Date().toISOString()
  item.lastOpenedAt = openedAt
  next.updatedAt = openedAt

  const existingTab = next.tabs.find((tab) => isLibraryBackedTab(tab, item.id))
  if (existingTab) {
    next.ui.activeConnectionId = existingTab.connectionId
    next.ui.activeEnvironmentId = existingTab.environmentId
    next.ui.activeTabId = existingTab.id
    return next
  }

  const connection = item.connectionId
    ? next.connections.find((candidate) => candidate.id === item.connectionId)
    : next.connections.find((candidate) => candidate.id === next.ui.activeConnectionId) ??
      next.connections[0]

  if (!connection) {
    return next
  }

  const tab: QueryTabState = {
    id: createId('tab'),
    title: item.name,
    tabKind: item.kind === 'test-suite' ? 'test-suite' : 'query',
    connectionId: connection.id,
    environmentId:
      effectiveLibraryEnvironmentId(next.libraryNodes, item.id) ??
      effectiveConnectionEnvironmentId(next, connection),
    family: connection.family,
    language: item.language ?? languageForConnection(connection),
    editorLabel: editorLabelForConnection(connection),
    queryText,
    queryViewMode: item.queryViewMode ?? (item.kind === 'script' ? 'script' : undefined),
    scriptText: item.scriptText,
    documentEfficiencyMode: item.documentEfficiencyMode,
    scopedTarget: item.scopedTarget,
    builderState: item.builderState,
    testSuite: item.testSuite,
    status: 'idle',
    dirty: false,
    saveTarget: { kind: 'library', libraryItemId: item.id },
    savedQueryId: item.id,
    history: [],
  }

  next.tabs.push(tab)
  next.ui.activeConnectionId = tab.connectionId
  next.ui.activeEnvironmentId = tab.environmentId
  next.ui.activeTabId = tab.id
  next.updatedAt = new Date().toISOString()
  return next
}

function collectDescendantIds(nodes: LibraryNode[], nodeId: string) {
  const ids = new Set([nodeId])
  let changed = true

  while (changed) {
    changed = false
    nodes.forEach((node) => {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id)
        changed = true
      }
    })
  }

  return ids
}

export function effectiveLibraryEnvironmentId(nodes: LibraryNode[], nodeId: string) {
  let currentId: string | undefined = nodeId
  const visited = new Set<string>()

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const node = nodes.find((item) => item.id === currentId)
    if (!node) {
      return undefined
    }
    if (node.environmentId) {
      return node.environmentId
    }
    currentId = node.parentId
  }

  return undefined
}

function connectionSummary(snapshot: WorkspaceSnapshot, tab: QueryTabState) {
  const connection = snapshot.connections.find((item) => item.id === tab.connectionId)
  return connection?.name
}

function isLibraryBackedTab(tab: QueryTabState, libraryItemId: string) {
  return (
    (tab.saveTarget?.kind === 'library' && tab.saveTarget.libraryItemId === libraryItemId) ||
    tab.savedQueryId === libraryItemId
  )
}
