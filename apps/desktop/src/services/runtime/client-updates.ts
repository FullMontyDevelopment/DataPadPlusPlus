import type {
  AppUpdateCheckResult,
  AppUpdateDownloadEvent,
  AppUpdateSettings,
} from '@datapadplusplus/shared-types'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'

const BROWSER_UPDATE_SETTINGS_KEY = 'datapadplusplus-browser-update-settings'

export const clientUpdates = {
  async getAppUpdateSettings(): Promise<AppUpdateSettings> {
    if (isTauriRuntime()) {
      return invokeDesktop<AppUpdateSettings>('get_app_update_settings')
    }

    return browserUpdateSettings()
  },

  async setAppUpdateSettings(includePrereleases: boolean): Promise<AppUpdateSettings> {
    if (isTauriRuntime()) {
      return invokeDesktop<AppUpdateSettings>('set_app_update_settings', {
        request: { includePrereleases },
      })
    }

    const current = browserUpdateSettings()
    const next = { ...current, includePrereleases }
    saveBrowserUpdateSettings(next)
    return next
  },

  async checkAppUpdate(): Promise<AppUpdateCheckResult> {
    if (isTauriRuntime()) {
      return invokeDesktop<AppUpdateCheckResult>('check_app_update')
    }

    const checkedAt = new Date().toISOString()
    const settings = {
      ...browserUpdateSettings(),
      lastCheckedAt: checkedAt,
      lastResult: {
        status: 'unsupported' as const,
        channel: browserUpdateSettings().includePrereleases ? 'prerelease' as const : 'stable' as const,
        checkedAt,
        message: 'Updates are only available in the installed desktop app.',
      },
    }
    saveBrowserUpdateSettings(settings)

    return {
      status: 'unsupported',
      channel: settings.includePrereleases ? 'prerelease' : 'stable',
      currentVersion: 'browser-preview',
      checkedAt,
      message: 'Updates are only available in the installed desktop app.',
      settings,
    }
  },

  async installAppUpdate(onEvent: (event: AppUpdateDownloadEvent) => void): Promise<void> {
    if (!isTauriRuntime()) {
      throw new Error('Updates are only available in the installed desktop app.')
    }

    const { Channel } = await import('@tauri-apps/api/core')
    const onEventChannel = new Channel<AppUpdateDownloadEvent>(onEvent)
    await invokeDesktop<void>('install_app_update', { onEvent: onEventChannel })
  },
}

function browserUpdateSettings(): AppUpdateSettings {
  const fallback: AppUpdateSettings = {
    includePrereleases: false,
    supported: false,
    supportMessage: 'Updates are only available in the installed desktop app.',
  }

  try {
    const raw = globalThis.localStorage?.getItem(BROWSER_UPDATE_SETTINGS_KEY)
    if (!raw) {
      return fallback
    }
    const parsed = JSON.parse(raw) as Partial<AppUpdateSettings>
    return {
      includePrereleases: Boolean(parsed.includePrereleases),
      supported: false,
      supportMessage: fallback.supportMessage,
      lastCheckedAt: parsed.lastCheckedAt,
      lastResult: parsed.lastResult,
    }
  } catch {
    return fallback
  }
}

function saveBrowserUpdateSettings(settings: AppUpdateSettings) {
  globalThis.localStorage?.setItem(
    BROWSER_UPDATE_SETTINGS_KEY,
    JSON.stringify({
      includePrereleases: settings.includePrereleases,
      supportMessage: settings.supportMessage,
      lastCheckedAt: settings.lastCheckedAt,
      lastResult: settings.lastResult,
    }),
  )
}
