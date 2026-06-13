import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { DownloadIcon, PanelIcon, SettingsIcon, WarningIcon } from './icons'

interface StatusBarProps {
  activeConnection?: ConnectionProfile
  activeEnvironment?: EnvironmentProfile
  activeTab?: QueryTabState
  availableUpdateVersion?: string
  bottomPanelVisible: boolean
  messageCount: number
  updateInstallStatus: 'idle' | 'installing' | 'installed' | 'error'
  updateStatus: 'idle' | 'loading' | 'ready'
  onInstallUpdate(): void
  onToggleBottomPanel(): void
  onOpenMessages(): void
  onOpenDiagnostics(): void
}

export function StatusBar({
  activeConnection,
  activeEnvironment,
  activeTab,
  availableUpdateVersion,
  bottomPanelVisible,
  messageCount,
  updateInstallStatus,
  updateStatus,
  onInstallUpdate,
  onToggleBottomPanel,
  onOpenMessages,
  onOpenDiagnostics,
}: StatusBarProps) {
  const updateInstalling = updateInstallStatus === 'installing'
  const updateBusy = updateStatus === 'loading' || updateInstalling
  const showUpdateButton = Boolean(availableUpdateVersion) && updateInstallStatus !== 'installed'

  return (
    <footer className="status-bar" aria-label="Status bar">
      <div className="status-bar-group">
        <span className="status-item">{activeConnection?.name ?? 'No connection'}</span>
        <span className="status-item">{activeEnvironment?.label ?? 'No environment'}</span>
        <span className="status-item">{activeTab?.language.toUpperCase() ?? 'READY'}</span>
        <span className="status-item">{activeTab?.status ?? 'idle'}</span>
      </div>

      <div className="status-bar-group">
        {showUpdateButton ? (
          <button
            type="button"
            className="status-button status-button--update"
            aria-label={
              updateInstalling
                ? `Installing DataPad++ ${availableUpdateVersion} update`
                : `Install DataPad++ ${availableUpdateVersion} update`
            }
            title={
              updateInstalling
                ? `Installing DataPad++ ${availableUpdateVersion}.`
                : updateStatus === 'loading'
                  ? 'Checking for updates.'
                : `Install DataPad++ ${availableUpdateVersion}.`
            }
            disabled={updateBusy}
            onClick={onInstallUpdate}
          >
            <DownloadIcon className="status-icon" />
            <span>{updateInstalling ? 'Updating...' : `Update: ${availableUpdateVersion}`}</span>
          </button>
        ) : null}
        {messageCount > 0 ? (
          <button
            type="button"
            className="status-button status-button--error"
            aria-label={`Show ${messageCount} workbench ${messageCount === 1 ? 'message' : 'messages'}`}
            title="Open the Messages panel and review command/runtime errors."
            onClick={onOpenMessages}
          >
            <WarningIcon className="status-icon" />
            <span>Errors: {messageCount}</span>
          </button>
        ) : null}
        <button
          type="button"
          className={`status-button${bottomPanelVisible ? ' is-active' : ''}`}
          aria-label={bottomPanelVisible ? 'Hide bottom panel from status bar' : 'Show bottom panel'}
          title={
            bottomPanelVisible
              ? 'Hide the Results, Messages, and Details panel.'
              : 'Show the Results, Messages, and Details panel.'
          }
          onClick={onToggleBottomPanel}
        >
          <PanelIcon className="status-icon" />
        </button>
        <button
          type="button"
          className="status-button"
          aria-label="Open settings"
          title="Open settings, workspace backup, restore, and health information."
          onClick={onOpenDiagnostics}
        >
          <SettingsIcon className="status-icon" />
        </button>
      </div>
    </footer>
  )
}
