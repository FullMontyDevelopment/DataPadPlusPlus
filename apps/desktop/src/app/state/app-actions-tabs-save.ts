import type {
  BootstrapPayload,
  LibraryItemKind,
  QueryTabState,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { desktopClient } from '../../services/runtime/client'
import { defaultLibraryFolderForConnection } from '../../services/runtime/library-connection-helpers'
import { ensureWorkspaceUnlocked } from './app-state-factories'
import type { AppActionContext } from './app-state-types'

export async function saveQueryTabToCurrentTarget({
  payload,
  tabId,
  applyPayload,
  closeAfterSave = false,
}: {
  payload: BootstrapPayload | undefined
  tabId: string
  applyPayload: AppActionContext['applyPayload']
  closeAfterSave?: boolean
}) {
  if (!payload) {
    throw new Error('Workspace is not ready for Library saves.')
  }
  ensureWorkspaceUnlocked(payload)

  const tab = payload.snapshot.tabs.find((item) => item.id === tabId)
  if (!tab) {
    throw new Error('The active query tab cannot be saved yet.')
  }

  if (isNonSaveableTab(tab)) {
    if (closeAfterSave) {
      applyPayload(await desktopClient.closeQueryTab(tabId))
    }
    return
  }

  if (tab.saveTarget?.kind === 'local-file') {
    const savedPayload = await desktopClient.saveQueryTabToLocalFile({
      tabId,
      path: tab.saveTarget.path,
    })
    if (!closeAfterSave) {
      applyPayload(savedPayload)
      return
    }
  } else {
    const savedPayload = await desktopClient.saveQueryTabToLibrary({
      tabId,
      itemId:
        tab.saveTarget?.kind === 'library'
          ? tab.saveTarget.libraryItemId
          : tab.savedQueryId,
      folderId: defaultLibraryFolderForTab(payload.snapshot, tab),
      name: tab.title,
      kind: inferLibraryItemKind(payload.snapshot, tab),
      tags: [],
    })
    if (!closeAfterSave) {
      applyPayload(savedPayload)
      return
    }
  }

  applyPayload(await desktopClient.closeQueryTab(tabId))
}

function isNonSaveableTab(tab: QueryTabState) {
  return ['explorer', 'metrics', 'object-view'].includes(tab.tabKind ?? '')
}

function inferLibraryItemKind(
  snapshot: WorkspaceSnapshot,
  tab: QueryTabState,
): LibraryItemKind {
  const existingItemId =
    tab.saveTarget?.kind === 'library' ? tab.saveTarget.libraryItemId : tab.savedQueryId
  const existingNode = snapshot.libraryNodes.find((node) => node.id === existingItemId)

  if (
    existingNode?.kind &&
    existingNode.kind !== 'folder' &&
    existingNode.kind !== 'connection'
  ) {
    return existingNode.kind
  }

  if (tab.tabKind === 'test-suite' || tab.testSuite) {
    return 'test-suite'
  }

  if (/\.(ps1|sh|bash|bat|cmd|js|ts|py)$/i.test(tab.title)) {
    return 'script'
  }

  return 'query'
}

function defaultLibraryFolderForTab(snapshot: WorkspaceSnapshot, tab: QueryTabState) {
  return defaultLibraryFolderForConnection(snapshot, tab.connectionId)
}
