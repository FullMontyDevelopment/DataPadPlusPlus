import { useState } from 'react'
import type {
  DatastoreApiServerSettingsRequest,
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
type ApiServerPreferences = NonNullable<WorkspaceSnapshot['preferences']['datastoreApiServer']>
type ApiServerConfig = NonNullable<ApiServerPreferences['servers']>[number]

export function SettingsExperimentalPanel({
  preferences,
  onOpenApiServer,
  onOpenWorkspaceSearch,
  onUpdateApiServerSettings,
  onUpdateWorkspaceSearchSettings,
}: {
  preferences: WorkspaceSnapshot['preferences']
  onOpenApiServer(): void
  onOpenWorkspaceSearch(): void
  onUpdateApiServerSettings(
    request: DatastoreApiServerSettingsRequest,
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
  const workspaceSearch = preferences.workspaceSearch ?? { enabled: false }
  const selectedServer = activeApiServerConfig(apiServer)
  const selectedPort = selectedServer.port
  const selectedName = selectedServer.name
  const [nameDraft, setNameDraft] = useResettableState(selectedName)
  const [portDraft, setPortDraft] = useResettableState(String(selectedPort))
  const [notice, setNotice] = useState<SettingsNoticeMessage>()
  const [searchNotice, setSearchNotice] = useState<SettingsNoticeMessage>()
  const [saving, setSaving] = useState(false)
  const [searchSaving, setSearchSaving] = useState(false)

  const saveSettings = async (
    patch: Partial<DatastoreApiServerSettingsRequest>,
    successMessage: string,
  ) => {
    setSaving(true)
    setNotice(undefined)
    const nextPort = clampPort(Number(portDraft))
    const nextName = normalizeApiServerName(
      patch.name ?? nameDraft,
      patch.port ?? nextPort,
    )
    const ok = await onUpdateApiServerSettings({
      enabled: patch.enabled ?? apiServer.enabled,
      host: '127.0.0.1',
      serverId: selectedServer.id,
      activeServerId: selectedServer.id,
      name: nextName,
      port: patch.port ?? nextPort,
      autoStart: patch.autoStart ?? selectedServer.autoStart,
      connectionId: patch.connectionId ?? selectedServer.connectionId,
      environmentId: patch.environmentId ?? selectedServer.environmentId,
    })
    setSaving(false)
    setNotice(
      ok
        ? { text: successMessage, tone: 'success' }
        : { text: 'Unable to save experimental settings.', tone: 'error' },
    )
    if (ok) {
      setPortDraft(String(patch.port ?? nextPort))
      setNameDraft(nextName)
    }
  }

  const portValue = clampPort(Number(portDraft))
  const nameValue = normalizeApiServerName(nameDraft, portValue)
  const portChanged = portValue !== selectedPort
  const nameChanged = nameValue !== selectedName

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
                  void saveSettings(
                    { enabled: event.target.checked },
                    event.target.checked
                      ? 'API Server workspace enabled.'
                      : 'API Server workspace disabled.',
                  )
                }
              />
              <span>Datastore API server</span>
            </label>

            <label className="settings-check-row">
              <input
                type="checkbox"
                checked={apiServer.autoStart}
                disabled={!apiServer.enabled || saving}
                onChange={(event) =>
                  void saveSettings(
                    { autoStart: event.target.checked },
                    'API Server startup preference saved.',
                  )
                }
              />
              <span>Start automatically for the selected datastore</span>
            </label>

            <label className="settings-field">
              <span>Server name</span>
              <input
                type="text"
                value={nameDraft}
                disabled={!apiServer.enabled || saving}
                onChange={(event) => setNameDraft(event.target.value)}
              />
            </label>

            <label className="settings-field">
              <span>Local port</span>
              <input
                type="number"
                min={1024}
                max={65535}
                value={portDraft}
                disabled={!apiServer.enabled || saving}
                onChange={(event) => setPortDraft(event.target.value)}
              />
            </label>

            <div className="settings-action-row">
              <button
                type="button"
                className="drawer-button"
                disabled={!apiServer.enabled || saving || (!portChanged && !nameChanged)}
                onClick={() =>
                  void saveSettings(
                    { name: nameValue, port: portValue },
                    'API Server details saved.',
                  )
                }
              >
                Save Details
              </button>
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

function useResettableState<T>(resetValue: T) {
  const [state, setState] = useState(() => ({
    resetValue,
    value: resetValue,
  }))
  const value = Object.is(state.resetValue, resetValue) ? state.value : resetValue
  const setValue = (nextValue: T) => setState({ resetValue, value: nextValue })
  return [value, setValue] as const
}

function clampPort(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_API_PORT
  return Math.min(65535, Math.max(1024, Math.floor(value)))
}

function activeApiServerConfig(preferences: ApiServerPreferences): ApiServerConfig {
  const fallbackServer = {
    id: preferences.activeServerId || 'api-server-default',
    name: defaultApiServerName(preferences.port),
    host: '127.0.0.1' as const,
    port: preferences.port ?? DEFAULT_API_PORT,
    autoStart: preferences.autoStart,
    connectionId: preferences.connectionId,
    environmentId: preferences.environmentId,
  }
  const servers = preferences.servers?.length
    ? preferences.servers
    : [fallbackServer]
  const selected =
    servers.find((server) => server.id === preferences.activeServerId) ??
    servers[0] ??
    fallbackServer
  const port = clampPort(selected.port)

  return {
    id: selected.id || 'api-server-default',
    name: normalizeApiServerName(selected.name, port),
    host: '127.0.0.1',
    port,
    autoStart: Boolean(selected.autoStart),
    connectionId: selected.connectionId,
    environmentId: selected.environmentId,
  }
}

function normalizeApiServerName(value: string | undefined, port: number) {
  const trimmed = value?.trim()
  return trimmed || defaultApiServerName(port)
}

function defaultApiServerName(port: number | undefined) {
  const safePort = clampPort(port ?? DEFAULT_API_PORT)
  return safePort === DEFAULT_API_PORT ? 'Local API Server' : `Local API Server ${safePort}`
}
