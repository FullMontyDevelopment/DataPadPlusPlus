import type { BootstrapPayload } from '@datapadplusplus/shared-types'
import {
  createApiServerTabInSnapshot,
  createSettingsTabInSnapshot,
  createWorkspaceSearchTabInSnapshot,
} from './browser-settings-tab'
import { buildBrowserPayload, loadBrowserSnapshot, saveBrowserSnapshot } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'

export const clientSettingsTab = {
  async createSettingsTab(): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_settings_tab')
    }

    const snapshot = createSettingsTabInSnapshot(loadBrowserSnapshot())
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async createApiServerTab(serverId?: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_api_server_tab', { serverId })
    }

    const snapshot = createApiServerTabInSnapshot(loadBrowserSnapshot(), serverId)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async createWorkspaceSearchTab(): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_workspace_search_tab')
    }

    const snapshot = createWorkspaceSearchTabInSnapshot(loadBrowserSnapshot())
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },
}
