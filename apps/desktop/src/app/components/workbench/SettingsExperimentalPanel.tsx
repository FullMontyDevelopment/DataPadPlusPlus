import { useState } from 'react'
import type {
  DatastoreApiServerSettingsRequest,
  DatastoreMcpServerSettingsRequest,
  DatastoreSecurityChecksSettingsRequest,
  WorkspaceSearchSettingsRequest,
  WorkspaceSnapshot,
  WorkspaceSwitcherSettingsRequest,
  WorkspaceSwitcherStatus,
} from '@datapadplusplus/shared-types'
import { ObjectSecurityIcon, ObjectServerIcon, SearchIcon } from './icons'
import {
  SettingsNotice,
  SettingsPanel,
  type SettingsNoticeMessage,
} from './SettingsWorkspace.parts'

const DEFAULT_API_PORT = 17640
const DEFAULT_MCP_PORT = 17641

export function SettingsExperimentalPanel({
  preferences,
  onOpenApiServer,
  onOpenMcpServer,
  onOpenWorkspaceSearch,
  onOpenSecurityChecks,
  workspaceSwitcherStatus,
  onUpdateApiServerSettings,
  onUpdateMcpServerSettings,
  onUpdateWorkspaceSwitcherSettings,
  onUpdateWorkspaceSearchSettings,
  onUpdateSecurityCheckSettings,
}: {
  preferences: WorkspaceSnapshot['preferences']
  onOpenApiServer(): void
  onOpenMcpServer(): void
  onOpenWorkspaceSearch(): void
  onOpenSecurityChecks(): void
  workspaceSwitcherStatus?: WorkspaceSwitcherStatus
  onUpdateApiServerSettings(
    request: DatastoreApiServerSettingsRequest,
  ): Promise<boolean>
  onUpdateMcpServerSettings(
    request: DatastoreMcpServerSettingsRequest,
  ): Promise<boolean>
  onUpdateWorkspaceSwitcherSettings(
    request: WorkspaceSwitcherSettingsRequest,
  ): Promise<boolean>
  onUpdateWorkspaceSearchSettings(
    request: WorkspaceSearchSettingsRequest,
  ): Promise<boolean>
  onUpdateSecurityCheckSettings(
    request: DatastoreSecurityChecksSettingsRequest,
  ): Promise<boolean>
}) {
  const apiServer = preferences.datastoreApiServer ?? {
    enabled: false,
    host: '127.0.0.1' as const,
    port: DEFAULT_API_PORT,
    autoStart: false,
  }
  const mcpServer = preferences.datastoreMcpServer ?? {
    enabled: false,
    host: '127.0.0.1' as const,
    port: DEFAULT_MCP_PORT,
    autoStart: false,
  }
  const workspaceSearch = preferences.workspaceSearch ?? { enabled: false }
  const securityChecks = preferences.datastoreSecurityChecks ?? {
    enabled: false,
    refreshIntervalDays: 7,
  }
  const [notice, setNotice] = useState<SettingsNoticeMessage>()
  const [mcpNotice, setMcpNotice] = useState<SettingsNoticeMessage>()
  const [workspaceNotice, setWorkspaceNotice] =
    useState<SettingsNoticeMessage>()
  const [searchNotice, setSearchNotice] = useState<SettingsNoticeMessage>()
  const [securityNotice, setSecurityNotice] = useState<SettingsNoticeMessage>()
  const [saving, setSaving] = useState(false)
  const [mcpSaving, setMcpSaving] = useState(false)
  const [workspaceSaving, setWorkspaceSaving] = useState(false)
  const [searchSaving, setSearchSaving] = useState(false)
  const [securitySaving, setSecuritySaving] = useState(false)

  const saveSettings = async (enabled: boolean) => {
    setSaving(true)
    setNotice(undefined)
    const ok = await onUpdateApiServerSettings({
      enabled,
      host: '127.0.0.1',
    })
    setSaving(false)
    setNotice(
      ok
        ? {
            text: enabled
              ? 'API Server workspace enabled.'
              : 'API Server workspace disabled.',
            tone: 'success',
          }
        : { text: 'Unable to save experimental settings.', tone: 'error' },
    )
  }

  const saveMcpSettings = async (enabled: boolean) => {
    setMcpSaving(true)
    setMcpNotice(undefined)
    const ok = await onUpdateMcpServerSettings({
      enabled,
      host: '127.0.0.1',
    })
    setMcpSaving(false)
    setMcpNotice(
      ok
        ? {
            text: enabled
              ? 'MCP Server workspace enabled.'
              : 'MCP Server workspace disabled.',
            tone: 'success',
          }
        : { text: 'Unable to save MCP server settings.', tone: 'error' },
    )
  }

  const saveWorkspaceSwitcherSettings = async (enabled: boolean) => {
    setWorkspaceSaving(true)
    setWorkspaceNotice(undefined)
    const ok = await onUpdateWorkspaceSwitcherSettings({ enabled })
    setWorkspaceSaving(false)
    setWorkspaceNotice(
      ok
        ? {
            text: enabled
              ? 'Workspaces switcher enabled.'
              : 'Workspaces switcher disabled.',
            tone: 'success',
          }
        : { text: 'Unable to save Workspaces settings.', tone: 'error' },
    )
  }

  const saveWorkspaceSearchSettings = async (enabled: boolean) => {
    setSearchSaving(true)
    setSearchNotice(undefined)
    const ok = await onUpdateWorkspaceSearchSettings({ enabled })
    setSearchSaving(false)
    setSearchNotice(
      ok
        ? {
            text: enabled
              ? 'Workspace Search enabled.'
              : 'Workspace Search disabled.',
            tone: 'success',
          }
        : { text: 'Unable to save workspace search settings.', tone: 'error' },
    )
  }

  const saveSecurityCheckSettings = async (enabled: boolean) => {
    setSecuritySaving(true)
    setSecurityNotice(undefined)
    const ok = await onUpdateSecurityCheckSettings({
      enabled,
      refreshIntervalDays: securityChecks.refreshIntervalDays ?? 7,
    })
    setSecuritySaving(false)
    setSecurityNotice(
      ok
        ? {
            text: enabled
              ? 'Datastore Security Checks enabled.'
              : 'Datastore Security Checks disabled.',
            tone: 'success',
          }
        : { text: 'Unable to save security check settings.', tone: 'error' },
    )
  }

  return (
    <SettingsPanel
      title="Experimental"
      icon={<ObjectServerIcon className="panel-inline-icon" />}
    >
      <div className="settings-experimental-list">
        <section
          className="settings-experimental-feature"
          aria-labelledby="settings-api-server-title"
        >
          <header className="settings-experimental-feature-header">
            <h3 id="settings-api-server-title">API Server</h3>
            <span>Experimental</span>
          </header>

          <div className="settings-form-grid settings-form-grid--compact">
            <label className="settings-check-row settings-check-row--card">
              <input
                type="checkbox"
                checked={apiServer.enabled}
                disabled={saving}
                onChange={(event) =>
                  void saveSettings(event.target.checked)
                }
              />
              <span>Datastore API server</span>
            </label>

            <div className="settings-action-row">
              <button
                type="button"
                className="drawer-button drawer-button--primary"
                disabled={!apiServer.enabled}
                onClick={onOpenApiServer}
              >
                Open API Server
              </button>
            </div>

            <SettingsNotice notice={notice} />
          </div>
        </section>

        <section
          className="settings-experimental-feature"
          aria-labelledby="settings-mcp-server-title"
        >
          <header className="settings-experimental-feature-header">
            <h3 id="settings-mcp-server-title">MCP Server</h3>
            <span>Experimental</span>
          </header>

          <div className="settings-form-grid settings-form-grid--compact">
            <label className="settings-check-row settings-check-row--card">
              <input
                type="checkbox"
                checked={mcpServer.enabled}
                disabled={mcpSaving}
                onChange={(event) =>
                  void saveMcpSettings(event.target.checked)
                }
              />
              <span>Datastore MCP server</span>
            </label>

            <div className="settings-action-row">
              <button
                type="button"
                className="drawer-button drawer-button--primary"
                disabled={!mcpServer.enabled || mcpSaving}
                onClick={onOpenMcpServer}
              >
                Open MCP Server
              </button>
            </div>

            <SettingsNotice notice={mcpNotice} />
          </div>
        </section>

        <section
          className="settings-experimental-feature"
          aria-labelledby="settings-workspaces-title"
        >
          <header className="settings-experimental-feature-header">
            <h3 id="settings-workspaces-title">Workspaces</h3>
            <span>Experimental</span>
          </header>

          <div className="settings-form-grid settings-form-grid--compact">
            <label className="settings-check-row settings-check-row--card">
              <input
                type="checkbox"
                checked={Boolean(workspaceSwitcherStatus?.enabled)}
                disabled={workspaceSaving}
                onChange={(event) =>
                  void saveWorkspaceSwitcherSettings(event.target.checked)
                }
              />
              <span>Workspaces switcher</span>
            </label>

            <p className="settings-inline-note">
              App-wide switcher for local named workspaces. The active workspace is saved before a switch.
            </p>

            <SettingsNotice notice={workspaceNotice} />
          </div>
        </section>

        <section
          className="settings-experimental-feature"
          aria-labelledby="settings-workspace-search-title"
        >
          <header className="settings-experimental-feature-header">
            <h3 id="settings-workspace-search-title">Workspace Search</h3>
            <span>Experimental</span>
          </header>

          <div className="settings-form-grid settings-form-grid--compact">
            <label className="settings-check-row settings-check-row--card">
              <input
                type="checkbox"
                checked={workspaceSearch.enabled}
                disabled={searchSaving}
                onChange={(event) =>
                  void saveWorkspaceSearchSettings(event.target.checked)
                }
              />
              <span>Workspace Search</span>
            </label>

            <p className="settings-inline-note">
              Search connections, saved Library work, open tabs, and recently closed tabs without indexing result payloads or secrets.
            </p>

            <div className="settings-action-row">
              <button
                type="button"
                className="drawer-button drawer-button--primary"
                disabled={!workspaceSearch.enabled || searchSaving}
                onClick={onOpenWorkspaceSearch}
              >
                <SearchIcon className="panel-inline-icon" />
                Open Search
              </button>
            </div>

            <SettingsNotice notice={searchNotice} />
          </div>
        </section>

        <section
          className="settings-experimental-feature"
          aria-labelledby="settings-security-checks-title"
        >
          <header className="settings-experimental-feature-header">
            <h3 id="settings-security-checks-title">Datastore Security Checks</h3>
            <span>Experimental</span>
          </header>

          <div className="settings-form-grid settings-form-grid--compact">
            <label className="settings-check-row settings-check-row--card">
              <input
                type="checkbox"
                checked={securityChecks.enabled}
                disabled={securitySaving}
                onChange={(event) =>
                  void saveSecurityCheckSettings(event.target.checked)
                }
              />
              <span>Datastore Security Checks</span>
            </label>

            <p className="settings-inline-note">
              Checks connected datastore product versions against NVD and enriches known exploited vulnerabilities from CISA KEV.
            </p>

            <div className="settings-action-row">
              <button
                type="button"
                className="drawer-button drawer-button--primary"
                disabled={!securityChecks.enabled || securitySaving}
                onClick={onOpenSecurityChecks}
              >
                <ObjectSecurityIcon className="panel-inline-icon" />
                Open Security Checks
              </button>
            </div>

            <SettingsNotice notice={securityNotice} />
          </div>
        </section>
      </div>
    </SettingsPanel>
  )
}
