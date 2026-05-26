import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { PanelIcon, SettingsIcon, WarningIcon } from './icons'

interface StatusBarProps {
  activeConnection?: ConnectionProfile
  activeEnvironment?: EnvironmentProfile
  activeTab?: QueryTabState
  bottomPanelVisible: boolean
  messageCount: number
  onToggleBottomPanel(): void
  onOpenMessages(): void
  onOpenDiagnostics(): void
}

export function StatusBar({
  activeConnection,
  activeEnvironment,
  activeTab,
  bottomPanelVisible,
  messageCount,
  onToggleBottomPanel,
  onOpenMessages,
  onOpenDiagnostics,
}: StatusBarProps) {
  return (
    <footer className="status-bar" aria-label="Status bar">
      <div className="status-bar-group">
        <span className="status-item">{activeConnection?.name ?? 'No connection'}</span>
        <span className="status-item">{activeEnvironment?.label ?? 'No environment'}</span>
        <span className="status-item">{activeTab?.language.toUpperCase() ?? 'READY'}</span>
        <span className="status-item">{activeTab?.status ?? 'idle'}</span>
      </div>

      <div className="status-bar-group">
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
