import type {
  BootstrapPayload,
  MultiWindowTabsSettingsRequest,
  WorkspaceTabDragSession,
  WorkspaceTabDragSessionRequest,
  WorkspaceTabTransferRequest,
  WorkspaceTabTransferResponse,
  WorkspaceWindowCloseRequest,
  WorkspaceWindowContext,
  WorkspaceWindowGeometryRequest,
  WorkspaceWindowListResponse,
} from '@datapadplusplus/shared-types'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'
import { buildBrowserPayload, loadBrowserSnapshot } from './browser-store'

export const WORKSPACE_CHANGED_EVENT = 'datapad://workspace-changed'

export interface WorkspaceChangedEvent {
  revision: number
}

export async function currentWorkspaceWindowId() {
  if (!isTauriRuntime()) {
    return 'main'
  }
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  return getCurrentWebviewWindow().label
}

export const clientWorkspaceWindows = {
  async getWorkspaceWindowContext(): Promise<WorkspaceWindowContext> {
    if (!isTauriRuntime()) {
      return {
        windowId: 'main',
        role: 'main',
        multiWindowEnabled: false,
        dragSupported: false,
      }
    }
    return invokeDesktop<WorkspaceWindowContext>('get_workspace_window_context')
  },

  async listWorkspaceWindows(): Promise<WorkspaceWindowListResponse> {
    if (!isTauriRuntime()) {
      return {
        windows: [{
          windowId: 'main',
          role: 'main',
          title: 'Main window',
          activeTabId: loadBrowserSnapshot().ui.activeTabId,
          tabCount: loadBrowserSnapshot().tabs.length,
        }],
      }
    }
    return invokeDesktop<WorkspaceWindowListResponse>('list_workspace_windows')
  },

  async transferWorkspaceTab(
    request: WorkspaceTabTransferRequest,
  ): Promise<WorkspaceTabTransferResponse> {
    if (!isTauriRuntime()) {
      throw new Error('Multi-window tabs are available only in the desktop application.')
    }
    return invokeDesktop<WorkspaceTabTransferResponse>('transfer_workspace_tab', { request })
  },

  async updateWorkspaceWindowGeometry(
    request: WorkspaceWindowGeometryRequest,
  ): Promise<BootstrapPayload> {
    if (!isTauriRuntime()) {
      return buildBrowserPayload(loadBrowserSnapshot())
    }
    return invokeDesktop<BootstrapPayload>('update_workspace_window_geometry', { request })
  },

  async closeWorkspaceEditorWindow(
    request: WorkspaceWindowCloseRequest,
  ): Promise<BootstrapPayload> {
    if (!isTauriRuntime()) {
      return buildBrowserPayload(loadBrowserSnapshot())
    }
    return invokeDesktop<BootstrapPayload>('close_workspace_editor_window', { request })
  },

  async markWorkspaceEditorWindowReady(): Promise<void> {
    if (isTauriRuntime()) {
      await invokeDesktop<void>('workspace_editor_window_ready')
    }
  },

  async restoreWorkspaceEditorWindows(): Promise<void> {
    if (isTauriRuntime()) {
      await invokeDesktop<void>('restore_workspace_editor_windows')
    }
  },

  async shutdownDatapadApplication(): Promise<void> {
    if (isTauriRuntime()) {
      await invokeDesktop<void>('shutdown_datapad_application')
    }
  },

  async updateMultiWindowTabsSettings(
    request: MultiWindowTabsSettingsRequest,
  ): Promise<BootstrapPayload> {
    if (!isTauriRuntime()) {
      return buildBrowserPayload(loadBrowserSnapshot())
    }
    return invokeDesktop<BootstrapPayload>('update_multi_window_tabs_settings', { request })
  },

  async startWorkspaceTabDrag(
    request: WorkspaceTabDragSessionRequest,
  ): Promise<WorkspaceTabDragSession | undefined> {
    if (!isTauriRuntime()) {
      return undefined
    }
    return invokeDesktop<WorkspaceTabDragSession>('start_workspace_tab_drag', { request })
  },

  async getWorkspaceTabDrag(): Promise<WorkspaceTabDragSession | undefined> {
    if (!isTauriRuntime()) {
      return undefined
    }
    return (await invokeDesktop<WorkspaceTabDragSession | null>('get_workspace_tab_drag')) ?? undefined
  },

  async cancelWorkspaceTabDrag(token?: string): Promise<void> {
    if (!isTauriRuntime()) {
      return
    }
    await invokeDesktop<void>('cancel_workspace_tab_drag', { token })
  },

  async listenForWorkspaceChanges(
    listener: (event: WorkspaceChangedEvent) => void,
  ): Promise<() => void> {
    if (!isTauriRuntime()) {
      return () => undefined
    }
    const { listen } = await import('@tauri-apps/api/event')
    return listen<WorkspaceChangedEvent>(WORKSPACE_CHANGED_EVENT, (event) => listener(event.payload))
  },
}
