import type { AppAction, StateShape } from './app-state-types'

export function reduceAppUpdateAction(
  state: StateShape,
  action: AppAction,
): StateShape | undefined {
  switch (action.type) {
    case 'APP_UPDATE_SETTINGS_READY':
      return {
        ...state,
        appUpdateSettings: action.settings,
      }
    case 'APP_UPDATE_CHECKING':
      return {
        ...state,
        appUpdateStatus: 'loading',
        appUpdateError: undefined,
      }
    case 'APP_UPDATE_CHECK_READY':
      return {
        ...state,
        appUpdateStatus: 'ready',
        appUpdateSettings: action.result.settings,
        appUpdateCheckResult: action.result,
        appUpdateInstallStatus:
          action.result.status === 'available' ? state.appUpdateInstallStatus : 'idle',
        appUpdateError: undefined,
      }
    case 'APP_UPDATE_CHECK_ERROR':
      return {
        ...state,
        appUpdateStatus: 'ready',
        appUpdateError: action.message,
      }
    case 'APP_UPDATE_INSTALLING':
      return {
        ...state,
        appUpdateInstallStatus: 'installing',
        appUpdateError: undefined,
        appUpdateDownload: {
          downloadedBytes: 0,
        },
      }
    case 'APP_UPDATE_DOWNLOAD_EVENT':
      if (action.event.event === 'Started') {
        return {
          ...state,
          appUpdateDownload: {
            downloadedBytes: 0,
            contentLength: action.event.data.contentLength,
          },
        }
      }
      if (action.event.event === 'Progress') {
        return {
          ...state,
          appUpdateDownload: {
            downloadedBytes: action.event.data.downloadedBytes,
            contentLength: action.event.data.contentLength,
          },
        }
      }
      return state
    case 'APP_UPDATE_INSTALLED':
      return {
        ...state,
        appUpdateInstallStatus: 'installed',
      }
    case 'APP_UPDATE_INSTALL_ERROR':
      return {
        ...state,
        appUpdateInstallStatus: 'error',
        appUpdateError: action.message,
      }
    default:
      return undefined
  }
}
