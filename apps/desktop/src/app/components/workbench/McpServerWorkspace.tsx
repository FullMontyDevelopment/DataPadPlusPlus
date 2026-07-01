import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  DatastoreMcpClientSetupApplyRequest,
  DatastoreMcpClientSetupApplyResponse,
  DatastoreMcpClientSetupClientId,
  DatastoreMcpClientSetupPreview,
  DatastoreMcpClientSetupRequest,
  DatastoreMcpServerCreateRequest,
  DatastoreMcpServerDeleteRequest,
  DatastoreMcpServerLogs,
  DatastoreMcpServerLogsRequest,
  DatastoreMcpServerMetrics,
  DatastoreMcpServerScope,
  DatastoreMcpServerSettingsRequest,
  DatastoreMcpServerStartRequest,
  DatastoreMcpServerStatus,
  DatastoreMcpServerStopRequest,
  DatastoreMcpServerTokenCreateRequest,
  DatastoreMcpServerTokenCreateResponse,
  DatastoreMcpServerTokenDeleteRequest,
  DatastoreMcpServerUpdateRequest,
  EnvironmentProfile,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { DATASTORE_MCP_SERVER_SCOPES } from '@datapadplusplus/shared-types'
import {
  CopyIcon,
  ObjectServerIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SaveIcon,
  StopIcon,
  TrashIcon,
} from './icons'

const DEFAULT_MCP_PORT = 17641
const MCP_HOST = '127.0.0.1' as const

type McpServerView = 'overview' | 'setup' | 'tokens' | 'metrics' | 'logs'
type McpServerPreferences = NonNullable<
  WorkspaceSnapshot['preferences']['datastoreMcpServer']
>
type PersistedMcpServerConfig = NonNullable<
  McpServerPreferences['servers']
>[number]
type McpServerTextField = 'name' | 'description' | 'allowedOrigins'
type McpServerConfig = Omit<
  PersistedMcpServerConfig,
  'host' | 'port' | 'autoStart' | 'allowedOrigins' | 'connectionIds' | 'environmentIds' | 'tokens'
> & {
  host: '127.0.0.1'
  port: number
  autoStart: boolean
  allowedOrigins: string[]
  connectionIds: string[]
  environmentIds: string[]
  tokens: PersistedMcpServerConfig['tokens']
}

interface McpServerWorkspaceProps {
  serverId?: string
  connections: ConnectionProfile[]
  environments: EnvironmentProfile[]
  preferences: WorkspaceSnapshot['preferences']
  onOpenExperimentalSettings(): void
  onGetStatus(): Promise<DatastoreMcpServerStatus | undefined>
  onGetMetrics(): Promise<DatastoreMcpServerMetrics | undefined>
  onGetLogs(
    request?: DatastoreMcpServerLogsRequest,
  ): Promise<DatastoreMcpServerLogs | undefined>
  onCreateServer(request: DatastoreMcpServerCreateRequest): Promise<boolean>
  onDeleteServer(request: DatastoreMcpServerDeleteRequest): Promise<boolean>
  onUpdateServer(request: DatastoreMcpServerUpdateRequest): Promise<boolean>
  onUpdateSettings(request: DatastoreMcpServerSettingsRequest): Promise<boolean>
  onStart(
    request: DatastoreMcpServerStartRequest,
  ): Promise<DatastoreMcpServerStatus | undefined>
  onStop(
    request?: DatastoreMcpServerStopRequest,
  ): Promise<DatastoreMcpServerStatus | undefined>
  onCreateToken(
    request: DatastoreMcpServerTokenCreateRequest,
  ): Promise<DatastoreMcpServerTokenCreateResponse | undefined>
  onDeleteToken(
    request: DatastoreMcpServerTokenDeleteRequest,
  ): Promise<DatastoreMcpServerStatus | undefined>
  onPreviewClientSetup(
    request: DatastoreMcpClientSetupRequest,
  ): Promise<DatastoreMcpClientSetupPreview | undefined>
  onApplyClientSetup(
    request: DatastoreMcpClientSetupApplyRequest,
  ): Promise<DatastoreMcpClientSetupApplyResponse | undefined>
}

export function McpServerWorkspace({
  serverId,
  connections,
  environments,
  preferences,
  onOpenExperimentalSettings,
  onGetStatus,
  onGetMetrics,
  onGetLogs,
  onCreateServer,
  onDeleteServer,
  onUpdateServer,
  onUpdateSettings,
  onStart,
  onStop,
  onCreateToken,
  onDeleteToken,
  onPreviewClientSetup,
  onApplyClientSetup,
}: McpServerWorkspaceProps) {
  const mcpServer = useMemo(
    () =>
      preferences.datastoreMcpServer ?? {
        enabled: false,
        host: MCP_HOST,
        port: DEFAULT_MCP_PORT,
        autoStart: false,
      },
    [preferences.datastoreMcpServer],
  )
  const configuredServers = useMemo(
    () => normalizeMcpServerConfigs(mcpServer),
    [mcpServer],
  )
  const initialServerId =
    serverId || mcpServer.activeServerId || configuredServers[0]?.id || ''
  const [selectedServerId, setSelectedServerId] =
    useResettableState(initialServerId)
  const selectedServer =
    configuredServers.find((server) => server.id === selectedServerId) ??
    configuredServers[0]
  const [status, setStatus] = useState<DatastoreMcpServerStatus>()
  const [metrics, setMetrics] = useState<DatastoreMcpServerMetrics>()
  const [logs, setLogs] = useState<DatastoreMcpServerLogs>()
  const [view, setView] = useState<McpServerView>('overview')
  const [busy, setBusy] = useState<
    | 'refresh'
    | 'save'
    | 'create'
    | 'delete'
    | 'start'
    | 'stop'
    | 'token'
    | 'setup'
  >()
  const [observabilityBusy, setObservabilityBusy] = useState(false)
  const [createdToken, setCreatedToken] =
    useState<DatastoreMcpServerTokenCreateResponse>()
  const [setupPreviews, setSetupPreviews] = useState<
    Partial<Record<DatastoreMcpClientSetupClientId, DatastoreMcpClientSetupPreview>>
  >({})
  const [setupResults, setSetupResults] = useState<
    Partial<Record<DatastoreMcpClientSetupClientId, DatastoreMcpClientSetupApplyResponse>>
  >({})
  const [setupBusyClient, setSetupBusyClient] =
    useState<DatastoreMcpClientSetupClientId>()
  const [copyStatus, setCopyStatus] = useState('')
  const [tokenLabel, setTokenLabel] = useState('MCP client')
  const [selectedScopes, setSelectedScopes] = useState<
    Set<DatastoreMcpServerScope>
  >(() => new Set(DATASTORE_MCP_SERVER_SCOPES))
  const [serverDrafts, setServerDrafts] = useState<
    Record<string, Partial<Record<McpServerTextField, string>>>
  >({})

  const selectedStatus =
    status?.servers?.find((server) => server.id === selectedServerId) ??
    (status?.serverId === selectedServerId
      ? statusToInstance(status)
      : undefined)
  const serverRunning = Boolean(selectedStatus?.running)
  const server = selectedStatus
    ? mergeStatusIntoServer(selectedServer, selectedStatus)
    : selectedServer
  const endpoint =
    selectedStatus?.endpoint ??
    (mcpServer.enabled && server
      ? `http://${MCP_HOST}:${server.port}/mcp`
      : undefined)
  const tokenCount = server?.tokens.filter((token) => token.enabled).length ?? 0
  const allowlistedConnections = server?.connectionIds.length ?? 0
  const allowlistedEnvironments = server?.environmentIds.length ?? 0
  const serverNameValue = server
    ? (serverDrafts[server.id]?.name ?? server.name)
    : ''
  const serverDescriptionValue = server
    ? (serverDrafts[server.id]?.description ?? server.description ?? '')
    : ''
  const allowedOriginsValue = server
    ? (serverDrafts[server.id]?.allowedOrigins ??
      server.allowedOrigins.join('\n'))
    : ''
  const serverActionDisabled = Boolean(busy && busy !== 'refresh')
  const startDisabledReason = serverStartDisabledReason(server)

  const refreshStatus = useCallback(async () => {
    setBusy('refresh')
    try {
      const nextStatus = await onGetStatus()
      setStatus(nextStatus)
    } finally {
      setBusy(undefined)
    }
  }, [onGetStatus])

  const refreshObservability = useCallback(async () => {
    setObservabilityBusy(true)
    try {
      const [nextMetrics, nextLogs] = await Promise.all([
        onGetMetrics(),
        onGetLogs({ serverId: selectedServerId, limit: 80 }),
      ])
      setMetrics(nextMetrics)
      setLogs(nextLogs)
    } finally {
      setObservabilityBusy(false)
    }
  }, [onGetLogs, onGetMetrics, selectedServerId])

  useEffect(() => {
    if (mcpServer.enabled) {
      const timeout = window.setTimeout(() => {
        void refreshStatus()
      }, 0)

      return () => window.clearTimeout(timeout)
    }
  }, [mcpServer.enabled, refreshStatus])

  useEffect(() => {
    if (serverRunning && (view === 'metrics' || view === 'logs')) {
      const timeout = window.setTimeout(() => {
        void refreshObservability()
      }, 0)

      return () => window.clearTimeout(timeout)
    }
  }, [refreshObservability, serverRunning, view])

  const selectServer = async (nextServerId: string) => {
    setSelectedServerId(nextServerId)
    await onUpdateSettings({
      enabled: true,
      host: MCP_HOST,
      activeServerId: nextServerId,
    })
  }

  const createServer = async () => {
    setBusy('create')
    try {
      await onCreateServer({
        name: 'Local MCP Server',
        port: DEFAULT_MCP_PORT,
        autoStart: false,
        allowedOrigins: [],
        connectionIds: [],
        environmentIds: [],
      })
      await refreshStatus()
    } finally {
      setBusy(undefined)
    }
  }

  const saveServer = async (patch: Omit<DatastoreMcpServerUpdateRequest, 'serverId'>) => {
    if (!server) return false
    setBusy('save')
    try {
      const ok = await onUpdateServer({ serverId: server.id, ...patch })
      if (ok) await refreshStatus()
      return ok
    } finally {
      setBusy(undefined)
    }
  }

  const updateServerDraft = (
    serverId: string,
    field: McpServerTextField,
    value: string,
  ) => {
    setServerDrafts((current) => ({
      ...current,
      [serverId]: {
        ...current[serverId],
        [field]: value,
      },
    }))
  }

  const commitServerTextField = async (field: McpServerTextField) => {
    if (!server) return
    const draft = serverDrafts[server.id]?.[field]
    if (draft === undefined) return
    const request =
      field === 'allowedOrigins'
        ? { allowedOrigins: normalizeLines(draft) }
        : {
            [field]: field === 'name'
              ? draft.trim() || defaultMcpServerName(server.port)
              : draft.trim() || undefined,
          }
    const ok = await saveServer(request)
    if (ok) {
      setServerDrafts((current) => ({
        ...current,
        [server.id]: {
          ...current[server.id],
          [field]: undefined,
        },
      }))
    }
  }

  const startServer = async () => {
    if (!server) return
    setBusy('start')
    try {
      setStatus(await onStart({ serverId: server.id, port: server.port }))
    } finally {
      setBusy(undefined)
    }
  }

  const stopServer = async () => {
    if (!server) return
    setBusy('stop')
    try {
      setStatus(await onStop({ serverId: server.id }))
    } finally {
      setBusy(undefined)
    }
  }

  const deleteServer = async (serverId: string) => {
    setBusy('delete')
    try {
      await onDeleteServer({ serverId })
      setCreatedToken(undefined)
      await refreshStatus()
    } finally {
      setBusy(undefined)
    }
  }

  const toggleConnection = (connectionId: string, enabled: boolean) => {
    if (!server) return
    const next = toggleValue(server.connectionIds, connectionId, enabled)
    void saveServer({ connectionIds: next })
  }

  const toggleEnvironment = (environmentId: string, enabled: boolean) => {
    if (!server) return
    const next = toggleValue(server.environmentIds, environmentId, enabled)
    void saveServer({ environmentIds: next })
  }

  const toggleScope = (scope: DatastoreMcpServerScope, enabled: boolean) => {
    setSelectedScopes((current) => {
      const next = new Set(current)
      if (enabled) next.add(scope)
      else next.delete(scope)
      return next
    })
  }

  const createToken = async () => {
    if (!server || !selectedScopes.size) return
    setBusy('token')
    try {
      const response = await onCreateToken({
        serverId: server.id,
        label: tokenLabel.trim() || 'MCP client',
        scopes: Array.from(selectedScopes),
      })
      setCreatedToken(response)
      if (response) {
        setTokenLabel('MCP client')
        await refreshStatus()
      }
    } finally {
      setBusy(undefined)
    }
  }

  const revokeToken = async (tokenId: string) => {
    if (!server) return
    setBusy('token')
    try {
      setStatus(await onDeleteToken({ serverId: server.id, tokenId }))
      if (createdToken?.tokenId === tokenId) setCreatedToken(undefined)
    } finally {
      setBusy(undefined)
    }
  }

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard?.writeText(value)
      setCopyStatus(`${label} copied.`)
    } catch {
      setCopyStatus(`Unable to copy ${label.toLowerCase()}.`)
    }
  }

  const previewClientSetup = async (clientId: DatastoreMcpClientSetupClientId) => {
    if (!server) return
    setBusy('setup')
    setSetupBusyClient(clientId)
    try {
      const preview = await onPreviewClientSetup({
        clientId,
        scope: 'user',
        endpoint: endpoint ?? `http://${MCP_HOST}:${server.port}/mcp`,
      })
      if (preview) {
        setSetupPreviews((current) => ({ ...current, [clientId]: preview }))
        setSetupResults((current) => ({ ...current, [clientId]: undefined }))
      }
    } finally {
      setSetupBusyClient(undefined)
      setBusy(undefined)
    }
  }

  const applyClientSetup = async (clientId: DatastoreMcpClientSetupClientId) => {
    const preview = setupPreviews[clientId]
    if (!server || !preview?.canApply) return
    setBusy('setup')
    setSetupBusyClient(clientId)
    try {
      const response = await onApplyClientSetup({
        clientId,
        scope: 'user',
        endpoint: preview.endpoint,
        previewId: preview.previewId,
      })
      if (response) {
        setSetupPreviews((current) => ({ ...current, [clientId]: response }))
        setSetupResults((current) => ({ ...current, [clientId]: response }))
      }
    } finally {
      setSetupBusyClient(undefined)
      setBusy(undefined)
    }
  }

  if (!mcpServer.enabled) {
    return (
      <section
        className="environment-workspace api-server-workspace api-server-workspace--disabled"
        aria-label="MCP Server workspace"
      >
        <div className="environment-empty">
          <p className="sidebar-eyebrow">Experimental</p>
          <h1>MCP Server</h1>
          <p>
            Enable the datastore MCP server from Settings before opening a
            listener.
          </p>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            onClick={onOpenExperimentalSettings}
          >
            Open Experimental Settings
          </button>
        </div>
      </section>
    )
  }

  return (
    <section
      className="environment-workspace api-server-workspace mcp-server-workspace"
      aria-label="MCP Server workspace"
    >
      <header className="environment-header api-server-header">
        <div>
          <p className="sidebar-eyebrow">Experimental</p>
          <h1>MCP Server</h1>
          {server ? (
            <p className="api-server-header-description">
              {server.name}
              {server.description ? ` - ${server.description}` : ''}
            </p>
          ) : null}
        </div>
        <div className="environment-actions api-server-header-actions">
          {server ? (
            serverRunning ? (
              <button
                type="button"
                className="drawer-button drawer-button--danger api-server-header-control"
                disabled={Boolean(busy)}
                onClick={() => void stopServer()}
              >
                <StopIcon className="panel-inline-icon" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="drawer-button drawer-button--primary api-server-header-control"
                disabled={Boolean(startDisabledReason || busy)}
                title={startDisabledReason}
                onClick={() => void startServer()}
              >
                <PlayIcon className="panel-inline-icon" />
                Start
              </button>
            )
          ) : null}
          <span
            className={`api-server-status-pill${serverRunning ? ' is-running' : ''}`}
          >
            {serverRunning ? 'Running' : 'Stopped'}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh MCP Server status"
            title="Refresh status"
            disabled={Boolean(busy)}
            onClick={() => void refreshStatus()}
          >
            <RefreshIcon className="panel-inline-icon" />
          </button>
        </div>
      </header>

      <nav className="api-server-tabs" aria-label="MCP Server views">
        {mcpServerViews.map((item) => (
          <button
            key={item.id}
            type="button"
            className={view === item.id ? 'is-active' : undefined}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {server ? (
        <div className="api-server-summary-bar" aria-label="MCP Server summary">
          <div className="api-server-summary-item">
            <span>Transport</span>
            <strong>Streamable HTTP</strong>
          </div>
          <div className="api-server-summary-item">
            <span>Endpoint</span>
            <code>{endpoint ?? `http://${MCP_HOST}:${server.port}/mcp`}</code>
          </div>
          <div className="api-server-summary-item">
            <span>Allowlist</span>
            <strong>
              {formatAllowlistCount(
                allowlistedConnections,
                allowlistedEnvironments,
              )}
            </strong>
          </div>
          <div className="api-server-summary-item">
            <span>Auth Tokens</span>
            <strong>{formatTokenCount(tokenCount)}</strong>
          </div>
        </div>
      ) : null}

      <div className="environment-body api-server-body">
        {!server ? (
          <section className="environment-card">
            <div className="settings-empty api-server-empty-state">
              <p>No MCP server is configured yet.</p>
              <button
                type="button"
                className="drawer-button drawer-button--primary"
                disabled={Boolean(busy)}
                onClick={() => void createServer()}
              >
                <PlusIcon className="panel-inline-icon" />
                Create Local MCP Server
              </button>
            </div>
          </section>
        ) : null}

        {view === 'overview' && server ? (
          <>
            <div className="api-server-overview-grid">
              <section className="environment-card api-server-server-card">
                <div className="environment-section-header">
                  <div className="api-server-section-title">
                    <strong>Server</strong>
                    <span>Bound to loopback and served only at /mcp.</span>
                  </div>
                  <span>{server.port}</span>
                </div>

                {configuredServers.length > 1 ? (
                  <label className="environment-field">
                    <span>Active server</span>
                    <select
                      value={server.id}
                      disabled={Boolean(busy)}
                      onChange={(event) => void selectServer(event.target.value)}
                    >
                      {configuredServers.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <div className="environment-form-grid api-server-server-form">
                  <label className="environment-field">
                    <span>Name</span>
                    <input
                      type="text"
                      value={serverNameValue}
                      disabled={serverActionDisabled}
                      onBlur={() => void commitServerTextField('name')}
                      onChange={(event) =>
                        updateServerDraft(server.id, 'name', event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
                  </label>
                  <label className="environment-field">
                    <span>Description</span>
                    <input
                      type="text"
                      value={serverDescriptionValue}
                      disabled={serverActionDisabled}
                      onBlur={() => void commitServerTextField('description')}
                      onChange={(event) =>
                        updateServerDraft(
                          server.id,
                          'description',
                          event.target.value,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
                  </label>
                  <label className="environment-field">
                    <span>Host</span>
                    <input type="text" value={MCP_HOST} disabled />
                  </label>
                  <label className="environment-field">
                    <span>Port</span>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={server.port}
                      disabled={serverRunning || Boolean(busy)}
                      onChange={(event) =>
                        void saveServer({
                          port: clampPort(Number(event.target.value)),
                        })
                      }
                    />
                  </label>
                  <label className="settings-check-row api-server-auto-start-row">
                    <input
                      type="checkbox"
                      checked={server.autoStart}
                      disabled={Boolean(busy)}
                      onChange={(event) =>
                        void saveServer({ autoStart: event.target.checked })
                      }
                    />
                    <span>Start automatically</span>
                  </label>
                </div>

                <label className="environment-field">
                  <span>Allowed browser origins</span>
                  <textarea
                    rows={4}
                    value={allowedOriginsValue}
                    disabled={serverActionDisabled}
                    placeholder="https://trusted-client.example"
                    onBlur={() => void commitServerTextField('allowedOrigins')}
                    onChange={(event) =>
                      updateServerDraft(
                        server.id,
                        'allowedOrigins',
                        event.target.value,
                      )
                    }
                  />
                </label>

                <div className="api-server-card-footer">
                  <div className="api-server-target-summary">
                    <ObjectServerIcon className="panel-inline-icon" />
                    <span>
                      {endpoint ?? `http://${MCP_HOST}:${server.port}/mcp`}
                    </span>
                  </div>
                  {startDisabledReason && !serverRunning ? (
                    <p className="settings-inline-note">
                      {startDisabledReason}
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="environment-card api-server-resources-card">
                <div className="environment-section-header">
                  <div className="api-server-section-title">
                    <strong>Datastore Allowlist</strong>
                    <span>Only selected datastores are visible to MCP clients.</span>
                  </div>
                  <span>{formatNumber(allowlistedConnections)} selected</span>
                </div>
                {connections.length ? (
                  <div className="api-server-resource-grid mcp-server-picker-grid">
                    {connections.map((connection) => (
                      <label
                        key={connection.id}
                        className="settings-check-row api-server-resource-picker-row"
                      >
                        <input
                          type="checkbox"
                          checked={server.connectionIds.includes(connection.id)}
                          disabled={Boolean(busy)}
                          onChange={(event) =>
                            toggleConnection(connection.id, event.target.checked)
                          }
                        />
                        <span>
                          <strong>{connection.name}</strong>
                          <small>
                            {connection.engine} / {connection.family}
                            {connection.readOnly ? ' / read-only' : ''}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="settings-empty">
                    Add a datastore connection before exposing anything to MCP.
                  </div>
                )}
              </section>
            </div>

            <section className="environment-card api-server-picker-card">
              <div className="environment-section-header">
                <div className="api-server-section-title">
                  <strong>Workspace Context Allowlist</strong>
                  <span>
                    MCP clients can list or switch only selected environments.
                  </span>
                </div>
                <span>{formatNumber(allowlistedEnvironments)} selected</span>
              </div>
              {environments.length ? (
                <div className="api-server-resource-grid mcp-server-picker-grid">
                  {environments.map((environment) => (
                    <label
                      key={environment.id}
                      className="settings-check-row api-server-resource-picker-row"
                    >
                      <input
                        type="checkbox"
                        checked={server.environmentIds.includes(environment.id)}
                        disabled={Boolean(busy)}
                        onChange={(event) =>
                          toggleEnvironment(
                            environment.id,
                            event.target.checked,
                          )
                        }
                      />
                      <span>
                        <strong>{environment.label}</strong>
                        <small>
                          {environment.risk}
                          {environment.safeMode ? ' / safe mode' : ''}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="settings-empty">
                  Add a workspace environment before exposing context tools.
                </div>
              )}
            </section>

            <section
              className="environment-card api-server-danger-zone"
              aria-label="Danger zone"
            >
              <div className="environment-section-header">
                <strong>Danger Zone</strong>
              </div>
              <div className="api-server-danger-row">
                <div>
                  <strong>Delete this MCP server</strong>
                  <p>
                    Remove this server, client auth token metadata, metrics,
                    and logs.
                  </p>
                </div>
                <button
                  type="button"
                  className="drawer-button drawer-button--danger"
                  aria-label="Delete selected MCP server"
                  disabled={Boolean(busy)}
                  onClick={() => void deleteServer(server.id)}
                >
                  <TrashIcon className="panel-inline-icon" />
                  Delete Server
                </button>
              </div>
            </section>
          </>
        ) : null}

        {view === 'setup' && server ? (
          <section className="environment-card api-server-resources-card mcp-client-setup-card">
            <div className="environment-section-header">
              <div className="api-server-section-title">
                <strong>Client Setup</strong>
                <span>Copy snippets or preview a user-level config update.</span>
              </div>
              <code>DATAPAD_MCP_TOKEN</code>
            </div>

            {copyStatus ? (
              <p className="settings-inline-note">{copyStatus}</p>
            ) : null}

            <div className="mcp-client-setup-list">
              {mcpClientSetupCatalog.map((client) => {
                const clientEndpoint =
                  endpoint ?? `http://${MCP_HOST}:${server.port}/mcp`
                const configSnippet = clientConfigSnippetFor(
                  client.id,
                  clientEndpoint,
                )
                const tokenCommand = tokenEnvironmentSnippet(
                  createdToken?.token,
                )
                const preview = setupPreviews[client.id]
                const result = setupResults[client.id]
                const clientBusy = busy === 'setup' && setupBusyClient === client.id
                return (
                  <article key={client.id} className="mcp-client-setup-row">
                    <div className="mcp-client-setup-main">
                      <div>
                        <strong>{client.label}</strong>
                        <span>{client.provider}</span>
                      </div>
                      <div className="mcp-client-setup-paths">
                        <code>User: {client.userConfigPath}</code>
                        <code>Project: {client.projectConfigPath}</code>
                      </div>
                    </div>

                    <div className="mcp-client-setup-snippets">
                      <div>
                        <div className="mcp-client-setup-snippet-header">
                          <strong>Config</strong>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Copy ${client.label} MCP config`}
                            title="Copy config"
                            onClick={() =>
                              void copyText(`${client.label} config`, configSnippet)
                            }
                          >
                            <CopyIcon className="panel-inline-icon" />
                          </button>
                        </div>
                        <pre className="api-server-query-preview mcp-client-setup-preview">
                          {configSnippet}
                        </pre>
                      </div>
                      <div>
                        <div className="mcp-client-setup-snippet-header">
                          <strong>Auth Token Env</strong>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Copy auth token environment command"
                            title="Copy auth token command"
                            onClick={() =>
                              void copyText('Auth token command', tokenCommand)
                            }
                          >
                            <CopyIcon className="panel-inline-icon" />
                          </button>
                        </div>
                        <pre className="api-server-query-preview mcp-client-setup-preview">
                          {tokenCommand}
                        </pre>
                      </div>
                    </div>

                    <div className="mcp-client-setup-actions">
                      <button
                        type="button"
                        className="drawer-button"
                        disabled={Boolean(busy)}
                        onClick={() => void previewClientSetup(client.id)}
                      >
                        <ObjectServerIcon className="panel-inline-icon" />
                        {clientBusy ? 'Previewing...' : 'Preview Auto Setup'}
                      </button>
                      <button
                        type="button"
                        className="drawer-button drawer-button--primary"
                        disabled={Boolean(
                          busy ||
                            !preview ||
                            !preview.canApply ||
                            result?.applied,
                        )}
                        onClick={() => void applyClientSetup(client.id)}
                      >
                        <SaveIcon className="panel-inline-icon" />
                        {clientBusy ? 'Applying...' : result?.applied ? 'Applied' : 'Apply'}
                      </button>
                    </div>

                    {preview ? (
                      <div className="mcp-client-setup-result">
                        <div>
                          <span>Target</span>
                          <code>{preview.targetPath}</code>
                        </div>
                        <p>{preview.changeSummary}</p>
                        {preview.proposedSnippet ? (
                          <pre className="api-server-query-preview mcp-client-setup-preview">
                            {preview.proposedSnippet}
                          </pre>
                        ) : null}
                        {preview.warnings.length ? (
                          <ul className="api-server-warning-list">
                            {preview.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : null}
                        {result?.backupPath ? (
                          <p className="settings-inline-note">
                            Backup created at <code>{result.backupPath}</code>
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          </section>
        ) : null}

        {view === 'tokens' && server ? (
          <section className="environment-card api-server-resources-card">
            <div className="environment-section-header">
              <div className="api-server-section-title">
                <strong>Client Auth Tokens</strong>
                <span>Raw auth tokens are shown only when created.</span>
              </div>
              <span>{formatTokenCount(tokenCount)}</span>
            </div>

            <div className="environment-form-grid api-server-server-form">
              <label className="environment-field">
                <span>Auth token label</span>
                <input
                  type="text"
                  value={tokenLabel}
                  disabled={busy === 'token'}
                  onChange={(event) => setTokenLabel(event.target.value)}
                />
              </label>
              <div
                className="mcp-server-scope-list"
                aria-label="Auth token scopes"
              >
                {DATASTORE_MCP_SERVER_SCOPES.map((scope) => (
                  <label
                    key={scope}
                    className="settings-check-row api-server-resource-picker-row"
                  >
                    <input
                      type="checkbox"
                      checked={selectedScopes.has(scope)}
                      disabled={busy === 'token'}
                      onChange={(event) =>
                        toggleScope(scope, event.target.checked)
                      }
                    />
                    <span>
                      <strong>{scope}</strong>
                      <small>{scopeDescription(scope)}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="drawer-button-row">
              <button
                type="button"
                className="drawer-button drawer-button--primary"
                disabled={!selectedScopes.size || Boolean(busy)}
                onClick={() => void createToken()}
              >
                <PlusIcon className="panel-inline-icon" />
                {busy === 'token' ? 'Creating...' : 'Create Auth Token'}
              </button>
            </div>

            {createdToken ? (
              <section className="api-server-endpoint-subsection">
                <div className="environment-section-header">
                  <strong>One-Time Auth Token</strong>
                  <span>{createdToken.config.label}</span>
                </div>
                {createdToken.token ? (
                  <>
                    <textarea
                      className="mcp-server-token-textarea"
                      readOnly
                      rows={3}
                      value={createdToken.token}
                    />
                    <div className="environment-section-header">
                      <strong>Auth Token Env</strong>
                      <span>Copy before leaving this tab</span>
                    </div>
                    <pre className="api-server-query-preview">
                      {tokenEnvironmentSnippet(createdToken.token)}
                    </pre>
                    <div className="drawer-button-row drawer-button-row--compact">
                      <button
                        type="button"
                        className="drawer-button"
                        onClick={() => setView('setup')}
                      >
                        Open Client Setup
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="settings-empty">
                    Browser preview can save auth token metadata but cannot
                    create a usable auth token.
                  </div>
                )}
              </section>
            ) : null}

            {server.tokens.length ? (
              <div className="api-server-table-wrap">
                <table className="api-server-table">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Scopes</th>
                      <th>Created</th>
                      <th>Last Used</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {server.tokens.map((token) => (
                      <tr key={token.id}>
                        <td>{token.label}</td>
                        <td>
                          <code>{token.scopes.join(', ') || 'None'}</code>
                        </td>
                        <td>{formatDateTime(token.createdAt)}</td>
                        <td>{formatDateTime(token.lastUsedAt)}</td>
                        <td>
                          <span
                            className={token.enabled ? 'is-ok' : 'is-error'}
                          >
                            {token.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="drawer-button"
                            disabled={Boolean(busy)}
                            onClick={() => void revokeToken(token.id)}
                          >
                            <TrashIcon className="panel-inline-icon" />
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="settings-empty">
                Create a scoped auth token before configuring an MCP client.
              </div>
            )}
          </section>
        ) : null}

        {view === 'metrics' && server ? (
          <section className="environment-card api-server-observability-card">
            <div className="environment-section-header">
              <strong>Metrics</strong>
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh MCP Server metrics"
                title="Refresh metrics"
                disabled={observabilityBusy}
                onClick={() => void refreshObservability()}
              >
                <RefreshIcon className="panel-inline-icon" />
              </button>
            </div>
            <div className="api-server-runtime-grid">
              <Metric
                label="Requests"
                value={formatNumber(metrics?.totalRequests ?? 0)}
              />
              <Metric
                label="Errors"
                value={formatNumber(metrics?.totalErrors ?? 0)}
              />
              <Metric
                label="Routes"
                value={formatNumber(metrics?.routes.length ?? 0)}
              />
              <Metric
                label="Response Bytes"
                value={formatNumber(metrics?.responseBytes ?? 0)}
              />
            </div>
            {metrics?.routes.length ? (
              <div className="api-server-table-wrap">
                <table className="api-server-table">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Route</th>
                      <th>Requests</th>
                      <th>Errors</th>
                      <th>Avg</th>
                      <th>P95</th>
                      <th>Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.routes.map((route) => (
                      <tr key={route.routeId}>
                        <td>{route.method}</td>
                        <td>
                          <code>{route.route}</code>
                        </td>
                        <td>{formatNumber(route.requests)}</td>
                        <td>{formatNumber(route.errors)}</td>
                        <td>{formatDuration(route.averageDurationMs)}</td>
                        <td>{formatDuration(route.p95DurationMs)}</td>
                        <td>{route.lastStatus ?? 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="settings-empty">
                No MCP request metrics have been recorded yet.
              </div>
            )}
          </section>
        ) : null}

        {view === 'logs' && server ? (
          <section className="environment-card api-server-observability-card">
            <div className="environment-section-header">
              <strong>Logs</strong>
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh MCP Server logs"
                title="Refresh logs"
                disabled={observabilityBusy}
                onClick={() => void refreshObservability()}
              >
                <RefreshIcon className="panel-inline-icon" />
              </button>
            </div>
            {logs?.entries.length ? (
              <div className="api-server-table-wrap">
                <table className="api-server-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Method</th>
                      <th>Route</th>
                      <th>Status</th>
                      <th>Auth Token</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatTimestamp(entry.timestamp)}</td>
                        <td>{entry.method}</td>
                        <td>
                          <code>{entry.route}</code>
                        </td>
                        <td>
                          <span
                            className={
                              entry.status >= 400 ? 'is-error' : 'is-ok'
                            }
                          >
                            {entry.status}
                          </span>
                        </td>
                        <td>{entry.tokenId ?? 'None'}</td>
                        <td>{entry.errorCode ?? 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="settings-empty">
                No MCP request logs have been recorded yet.
              </div>
            )}
          </section>
        ) : null}
      </div>
    </section>
  )
}

const mcpServerViews: Array<{ id: McpServerView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'setup', label: 'Setup' },
  { id: 'tokens', label: 'Auth Tokens' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'logs', label: 'Logs' },
]

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="api-server-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function useResettableState<T>(resetValue: T) {
  const [state, setState] = useState(() => ({
    resetValue,
    value: resetValue,
  }))
  const value = Object.is(state.resetValue, resetValue)
    ? state.value
    : resetValue
  const setValue = (nextValue: T) => setState({ resetValue, value: nextValue })
  return [value, setValue] as const
}

function normalizeMcpServerConfigs(
  preferences: McpServerPreferences,
): McpServerConfig[] {
  const hasLegacyServer =
    !preferences.servers?.length &&
    (Boolean(preferences.autoStart) ||
      (typeof preferences.port === 'number' &&
        preferences.port !== DEFAULT_MCP_PORT) ||
      (typeof preferences.activeServerId === 'string' &&
        preferences.activeServerId !== 'mcp-server-default'))
  const servers = preferences.servers?.length
    ? preferences.servers
    : hasLegacyServer
      ? [
          {
            id: preferences.activeServerId || 'mcp-server-default',
            name: 'Local MCP Server',
            host: MCP_HOST,
            port: preferences.port ?? DEFAULT_MCP_PORT,
            autoStart: preferences.autoStart,
            allowedOrigins: [],
            connectionIds: [],
            environmentIds: [],
            tokens: [],
          },
        ]
      : []

  return servers.map((server, index) => normalizeMcpServerConfig(server, index))
}

function normalizeMcpServerConfig(
  server: PersistedMcpServerConfig,
  index = 0,
): McpServerConfig {
  const port = clampPort(server.port)
  return {
    id: server.id || `mcp-server-${index + 1}`,
    name: server.name?.trim() || defaultMcpServerName(port),
    description: server.description?.trim() || undefined,
    host: MCP_HOST,
    port,
    autoStart: Boolean(server.autoStart),
    allowedOrigins: uniqueStrings(server.allowedOrigins ?? []),
    connectionIds: uniqueStrings(server.connectionIds ?? []),
    environmentIds: uniqueStrings(server.environmentIds ?? []),
    tokens: (server.tokens ?? []).map((token, tokenIndex) => ({
      ...token,
      id: token.id || `mcp-token-${tokenIndex + 1}`,
      label: token.label?.trim() || 'MCP client auth token',
      enabled: token.enabled !== false,
      scopes: token.scopes?.filter(isMcpServerScope) ?? [],
    })),
  }
}

function statusToInstance(
  status: DatastoreMcpServerStatus,
): DatastoreMcpServerStatus['servers'][number] {
  return {
    id: status.serverId ?? status.activeServerId ?? 'mcp-server-default',
    name: status.name ?? defaultMcpServerName(status.port),
    description: status.description,
    running: status.running,
    host: status.host,
    port: status.port,
    endpoint: status.endpoint,
    startedAt: status.startedAt,
    message: status.message,
    warnings: status.warnings,
    allowedOrigins: status.allowedOrigins,
    connectionIds: status.connectionIds,
    environmentIds: status.environmentIds,
    tokenCount: status.tokenCount,
  }
}

function mergeStatusIntoServer(
  server: McpServerConfig | undefined,
  status: DatastoreMcpServerStatus['servers'][number],
): McpServerConfig {
  return {
    id: status.id,
    name: status.name,
    description: status.description ?? server?.description,
    host: MCP_HOST,
    port: status.port,
    autoStart: Boolean(server?.autoStart),
    allowedOrigins: status.allowedOrigins ?? server?.allowedOrigins ?? [],
    connectionIds: status.connectionIds ?? server?.connectionIds ?? [],
    environmentIds: status.environmentIds ?? server?.environmentIds ?? [],
    tokens: server?.tokens ?? [],
  }
}

function serverStartDisabledReason(server: McpServerConfig | undefined) {
  if (!server) return 'Create an MCP server before starting it.'
  return undefined
}

const TOKEN_ENV_VAR = 'DATAPAD_MCP_TOKEN'

const mcpClientSetupCatalog: Array<{
  id: DatastoreMcpClientSetupClientId
  label: string
  provider: string
  userConfigPath: string
  projectConfigPath: string
}> = [
  {
    id: 'codex',
    label: 'OpenAI Codex',
    provider: 'OpenAI',
    userConfigPath: '~/.codex/config.toml',
    projectConfigPath: '.codex/config.toml',
  },
  {
    id: 'vscode',
    label: 'VS Code / GitHub Copilot',
    provider: 'Microsoft / GitHub',
    userConfigPath: 'Code/User/mcp.json',
    projectConfigPath: '.vscode/mcp.json',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    provider: 'Cursor',
    userConfigPath: '~/.cursor/mcp.json',
    projectConfigPath: '.cursor/mcp.json',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    provider: 'Anthropic',
    userConfigPath: '~/.claude.json',
    projectConfigPath: '.mcp.json',
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    provider: 'Google',
    userConfigPath: '~/.gemini/settings.json',
    projectConfigPath: '.gemini/settings.json',
  },
]

function clientConfigSnippetFor(
  clientId: DatastoreMcpClientSetupClientId,
  endpoint: string,
) {
  switch (clientId) {
    case 'codex':
      return `[mcp_servers.datapadplusplus]
url = "${endpoint}"
bearer_token_env_var = "${TOKEN_ENV_VAR}"
startup_timeout_sec = 10
tool_timeout_sec = 30
`
    case 'vscode':
      return JSON.stringify(
        {
          inputs: [
            {
              type: 'promptString',
              id: 'datapad-mcp-token',
              description: 'DataPad++ MCP Auth Token',
              password: true,
            },
          ],
          servers: {
            datapadplusplus: {
              type: 'http',
              url: endpoint,
              headers: {
                Authorization: 'Bearer ${input:datapad-mcp-token}',
              },
            },
          },
        },
        null,
        2,
      )
    case 'cursor':
      return JSON.stringify(
        {
          mcpServers: {
            datapadplusplus: {
              url: endpoint,
              headers: {
                Authorization: `Bearer \${env:${TOKEN_ENV_VAR}}`,
              },
            },
          },
        },
        null,
        2,
      )
    case 'claude-code':
      return JSON.stringify(
        {
          mcpServers: {
            datapadplusplus: {
              type: 'http',
              url: endpoint,
              headers: {
                Authorization: `Bearer \${${TOKEN_ENV_VAR}}`,
              },
            },
          },
        },
        null,
        2,
      )
    case 'gemini-cli':
      return JSON.stringify(
        {
          mcpServers: {
            datapadplusplus: {
              httpUrl: endpoint,
              headers: {
                Authorization: `Bearer $${TOKEN_ENV_VAR}`,
              },
              timeout: 30000,
              trust: false,
            },
          },
        },
        null,
        2,
      )
  }
}

function tokenEnvironmentSnippet(token: string | undefined) {
  const value = token || '<paste-auth-token-shown-once>'
  return `# PowerShell (Windows)
[Environment]::SetEnvironmentVariable("${TOKEN_ENV_VAR}", "${escapePowerShellValue(value)}", "User")

# macOS/Linux shell
export ${TOKEN_ENV_VAR}='${escapeShellSingleQuoted(value)}'
`
}

function escapePowerShellValue(value: string) {
  return value.replace(/[`"$]/g, (match) => `\`${match}`)
}

function escapeShellSingleQuoted(value: string) {
  return value.replace(/'/g, `'\\''`)
}

function scopeDescription(scope: DatastoreMcpServerScope) {
  switch (scope) {
    case 'workspace:read':
      return 'Read workspace summary and active context.'
    case 'workspace:switch':
      return 'Switch to allowlisted active workspace context.'
    case 'datastore:list':
      return 'List allowlisted datastores with secrets redacted.'
    case 'datastore:explore':
      return 'Explore schemas, collections, keys, and objects.'
    case 'query:read':
      return 'Run guarded read-only queries with row limits.'
    case 'operation:diagnostic':
      return 'Run read or diagnostic datastore operations.'
  }
}

function isMcpServerScope(value: string): value is DatastoreMcpServerScope {
  return DATASTORE_MCP_SERVER_SCOPES.includes(
    value as DatastoreMcpServerScope,
  )
}

function toggleValue(values: string[], value: string, enabled: boolean) {
  const current = new Set(values)
  if (enabled) current.add(value)
  else current.delete(value)
  return Array.from(current)
}

function normalizeLines(value: string) {
  return uniqueStrings(value.split(/\r?\n/g))
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  )
}

function defaultMcpServerName(port: number) {
  const safePort = clampPort(port)
  return safePort === DEFAULT_MCP_PORT
    ? 'Local MCP Server'
    : `Local MCP Server ${safePort}`
}

function formatAllowlistCount(connectionCount: number, environmentCount: number) {
  return `${formatNumber(connectionCount)} datastores / ${formatNumber(environmentCount)} contexts`
}

function formatTokenCount(count: number) {
  return count === 1 ? '1 auth token' : `${formatNumber(count)} auth tokens`
}

function clampPort(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MCP_PORT
  return Math.min(65535, Math.max(1024, Math.floor(value)))
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

function formatDuration(value: number | undefined) {
  if (value === undefined) return 'None'
  return `${Math.round(value * 100) / 100} ms`
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString()
}

function formatDateTime(value: string | undefined) {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
