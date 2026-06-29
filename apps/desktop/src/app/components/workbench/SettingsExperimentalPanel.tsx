import { useState } from 'react'
import type {
  DatastoreApiServerSettingsRequest,
  DatastoreMcpServerSettingsRequest,
  WorkspaceSearchSettingsRequest,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { ObjectServerIcon, SearchIcon } from './icons'
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
  onUpdateApiServerSettings,
  onUpdateMcpServerSettings,
  onUpdateWorkspaceSearchSettings,
}: {
  preferences: WorkspaceSnapshot['preferences']
  onOpenApiServer(): void
  onOpenMcpServer(): void
  onOpenWorkspaceSearch(): void
  onUpdateApiServerSettings(
    request: DatastoreApiServerSettingsRequest,
  ): Promise<boolean>
  onUpdateMcpServerSettings(
    request: DatastoreMcpServerSettingsRequest,
  ): Promise<boolean>
  onUpdateWorkspaceSearchSettings(
    request: WorkspaceSearchSettingsRequest,
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
  const [notice, setNotice] = useState<SettingsNoticeMessage>()
  const [mcpNotice, setMcpNotice] = useState<SettingsNoticeMessage>()
  const [searchNotice, setSearchNotice] = useState<SettingsNoticeMessage>()
  const [saving, setSaving] = useState(false)
  const [mcpSaving, setMcpSaving] = useState(false)
  const [searchSaving, setSearchSaving] = useState(false)

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
      </div>
    </SettingsPanel>
  )
}
