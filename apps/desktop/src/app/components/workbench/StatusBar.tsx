import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import {
  DownloadIcon,
  ObjectServerIcon,
  ObjectSecurityIcon,
  PanelIcon,
  SettingsIcon,
  WarningIcon,
} from './icons'

interface ApiServerIndicator {
  visible: boolean
  runningCount: number
  onOpen(): void
}

interface McpServerIndicator {
  visible: boolean
  running: boolean
  onOpen(): void
}

interface SecurityChecksIndicator {
  criticalCount: number
  highCount: number
  onOpen(): void
}

interface StatusBarProps {
  activeConnection?: ConnectionProfile
  activeEnvironment?: EnvironmentProfile
  activeTab?: QueryTabState
  apiServerIndicator?: ApiServerIndicator
  availableUpdateVersion?: string
  bottomPanelVisible: boolean
  mcpServerIndicator?: McpServerIndicator
  messageCount: number
  securityChecksIndicator?: SecurityChecksIndicator
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
  apiServerIndicator,
  availableUpdateVersion,
  bottomPanelVisible,
  mcpServerIndicator,
  messageCount,
  securityChecksIndicator,
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
  const securityFindingCount = securityChecksIndicator
    ? securityChecksIndicator.criticalCount + securityChecksIndicator.highCount
    : 0

  return (
    <footer className="status-bar" aria-label="Status bar">
      <div className="status-bar-group">
        <span className="status-item">{activeConnection?.name ?? 'No connection'}</span>
        <span className="status-item">{activeEnvironment?.label ?? 'No environment'}</span>
        <span className="status-item">{activeTab?.language.toUpperCase() ?? 'READY'}</span>
        <span className="status-item">{activeTab?.status ?? 'idle'}</span>
      </div>

      <div className="status-bar-group">
        {apiServerIndicator?.visible ? (
          <button
            type="button"
            className={`status-button status-button--server${
              apiServerIndicator.runningCount > 0 ? ' is-running' : ''
            }`}
            aria-label={
              apiServerIndicator.runningCount > 0
                ? `Open API Server workspace, ${apiServerIndicator.runningCount} running`
                : 'Open API Server workspace, stopped'
            }
            title={
              apiServerIndicator.runningCount > 0
                ? `${apiServerIndicator.runningCount} API ${
                    apiServerIndicator.runningCount === 1 ? 'server is' : 'servers are'
                  } running.`
                : 'API Server is enabled but no server is running.'
            }
            onClick={apiServerIndicator.onOpen}
          >
            <ObjectServerIcon className="status-icon" />
            <span>API</span>
            {apiServerIndicator.runningCount > 0 ? (
              <span className="status-server-badge">
                {apiServerIndicator.runningCount}
              </span>
            ) : null}
          </button>
        ) : null}
        {mcpServerIndicator?.visible ? (
          <button
            type="button"
            className={`status-button status-button--server${
              mcpServerIndicator.running ? ' is-running' : ''
            }`}
            aria-label={
              mcpServerIndicator.running
                ? 'Open MCP Server workspace, running'
                : 'Open MCP Server workspace, stopped'
            }
            title={
              mcpServerIndicator.running
                ? 'MCP Server is running.'
                : 'MCP Server is enabled but stopped.'
            }
            onClick={mcpServerIndicator.onOpen}
          >
            <span className="status-server-text-icon">MCP</span>
          </button>
        ) : null}
        {securityChecksIndicator && securityFindingCount > 0 ? (
          <button
            type="button"
            className={`status-button status-button--security${
              securityChecksIndicator.criticalCount > 0 ? ' is-critical' : ' is-high'
            }`}
            aria-label={`Open Security Checks workspace, ${securityChecksIndicator.criticalCount} critical and ${securityChecksIndicator.highCount} high findings`}
            title={
              securityChecksIndicator.criticalCount > 0
                ? `${securityChecksIndicator.criticalCount} critical and ${securityChecksIndicator.highCount} high unmuted security findings.`
                : `${securityChecksIndicator.highCount} high unmuted security findings.`
            }
            onClick={securityChecksIndicator.onOpen}
          >
            <ObjectSecurityIcon className="status-icon" />
            <span>Security: {securityFindingCount}</span>
          </button>
        ) : null}
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
