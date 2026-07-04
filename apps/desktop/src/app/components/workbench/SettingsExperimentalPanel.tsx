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
import {
  ObjectSecurityIcon,
  ObjectServerIcon,
  SavedWorkIcon,
  SearchIcon,
} from './icons'
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
              ? 'API Server plugin enabled.'
              : 'API Server plugin disabled.',
            tone: 'success',
          }
        : { text: 'Unable to save API Server plugin settings.', tone: 'error' },
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
              ? 'MCP Server plugin enabled.'
              : 'MCP Server plugin disabled.',
            tone: 'success',
          }
        : { text: 'Unable to save MCP Server plugin settings.', tone: 'error' },
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
              ? 'Workspaces plugin enabled.'
              : 'Workspaces plugin disabled.',
            tone: 'success',
          }
        : { text: 'Unable to save Workspaces plugin settings.', tone: 'error' },
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
              ? 'Workspace Search plugin enabled.'
              : 'Workspace Search plugin disabled.',
            tone: 'success',
          }
        : { text: 'Unable to save Workspace Search plugin settings.', tone: 'error' },
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
              ? 'Datastore Security Checks plugin enabled.'
              : 'Datastore Security Checks plugin disabled.',
            tone: 'success',
          }
        : { text: 'Unable to save Datastore Security Checks plugin settings.', tone: 'error' },
    )
  }

  return (
    <SettingsPanel
      title="Plugins"
      icon={<ObjectServerIcon className="panel-inline-icon" />}
    >
      <p className="settings-plugin-intro">
        Plugins are opt-in workspace capabilities. Enable only the surfaces you want available in this workbench.
      </p>

      <div className="settings-plugin-catalog">
        <section
          className="settings-plugin-group"
          aria-labelledby="settings-plugins-title"
        >
          <header className="settings-plugin-group-header">
            <h3 id="settings-plugins-title">Plugins</h3>
            <span>Ready</span>
          </header>

          <div className="settings-plugin-grid">
            <section
              className="settings-plugin-card"
              aria-labelledby="settings-workspace-search-title"
            >
              <header className="settings-plugin-card-header">
                <span className="settings-plugin-icon">
                  <SearchIcon className="panel-inline-icon" />
                </span>
                <div className="settings-plugin-title-block">
                  <h4 id="settings-workspace-search-title">Workspace Search</h4>
                  <p>Find connections, Library work, tabs, scripts, queries, and tests without indexing secrets or result payloads.</p>
                </div>
                <span className="settings-plugin-badge settings-plugin-badge--stable">Plugin</span>
              </header>

              <ul className="settings-plugin-capabilities">
                <li>Workspace snapshot index</li>
                <li>Result-type filters and matching options</li>
                <li>No result payload or secret indexing</li>
              </ul>

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
          </div>
        </section>

        <section
          className="settings-plugin-group"
          aria-labelledby="settings-experimental-plugins-title"
        >
          <header className="settings-plugin-group-header">
            <h3 id="settings-experimental-plugins-title">Experimental Plugins</h3>
            <span>Opt-in preview</span>
          </header>

          <div className="settings-plugin-grid">
            <section
              className="settings-plugin-card"
              aria-labelledby="settings-api-server-title"
            >
              <header className="settings-plugin-card-header">
                <span className="settings-plugin-icon">
                  <ObjectServerIcon className="panel-inline-icon" />
                </span>
                <div className="settings-plugin-title-block">
                  <h4 id="settings-api-server-title">API Server</h4>
                  <p>Expose selected datastore resources and saved Library queries as local REST, GraphQL, or gRPC endpoints.</p>
                </div>
                <span className="settings-plugin-badge settings-plugin-badge--experimental">Experimental</span>
              </header>

              <ul className="settings-plugin-capabilities">
                <li>Local 127.0.0.1 listeners</li>
                <li>Selected resources and saved queries only</li>
                <li>Metrics, logs, and project exports</li>
              </ul>

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
              className="settings-plugin-card"
              aria-labelledby="settings-mcp-server-title"
            >
              <header className="settings-plugin-card-header">
                <span className="settings-plugin-icon settings-plugin-icon--text">MCP</span>
                <div className="settings-plugin-title-block">
                  <h4 id="settings-mcp-server-title">MCP Server</h4>
                  <p>Connect local MCP clients to allowlisted workspace and datastore tools through a locked-down local endpoint.</p>
                </div>
                <span className="settings-plugin-badge settings-plugin-badge--experimental">Experimental</span>
              </header>

              <ul className="settings-plugin-capabilities">
                <li>Loopback Streamable HTTP endpoint</li>
                <li>Scoped auth tokens and origin controls</li>
                <li>Read-only v1 tools with audit logs</li>
              </ul>

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
              className="settings-plugin-card"
              aria-labelledby="settings-workspaces-title"
            >
              <header className="settings-plugin-card-header">
                <span className="settings-plugin-icon">
                  <SavedWorkIcon className="panel-inline-icon" />
                </span>
                <div className="settings-plugin-title-block">
                  <h4 id="settings-workspaces-title">Workspaces</h4>
                  <p>Switch between named local workspaces while preserving the active workspace before every switch.</p>
                </div>
                <span className="settings-plugin-badge settings-plugin-badge--experimental">Experimental</span>
              </header>

              <ul className="settings-plugin-capabilities">
                <li>Local named workspace switcher</li>
                <li>Save-before-switch workflow</li>
                <li>Recent workspace status and counts</li>
              </ul>

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

                <SettingsNotice notice={workspaceNotice} />
              </div>
            </section>

            <section
              className="settings-plugin-card"
              aria-labelledby="settings-security-checks-title"
            >
              <header className="settings-plugin-card-header">
                <span className="settings-plugin-icon">
                  <ObjectSecurityIcon className="panel-inline-icon" />
                </span>
                <div className="settings-plugin-title-block">
                  <h4 id="settings-security-checks-title">Datastore Security Checks</h4>
                  <p>Check connected datastore product versions against NVD and CISA known exploited vulnerability data.</p>
                </div>
                <span className="settings-plugin-badge settings-plugin-badge--experimental">Experimental</span>
              </header>

              <ul className="settings-plugin-capabilities">
                <li>Version posture checks</li>
                <li>NVD and CISA KEV enrichment</li>
                <li>Configurable refresh cadence</li>
              </ul>

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
        </section>
      </div>
    </SettingsPanel>
  )
}
