import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  CrudResourceKind,
  DatastoreApiServerLogs,
  DatastoreApiServerLogsRequest,
  DatastoreApiServerMetrics,
  DatastoreApiServerSettingsRequest,
  DatastoreApiServerStartRequest,
  DatastoreApiServerStatus,
  DatastoreApiServerStopRequest,
  EnvironmentProfile,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { ObjectServerIcon, PlayIcon, RefreshIcon, StopIcon } from './icons'

const DEFAULT_API_PORT = 17640

type ApiServerView = 'overview' | 'openapi' | 'metrics' | 'logs'
type ApiServerPreferences = NonNullable<WorkspaceSnapshot['preferences']['datastoreApiServer']>
type ApiServerConfig = NonNullable<ApiServerPreferences['servers']>[number]

export function ApiServerWorkspace({
  activeConnection,
  activeEnvironment,
  connections,
  environments,
  preferences,
  onOpenExperimentalSettings,
  onStart,
  onStop,
  onUpdateSettings,
  onGetStatus,
  onGetMetrics,
  onGetLogs,
}: {
  activeConnection?: ConnectionProfile
  activeEnvironment?: EnvironmentProfile
  connections: ConnectionProfile[]
  environments: EnvironmentProfile[]
  preferences: WorkspaceSnapshot['preferences']
  onOpenExperimentalSettings(): void
  onGetStatus(): Promise<DatastoreApiServerStatus | undefined>
  onGetMetrics(): Promise<DatastoreApiServerMetrics | undefined>
  onGetLogs(request?: DatastoreApiServerLogsRequest): Promise<DatastoreApiServerLogs | undefined>
  onUpdateSettings(request: DatastoreApiServerSettingsRequest): Promise<boolean>
  onStart(
    request: DatastoreApiServerStartRequest,
  ): Promise<DatastoreApiServerStatus | undefined>
  onStop(request?: DatastoreApiServerStopRequest): Promise<DatastoreApiServerStatus | undefined>
}) {
  const apiServer = preferences.datastoreApiServer ?? {
    enabled: false,
    host: '127.0.0.1' as const,
    port: DEFAULT_API_PORT,
    autoStart: false,
  }
  const configuredServers = useMemo(
    () => normalizeApiServerConfigs(apiServer),
    [apiServer],
  )
  const initialServerId = apiServer.activeServerId || configuredServers[0]?.id || 'api-server-default'
  const [selectedServerId, setSelectedServerId] = useState(initialServerId)
  const selectedServer =
    configuredServers.find((server) => server.id === selectedServerId) ??
    configuredServers[0]
  const initialConnectionId =
    selectedServer?.connectionId || activeConnection?.id || connections[0]?.id || ''
  const initialEnvironmentId =
    selectedServer?.environmentId || activeEnvironment?.id || environments[0]?.id || ''
  const [connectionId, setConnectionId] = useState(initialConnectionId)
  const [environmentId, setEnvironmentId] = useState(initialEnvironmentId)
  const [portDraft, setPortDraft] = useState(String(selectedServer?.port ?? DEFAULT_API_PORT))
  const [status, setStatus] = useState<DatastoreApiServerStatus>()
  const [metrics, setMetrics] = useState<DatastoreApiServerMetrics>()
  const [logs, setLogs] = useState<DatastoreApiServerLogs>()
  const [view, setView] = useState<ApiServerView>('overview')
  const [busy, setBusy] = useState<'refresh' | 'save' | 'start' | 'stop'>()
  const [observabilityBusy, setObservabilityBusy] = useState(false)

  useEffect(() => {
    setSelectedServerId(initialServerId)
  }, [initialServerId])

  useEffect(() => {
    setConnectionId(initialConnectionId)
  }, [initialConnectionId])

  useEffect(() => {
    setEnvironmentId(initialEnvironmentId)
  }, [initialEnvironmentId])

  useEffect(() => {
    setPortDraft(String(selectedServer?.port ?? DEFAULT_API_PORT))
  }, [selectedServer?.port])

  const refreshStatus = useCallback(async () => {
    setBusy('refresh')
    const nextStatus = await onGetStatus()
    setStatus(nextStatus)
    setBusy(undefined)
  }, [onGetStatus])

  const refreshObservability = useCallback(async () => {
    setObservabilityBusy(true)
    const [nextMetrics, nextLogs] = await Promise.all([
      onGetMetrics(),
      onGetLogs({ limit: 80 }),
    ])
    setMetrics(nextMetrics)
    setLogs(nextLogs)
    setObservabilityBusy(false)
  }, [onGetLogs, onGetMetrics])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus, apiServer.enabled, selectedServerId])

  useEffect(() => {
    const serverStatus = status?.servers?.find((server) => server.id === selectedServerId)
    if (serverStatus?.running && (view === 'metrics' || view === 'logs')) {
      void refreshObservability()
    }
  }, [refreshObservability, selectedServerId, status?.servers, view])

  const selectedConnection = connections.find((item) => item.id === connectionId)
  const selectedEnvironment = environments.find((item) => item.id === environmentId)
  const port = clampPort(Number(portDraft))
  const selectedStatus =
    status?.servers?.find((server) => server.id === selectedServerId) ??
    (status?.serverId === selectedServerId ? statusToInstance(status) : undefined)
  const serverRunning = Boolean(selectedStatus?.running)
  const baseUrl =
    selectedStatus?.baseUrl ?? (apiServer.enabled ? `http://127.0.0.1:${port}` : undefined)
  const docsUrl = serverRunning && baseUrl ? `${baseUrl}/docs` : undefined
  const openApiUrl = serverRunning && baseUrl ? `${baseUrl}/openapi.json` : undefined
  const targetChanged =
    connectionId !== (selectedServer?.connectionId ?? '') ||
    environmentId !== (selectedServer?.environmentId ?? '') ||
    port !== (selectedServer?.port ?? DEFAULT_API_PORT)
  const supportedResources = useMemo(
    () => supportedCrudResources(selectedConnection),
    [selectedConnection],
  )

  const saveTarget = async () => {
    setBusy('save')
    await onUpdateSettings({
      enabled: true,
      host: '127.0.0.1',
      serverId: selectedServerId,
      activeServerId: selectedServerId,
      name: selectedServer?.name || defaultApiServerName(port),
      port,
      autoStart: selectedServer?.autoStart ?? apiServer.autoStart,
      connectionId,
      environmentId,
    })
    setBusy(undefined)
    await refreshStatus()
  }

  const startServer = async () => {
    setBusy('start')
    const nextStatus = await onStart({
      serverId: selectedServerId,
      connectionId,
      environmentId,
      port,
    })
    setStatus(nextStatus)
    setBusy(undefined)
    if (nextStatus?.running) {
      void refreshObservability()
    }
  }

  const stopServer = async () => {
    setBusy('stop')
    const nextStatus = await onStop({ serverId: selectedServerId })
    setStatus(nextStatus)
    setBusy(undefined)
  }

  const selectServer = async (serverId: string) => {
    const server = configuredServers.find((item) => item.id === serverId)
    if (!server) {
      return
    }
    setSelectedServerId(server.id)
    setConnectionId(server.connectionId || activeConnection?.id || connections[0]?.id || '')
    setEnvironmentId(server.environmentId || activeEnvironment?.id || environments[0]?.id || '')
    setPortDraft(String(server.port))
    setBusy('save')
    await onUpdateSettings({
      enabled: true,
      host: '127.0.0.1',
      serverId: server.id,
      activeServerId: server.id,
      name: server.name,
      port: server.port,
      autoStart: server.autoStart,
      connectionId: server.connectionId,
      environmentId: server.environmentId,
    })
    setBusy(undefined)
    await refreshStatus()
  }

  const createServer = async () => {
    const nextPort = nextAvailableApiServerPort(configuredServers)
    const serverId = `api-server-${Date.now()}`
    const nextConnectionId = activeConnection?.id || connections[0]?.id || ''
    const nextEnvironmentId = activeEnvironment?.id || environments[0]?.id || ''
    setSelectedServerId(serverId)
    setConnectionId(nextConnectionId)
    setEnvironmentId(nextEnvironmentId)
    setPortDraft(String(nextPort))
    setBusy('save')
    await onUpdateSettings({
      enabled: true,
      host: '127.0.0.1',
      serverId,
      activeServerId: serverId,
      name: defaultApiServerName(nextPort),
      port: nextPort,
      autoStart: false,
      connectionId: nextConnectionId,
      environmentId: nextEnvironmentId,
    })
    setBusy(undefined)
    await refreshStatus()
  }

  const openInBrowser = (url?: string) => {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  if (!apiServer.enabled) {
    return (
      <section className="environment-workspace api-server-workspace" aria-label="API Server workspace">
        <div className="environment-empty">
          <p className="sidebar-eyebrow">Experimental</p>
          <h1>API Server</h1>
          <p>Enable the datastore API server from Settings before opening a listener.</p>
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
    <section className="environment-workspace api-server-workspace" aria-label="API Server workspace">
      <header className="environment-header api-server-header">
        <div>
          <p className="sidebar-eyebrow">Experimental</p>
          <h1>API Server</h1>
        </div>
        <div className="environment-actions">
          <span className={`api-server-status-pill${serverRunning ? ' is-running' : ''}`}>
            {serverRunning ? 'Running' : 'Stopped'}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh API Server status"
            title="Refresh status"
            disabled={Boolean(busy)}
            onClick={() => void refreshStatus()}
          >
            <RefreshIcon className="panel-inline-icon" />
          </button>
        </div>
      </header>

      <nav className="api-server-tabs" aria-label="API Server views">
        {apiServerViews.map((item) => (
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

      <div className="environment-body api-server-body">
        {view === 'overview' ? (
          <>
            <section className="environment-card">
              <div className="environment-section-header">
                <strong>Target</strong>
                <span>127.0.0.1 only</span>
              </div>
              <div className="environment-form-grid">
                <label className="environment-field">
                  <span>Server</span>
                  <select
                    value={selectedServerId}
                    onChange={(event) => void selectServer(event.target.value)}
                    disabled={Boolean(busy)}
                  >
                    {configuredServers.map((server) => (
                      <option key={server.id} value={server.id}>
                        {server.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="api-server-target-summary api-server-target-summary--action">
                  <button
                    type="button"
                    className="drawer-button"
                    disabled={Boolean(busy)}
                    onClick={() => void createServer()}
                  >
                    New Server
                  </button>
                </div>
                <label className="environment-field">
                  <span>Datastore</span>
                  <select
                    value={connectionId}
                    onChange={(event) => setConnectionId(event.target.value)}
                    disabled={serverRunning || Boolean(busy)}
                  >
                    {connections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="environment-field">
                  <span>Environment</span>
                  <select
                    value={environmentId}
                    onChange={(event) => setEnvironmentId(event.target.value)}
                    disabled={serverRunning || Boolean(busy)}
                  >
                    {environments.map((environment) => (
                      <option key={environment.id} value={environment.id}>
                        {environment.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="environment-field">
                  <span>Port</span>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={portDraft}
                    disabled={serverRunning || Boolean(busy)}
                    onChange={(event) => setPortDraft(event.target.value)}
                  />
                </label>
                <div className="api-server-target-summary">
                  <ObjectServerIcon className="panel-inline-icon" />
                  <span>
                    {selectedConnection
                      ? `${selectedConnection.engine} / ${selectedConnection.family}`
                      : 'Select a datastore'}
                  </span>
                </div>
              </div>
              <div className="drawer-button-row">
                <button
                  type="button"
                  className="drawer-button"
                  disabled={
                    !selectedConnection ||
                    !selectedEnvironment ||
                    !targetChanged ||
                    Boolean(busy) ||
                    serverRunning
                  }
                  onClick={() => void saveTarget()}
                >
                  Save Target
                </button>
                {serverRunning ? (
                  <button
                    type="button"
                    className="drawer-button drawer-button--danger"
                    disabled={Boolean(busy)}
                    onClick={() => void stopServer()}
                  >
                    <StopIcon className="panel-inline-icon" />
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className="drawer-button drawer-button--primary"
                    disabled={
                      !selectedConnection ||
                      !selectedEnvironment ||
                      supportedResources.length === 0 ||
                      Boolean(busy)
                    }
                    onClick={() => void startServer()}
                  >
                    <PlayIcon className="panel-inline-icon" />
                    Start
                  </button>
                )}
              </div>
            </section>

            <section className="environment-card">
              <div className="environment-section-header">
                <strong>CRUD Resources</strong>
                <span>{supportedResources.length ? 'Generated endpoints' : 'Unsupported'}</span>
              </div>
              {supportedResources.length > 0 && baseUrl ? (
                <div className="api-server-resource-grid">
                  {supportedResources.map((resource) => (
                    <div key={resource.kind} className="api-server-resource-row">
                      <strong>{resource.label}</strong>
                      <span>{resource.detail}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="settings-empty">
                  This datastore family does not have a generic CRUD adapter mapping yet.
                </div>
              )}
            </section>

          </>
        ) : null}

        {view === 'openapi' ? (
          <section className="environment-card api-server-docs-card">
            <div className="environment-section-header">
              <strong>OpenAPI</strong>
              <span>{docsUrl ? 'Available' : 'Start the server'}</span>
            </div>
            <div className="drawer-button-row">
              <button
                type="button"
                className="drawer-button"
                disabled={!docsUrl}
                onClick={() => openInBrowser(docsUrl)}
              >
                Open Docs
              </button>
              <button
                type="button"
                className="drawer-button"
                disabled={!openApiUrl}
                onClick={() => openInBrowser(openApiUrl)}
              >
                Open JSON
              </button>
            </div>
            {docsUrl ? (
              <iframe
                className="api-server-docs-frame"
                title="API Server OpenAPI documentation"
                src={docsUrl}
              />
            ) : (
              <div className="settings-empty">Start the API server to view the interactive docs.</div>
            )}
          </section>
        ) : null}

        {view === 'metrics' ? (
          <section className="environment-card">
            <div className="environment-section-header">
              <strong>Metrics</strong>
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh API Server metrics"
                title="Refresh metrics"
                disabled={observabilityBusy}
                onClick={() => void refreshObservability()}
              >
                <RefreshIcon className="panel-inline-icon" />
              </button>
            </div>
            <div className="api-server-runtime-grid">
              <Metric label="Requests" value={formatNumber(metrics?.totalRequests ?? 0)} />
              <Metric label="Errors" value={formatNumber(metrics?.totalErrors ?? 0)} />
              <Metric label="Routes" value={formatNumber(metrics?.routes.length ?? 0)} />
              <Metric label="Response Bytes" value={formatNumber(metrics?.responseBytes ?? 0)} />
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
              <div className="settings-empty">No endpoint metrics have been recorded yet.</div>
            )}
          </section>
        ) : null}

        {view === 'logs' ? (
          <section className="environment-card">
            <div className="environment-section-header">
              <strong>Logs</strong>
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh API Server logs"
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
                      <th>Duration</th>
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
                          <span className={entry.status >= 400 ? 'is-error' : 'is-ok'}>
                            {entry.status}
                          </span>
                        </td>
                        <td>{formatDuration(entry.durationMs)}</td>
                        <td>{entry.errorCode ?? 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="settings-empty">No endpoint logs have been recorded yet.</div>
            )}
          </section>
        ) : null}
      </div>
    </section>
  )
}

const apiServerViews: Array<{ id: ApiServerView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'openapi', label: 'OpenAPI' },
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

function normalizeApiServerConfigs(preferences: ApiServerPreferences): ApiServerConfig[] {
  const servers = preferences.servers?.length
    ? preferences.servers
    : [{
        id: preferences.activeServerId || 'api-server-default',
        name: 'Local API Server',
        host: '127.0.0.1' as const,
        port: preferences.port ?? DEFAULT_API_PORT,
        autoStart: preferences.autoStart,
        connectionId: preferences.connectionId,
        environmentId: preferences.environmentId,
      }]

  return servers.map((server, index) => {
    const port = clampPort(server.port)
    return {
      id: server.id || `api-server-${index + 1}`,
      name: server.name?.trim() || defaultApiServerName(port),
      host: '127.0.0.1',
      port,
      autoStart: Boolean(server.autoStart),
      connectionId: server.connectionId,
      environmentId: server.environmentId,
    }
  })
}

function statusToInstance(
  status: DatastoreApiServerStatus,
): DatastoreApiServerStatus['servers'][number] {
  return {
    id: status.serverId ?? status.activeServerId ?? 'api-server-default',
    name: status.name ?? defaultApiServerName(status.port),
    running: status.running,
    host: status.host,
    port: status.port,
    baseUrl: status.baseUrl,
    connectionId: status.connectionId,
    environmentId: status.environmentId,
    startedAt: status.startedAt,
    message: status.message,
    warnings: status.warnings,
  }
}

function nextAvailableApiServerPort(servers: ApiServerConfig[]) {
  const usedPorts = new Set(servers.map((server) => server.port))
  let port = DEFAULT_API_PORT
  while (usedPorts.has(port) && port < 65535) {
    port += 1
  }
  return clampPort(port)
}

function defaultApiServerName(port: number) {
  const safePort = clampPort(port)
  return safePort === DEFAULT_API_PORT ? 'Local API Server' : `Local API Server ${safePort}`
}

function supportedCrudResources(connection?: ConnectionProfile): Array<{
  kind: CrudResourceKind
  label: string
  detail: string
}> {
  if (!connection) {
    return []
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return [
      {
        kind: 'key',
        label: 'Keys',
        detail: 'Concrete key CRUD routes are generated from datastore discovery.',
      },
    ]
  }

  if (connection.engine === 'mongodb' || connection.engine === 'litedb') {
    return [
      {
        kind: 'collection',
        label: 'Collections',
        detail: 'Concrete collection CRUD routes are generated from datastore discovery.',
      },
    ]
  }

  if (connection.engine === 'dynamodb') {
    return [
      {
        kind: 'item',
        label: 'Items',
        detail: 'Concrete item CRUD routes are generated from datastore discovery.',
      },
    ]
  }

  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return [
      {
        kind: 'index',
        label: 'Indexes',
        detail: 'Concrete index CRUD routes are generated from datastore discovery.',
      },
    ]
  }

  if (
    connection.family === 'sql' ||
    connection.family === 'embedded-olap' ||
    connection.family === 'warehouse'
  ) {
    return [
      {
        kind: 'table',
        label: 'Tables',
        detail: 'Concrete table CRUD routes are generated from datastore discovery.',
      },
    ]
  }

  return []
}

function clampPort(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_API_PORT
  return Math.min(65535, Math.max(1024, Math.floor(value)))
}

function formatDuration(value: number) {
  return `${Math.round(value * 100) / 100} ms`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) {
    return value
  }
  return date.toLocaleTimeString()
}
