import type { BootstrapPayload } from '@datapadplusplus/shared-types'
import { createApiServerTabInSnapshot, createSettingsTabInSnapshot } from './browser-settings-tab'
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

  async createApiServerTab(): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_api_server_tab')
    }

    const snapshot = createApiServerTabInSnapshot(loadBrowserSnapshot())
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },
}
