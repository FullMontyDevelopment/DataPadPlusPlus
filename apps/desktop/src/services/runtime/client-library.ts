import type {
  BootstrapPayload,
  LibraryCreateFolderRequest,
  LibraryDeleteNodeRequest,
  LibraryDuplicateNodeRequest,
  LibraryMoveNodeRequest,
  LibraryRenameNodeRequest,
  LibrarySetEnvironmentRequest,
  SaveQueryTabToLibraryRequest,
  SaveQueryTabToLocalFileRequest,
} from '@datapadplusplus/shared-types'
import {
  createLibraryFolder,
  deleteLibraryNode,
  duplicateLibraryNode,
  moveLibraryNode,
  openLibraryItem,
  renameLibraryNode,
  saveQueryTabToLibrary,
  saveQueryTabToLocalFile,
  setLibraryNodeEnvironment,
} from './browser-library'
import { buildBrowserPayload, loadBrowserSnapshot, saveBrowserSnapshot } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'
import {
  validateCreateLibraryFolderRequest,
  validateDeleteLibraryNodeRequest,
  validateDuplicateLibraryNodeRequest,
  validateMoveLibraryNodeRequest,
  validateRenameLibraryNodeRequest,
  validateRequiredTabId,
  validateSaveQueryTabToLibraryRequest,
  validateSaveQueryTabToLocalFileRequest,
  validateSetLibraryNodeEnvironmentRequest,
} from './request-validation'
import { validateRequiredId } from './datastores/common/request-validation-core'

export const clientLibrary = {
  async createLibraryFolder(request: LibraryCreateFolderRequest): Promise<BootstrapPayload> {
    request = validateCreateLibraryFolderRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_library_folder', { request })
    }

    const snapshot = createLibraryFolder(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async renameLibraryNode(request: LibraryRenameNodeRequest): Promise<BootstrapPayload> {
    request = validateRenameLibraryNodeRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('rename_library_node', { request })
    }

    const snapshot = renameLibraryNode(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async moveLibraryNode(request: LibraryMoveNodeRequest): Promise<BootstrapPayload> {
    request = validateMoveLibraryNodeRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('move_library_node', { request })
    }

    const snapshot = moveLibraryNode(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async setLibraryNodeEnvironment(
    request: LibrarySetEnvironmentRequest,
  ): Promise<BootstrapPayload> {
    request = validateSetLibraryNodeEnvironmentRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_library_node_environment', { request })
    }

    const snapshot = setLibraryNodeEnvironment(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async deleteLibraryNode(request: LibraryDeleteNodeRequest): Promise<BootstrapPayload> {
    request = validateDeleteLibraryNodeRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('delete_library_node', { request })
    }

    const snapshot = deleteLibraryNode(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async duplicateLibraryNode(request: LibraryDuplicateNodeRequest): Promise<BootstrapPayload> {
    request = validateDuplicateLibraryNodeRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('duplicate_library_node', { request })
    }

    const snapshot = duplicateLibraryNode(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async openLibraryItem(libraryItemId: string): Promise<BootstrapPayload> {
    validateRequiredId(libraryItemId, 'Library item id')
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('open_library_item', { libraryItemId })
    }

    const snapshot = openLibraryItem(loadBrowserSnapshot(), libraryItemId)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async saveQueryTabToLibrary(
    request: SaveQueryTabToLibraryRequest,
  ): Promise<BootstrapPayload> {
    request = validateSaveQueryTabToLibraryRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('save_query_tab_to_library', { request })
    }

    const snapshot = saveQueryTabToLibrary(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async saveQueryTabToLocalFile(
    request: SaveQueryTabToLocalFileRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      if (request.path?.trim()) {
        request = validateSaveQueryTabToLocalFileRequest(request)
      } else {
        validateRequiredTabId(request.tabId)
      }
      return invokeDesktop<BootstrapPayload>('save_query_tab_to_local_file', { request })
    }

    request = validateSaveQueryTabToLocalFileRequest(request)
    const snapshot = saveQueryTabToLocalFile(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },
}
