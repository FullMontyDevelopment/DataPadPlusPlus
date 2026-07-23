import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DatastoreApiServerAddCustomEndpointRequest,
  ConnectionProfile,
  DatastoreApiServerAddResourcesRequest,
  DatastoreApiServerCustomEndpointConfig,
  DatastoreApiServerCustomEndpointParameterConfig,
  DatastoreApiServerDeleteRequest,
  DatastoreApiServerLogs,
  DatastoreApiServerLogsRequest,
  DatastoreApiServerMetrics,
  DatastoreApiServerProjectExportCapabilitiesRequest,
  DatastoreApiServerProjectExportCapabilitiesResponse,
  DatastoreApiServerProjectExportFramework,
  DatastoreApiServerProjectExportRequest,
  DatastoreApiServerProjectExportResponse,
  DatastoreApiServerQuerySource,
  DatastoreApiServerQuerySourceDiscoveryRequest,
  DatastoreApiServerQuerySourceDiscoveryResponse,
  DatastoreApiServerRemoveCustomEndpointRequest,
  DatastoreApiServerRemoveResourceRequest,
  DatastoreApiServerResourceConfig,
  DatastoreApiServerResourceDiscoveryRequest,
  DatastoreApiServerResourceDiscoveryResponse,
  DatastoreApiServerSettingsRequest,
  DatastoreApiServerStartRequest,
  DatastoreApiServerStatus,
  DatastoreApiServerStopRequest,
  DatastoreApiServerUpdateCustomEndpointRequest,
  DatastoreApiServerUpdateRequest,
  EnvironmentProfile,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import {
  DownloadIcon,
  ObjectServerIcon,
  PlayIcon,
  PlusIcon,
  QueryIcon,
  RefreshIcon,
  SearchIcon,
  StopIcon,
  TrashIcon,
} from './icons'
import { ApiResourcePicker } from './ApiResourcePicker'
import { resourceGroup } from './ApiResourcePicker.helpers'

const DEFAULT_API_PORT = 17640
const RESOURCE_DISCOVERY_TIMEOUT_MS = 15000

type ApiServerView = 'overview' | 'resources' | 'docs' | 'metrics' | 'logs'
type ApiServerPreferences = NonNullable<
  WorkspaceSnapshot['preferences']['datastoreApiServer']
>
type PersistedApiServerConfig = NonNullable<
  ApiServerPreferences['servers']
>[number]
type ApiServerProtocol = NonNullable<PersistedApiServerConfig['protocol']>
type ApiServerTextField = 'name' | 'description' | 'basePath' | 'requestTimeoutSeconds'
type ApiServerConfig = Omit<
  PersistedApiServerConfig,
  | 'host'
  | 'port'
  | 'autoStart'
  | 'protocol'
  | 'basePath'
  | 'resources'
  | 'customEndpoints'
> & {
  host: '127.0.0.1'
  port: number
  autoStart: boolean
  protocol: ApiServerProtocol
  basePath: string
  resources: DatastoreApiServerResourceConfig[]
  customEndpoints: DatastoreApiServerCustomEndpointConfig[]
}

interface CustomEndpointEditorState {
  mode: 'create' | 'edit'
  endpoint: DatastoreApiServerCustomEndpointConfig
}

interface ProjectExportDraft {
  framework: DatastoreApiServerProjectExportFramework
  projectName: string
  namespace: string
  packageName: string
}

export function ApiServerWorkspace({
  serverId,
  connections,
  environments,
  preferences,
  onOpenExperimentalSettings,
  onDeleteServer = async () => false,
  onUpdateServer,
  onDiscoverResources = async () => undefined,
  onAddResources = async () => false,
  onRemoveResource = async () => false,
  onDiscoverQuerySources = async () => undefined,
  onAddCustomEndpoint = async () => false,
  onUpdateCustomEndpoint = async () => false,
  onRemoveCustomEndpoint = async () => false,
  onGetProjectExportCapabilities = async () => undefined,
  onExportProject = async () => undefined,
  onStart,
  onStop,
  onUpdateSettings,
  onGetStatus,
  onGetMetrics,
  onGetLogs,
}: {
  serverId?: string
  connections: ConnectionProfile[]
  environments: EnvironmentProfile[]
  preferences: WorkspaceSnapshot['preferences']
  onOpenExperimentalSettings(): void
  onDeleteServer?(request: DatastoreApiServerDeleteRequest): Promise<boolean>
  onUpdateServer?(request: DatastoreApiServerUpdateRequest): Promise<boolean>
  onDiscoverResources(
    request: DatastoreApiServerResourceDiscoveryRequest,
  ): Promise<DatastoreApiServerResourceDiscoveryResponse | undefined>
  onAddResources?(
    request: DatastoreApiServerAddResourcesRequest,
  ): Promise<boolean>
  onRemoveResource?(
    request: DatastoreApiServerRemoveResourceRequest,
  ): Promise<boolean>
  onDiscoverQuerySources(
    request: DatastoreApiServerQuerySourceDiscoveryRequest,
  ): Promise<DatastoreApiServerQuerySourceDiscoveryResponse | undefined>
  onAddCustomEndpoint?(
    request: DatastoreApiServerAddCustomEndpointRequest,
  ): Promise<boolean>
  onUpdateCustomEndpoint?(
    request: DatastoreApiServerUpdateCustomEndpointRequest,
  ): Promise<boolean>
  onRemoveCustomEndpoint?(
    request: DatastoreApiServerRemoveCustomEndpointRequest,
  ): Promise<boolean>
  onGetProjectExportCapabilities?(
    request: DatastoreApiServerProjectExportCapabilitiesRequest,
  ): Promise<DatastoreApiServerProjectExportCapabilitiesResponse | undefined>
  onExportProject?(
    request: DatastoreApiServerProjectExportRequest,
  ): Promise<DatastoreApiServerProjectExportResponse | undefined>
  onGetStatus(): Promise<DatastoreApiServerStatus | undefined>
  onGetMetrics(): Promise<DatastoreApiServerMetrics | undefined>
  onGetLogs(
    request?: DatastoreApiServerLogsRequest,
  ): Promise<DatastoreApiServerLogs | undefined>
  onUpdateSettings(request: DatastoreApiServerSettingsRequest): Promise<boolean>
  onStart(
    request: DatastoreApiServerStartRequest,
  ): Promise<DatastoreApiServerStatus | undefined>
  onStop(
    request?: DatastoreApiServerStopRequest,
  ): Promise<DatastoreApiServerStatus | undefined>
}) {
  const apiServer = useMemo(
    () =>
      preferences.datastoreApiServer ?? {
        enabled: false,
        host: '127.0.0.1' as const,
        port: DEFAULT_API_PORT,
        autoStart: false,
      },
    [preferences.datastoreApiServer],
  )
  const configuredServers = useMemo(
    () => normalizeApiServerConfigs(apiServer),
    [apiServer],
  )
  const initialServerId =
    serverId || apiServer.activeServerId || configuredServers[0]?.id || ''
  const [selectedServerId, setSelectedServerId] =
    useResettableState(initialServerId)
  const selectedServer =
    configuredServers.find((server) => server.id === selectedServerId) ??
    configuredServers[0]
  const [status, setStatus] = useState<DatastoreApiServerStatus>()
  const [metrics, setMetrics] = useState<DatastoreApiServerMetrics>()
  const [logs, setLogs] = useState<DatastoreApiServerLogs>()
  const [view, setView] = useState<ApiServerView>('overview')
  const [busy, setBusy] = useState<
    | 'refresh'
    | 'save'
    | 'create'
    | 'delete'
    | 'start'
    | 'stop'
    | 'discover'
    | 'resource'
    | 'query-source'
    | 'custom-endpoint'
    | 'export'
  >()
  const [observabilityBusy, setObservabilityBusy] = useState(false)
  const [resourcePicker, setResourcePicker] =
    useState<DatastoreApiServerResourceConfig[]>()
  const [resourceSearch, setResourceSearch] = useState('')
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(
    new Set(),
  )
  const [querySources, setQuerySources] =
    useState<DatastoreApiServerQuerySource[]>()
  const [endpointEditor, setEndpointEditor] =
    useState<CustomEndpointEditorState>()
  const [endpointEditorError, setEndpointEditorError] = useState<string>()
  const [projectExportDialogOpen, setProjectExportDialogOpen] = useState(false)
  const [projectExportDraft, setProjectExportDraft] =
    useState<ProjectExportDraft>(defaultProjectExportDraft())
  const [projectExportResult, setProjectExportResult] =
    useState<DatastoreApiServerProjectExportResponse>()
  const [projectExportCapabilities, setProjectExportCapabilities] =
    useState<DatastoreApiServerProjectExportCapabilitiesResponse>()
  const [projectExportCapabilitiesLoading, setProjectExportCapabilitiesLoading] =
    useState(false)
  const [projectExportError, setProjectExportError] = useState<string>()
  const [serverDrafts, setServerDrafts] = useState<
    Record<string, Partial<Record<ApiServerTextField, string>>>
  >({})
  const discoveringResources = busy === 'discover'

  const selectedStatus =
    status?.servers?.find((server) => server.id === selectedServerId) ??
    (status?.serverId === selectedServerId
      ? statusToInstance(status)
      : undefined)
  const serverRunning = Boolean(selectedStatus?.running)
  const server = selectedStatus
    ? mergeStatusIntoServer(selectedServer, selectedStatus)
    : selectedServer
  const selectedConnection = connections.find(
    (item) => item.id === server?.connectionId,
  )
  const baseUrl =
    selectedStatus?.baseUrl ??
    (apiServer.enabled && server
      ? `http://127.0.0.1:${server.port}`
      : undefined)
  const docsUrl = serverRunning && baseUrl ? `${baseUrl}/docs` : undefined
  const openApiUrl =
    serverRunning && baseUrl && server?.protocol === 'rest'
      ? `${baseUrl}/openapi.json`
      : undefined
  const graphqlUrl =
    serverRunning && baseUrl && server?.protocol === 'graphql'
      ? `${baseUrl}/graphql`
      : undefined
  const protoUrl =
    serverRunning && baseUrl && server?.protocol === 'grpc'
      ? `${baseUrl}/proto`
      : undefined
  const startDisabledReason = serverStartDisabledReason(server)
  const serverNameValue = server
    ? (serverDrafts[server.id]?.name ?? server.name)
    : ''
  const serverDescriptionValue = server
    ? (serverDrafts[server.id]?.description ?? server.description ?? '')
    : ''
  const serverBasePathValue = server
    ? (serverDrafts[server.id]?.basePath ?? server.basePath ?? '')
    : ''
  const requestTimeoutSecondsValue = server
    ? (serverDrafts[server.id]?.requestTimeoutSeconds ??
      (server.requestTimeoutMs ? String(server.requestTimeoutMs / 1000) : ''))
    : ''
  const serverActionDisabled = Boolean(busy && busy !== 'refresh')
  const serverResourceCount = server?.resources.length ?? 0
  const serverCustomEndpointCount = server?.customEndpoints.length ?? 0
  const serverProtocolLabel = protocolDisplayName(server?.protocol)
  const filteredConfiguredResources = useMemo(() => {
    const query = resourceSearch.trim().toLocaleLowerCase()
    if (!server || !query) return server?.resources ?? []
    return server.resources.filter((resource) =>
      [resource.label, resource.kind, resource.detail, resourceGroup(resource)]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(query),
    )
  }, [resourceSearch, server])
  const filteredCustomEndpoints = useMemo(() => {
    const query = resourceSearch.trim().toLocaleLowerCase()
    if (!server || !query) return server?.customEndpoints ?? []
    return server.customEndpoints.filter((endpoint) =>
      [endpoint.label, endpoint.sourceName, endpoint.method, endpoint.endpointSlug]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(query),
    )
  }, [resourceSearch, server])

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
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        void refreshStatus()
      }
    })
    return () => {
      cancelled = true
    }
  }, [refreshStatus, apiServer.enabled, selectedServerId])

  useEffect(() => {
    let cancelled = false
    if (serverRunning && (view === 'metrics' || view === 'logs')) {
      queueMicrotask(() => {
        if (!cancelled) {
          void refreshObservability()
        }
      })
    }
    return () => {
      cancelled = true
    }
  }, [refreshObservability, serverRunning, view])

  const deleteServer = async (serverId: string) => {
    setBusy('delete')
    try {
      const deleted = await onDeleteServer({ serverId })
      const nextServerId =
        configuredServers.find((candidate) => candidate.id !== serverId)?.id ??
        ''
      if (deleted) {
        setSelectedServerId(nextServerId)
      }
      await refreshStatus()
    } finally {
      setBusy(undefined)
    }
  }

  const saveServer = async (patch: Partial<ApiServerConfig>) => {
    if (!server) return false
    setBusy('save')
    try {
      let saved = false
      const request = {
        serverId: server.id,
        name: patch.name ?? server.name,
        description:
          patch.description !== undefined
            ? patch.description
            : server.description,
        protocol: patch.protocol ?? server.protocol,
        basePath:
          patch.basePath !== undefined ? patch.basePath : server.basePath,
        port: patch.port ?? server.port,
        autoStart: patch.autoStart ?? server.autoStart,
        requestTimeoutMs: patch.requestTimeoutMs !== undefined
          ? patch.requestTimeoutMs
          : server.requestTimeoutMs,
        connectionId:
          patch.connectionId !== undefined
            ? patch.connectionId
            : server.connectionId,
        environmentId:
          patch.environmentId !== undefined
            ? patch.environmentId
            : server.environmentId,
        resources: patch.resources ?? server.resources,
        customEndpoints: patch.customEndpoints ?? server.customEndpoints,
      }

      if (onUpdateServer) {
        saved = await onUpdateServer(request)
      } else {
        saved = await onUpdateSettings({
          enabled: apiServer.enabled,
          host: '127.0.0.1',
          activeServerId: server.id,
          ...request,
        })
      }
      await refreshStatus()
      return saved
    } finally {
      setBusy(undefined)
    }
  }

  const updateServerDraft = (
    serverId: string,
    field: ApiServerTextField,
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

  const clearServerDraft = (serverId: string, field: ApiServerTextField) => {
    setServerDrafts((current) => {
      const draft = current[serverId]
      if (!draft || draft[field] === undefined) return current
      const remainingDraft = { ...draft }
      delete remainingDraft[field]
      if (Object.keys(remainingDraft).length === 0) {
        const remaining = { ...current }
        delete remaining[serverId]
        return remaining
      }
      return {
        ...current,
        [serverId]: remainingDraft,
      }
    })
  }

  const commitServerTextField = async (field: ApiServerTextField) => {
    if (!server) return
    const draft = serverDrafts[server.id]?.[field]
    if (draft === undefined) return

    if (field === 'requestTimeoutSeconds') {
      const nextTimeout = requestTimeoutMilliseconds(draft)
      const currentTimeout = server.requestTimeoutMs ?? 0
      if (nextTimeout === currentTimeout) {
        clearServerDraft(server.id, field)
        return
      }
      const saved = await saveServer({ requestTimeoutMs: nextTimeout })
      if (saved) clearServerDraft(server.id, field)
      return
    }

    const currentValue =
      field === 'description'
        ? (server.description ?? '')
        : (server[field] ?? '')
    const nextValue = field === 'name' ? draft.trim() || server.name : draft

    if (nextValue === currentValue) {
      clearServerDraft(server.id, field)
      return
    }

    const saved = await saveServer({
      [field]: nextValue,
    } as Partial<ApiServerConfig>)
    if (saved) {
      clearServerDraft(server.id, field)
    }
  }

  const startServer = async (serverId = server?.id) => {
    if (!serverId) return
    setBusy('start')
    try {
      const nextStatus = await onStart({ serverId })
      setStatus(nextStatus)
      if (nextStatus?.running) {
        void refreshObservability()
      }
    } finally {
      setBusy(undefined)
    }
  }

  const stopServer = async (serverId = server?.id) => {
    if (!serverId) return
    setBusy('stop')
    try {
      const nextStatus = await onStop({ serverId })
      setStatus(nextStatus)
    } finally {
      setBusy(undefined)
    }
  }

  const discoverResources = async () => {
    if (!server?.connectionId || !server.environmentId) return
    setBusy('discover')
    try {
      const discovered = await withResourceDiscoveryTimeout(
        onDiscoverResources({
          connectionId: server.connectionId,
          environmentId: server.environmentId,
          limit: 500,
        }),
      )
      const existingIds = new Set((server.resources ?? []).map((resource) => resource.id))
      const existingIdentities = new Set(
        (server.resources ?? []).map(apiResourceIdentity),
      )
      const candidates = (discovered?.resources ?? []).filter(
        (resource) =>
          !existingIds.has(resource.id) &&
          !existingIdentities.has(apiResourceIdentity(resource)),
      )
      setResourcePicker(candidates)
      setSelectedResourceIds(new Set(candidates.map((resource) => resource.id)))
    } catch {
      setResourcePicker([])
      setSelectedResourceIds(new Set())
    } finally {
      setBusy(undefined)
    }
  }

  const addSelectedResources = async () => {
    if (!server || !resourcePicker) return
    const resources = resourcePicker.filter((resource) =>
      selectedResourceIds.has(resource.id),
    )
    setBusy('resource')
    try {
      await onAddResources({ serverId: server.id, resources })
      setResourcePicker(undefined)
      await refreshStatus()
    } finally {
      setBusy(undefined)
    }
  }

  const removeResource = async (resourceId: string) => {
    if (!server) return
    setBusy('resource')
    try {
      await onRemoveResource({ serverId: server.id, resourceId })
      await refreshStatus()
    } finally {
      setBusy(undefined)
    }
  }

  const openCustomEndpointEditor = async (
    endpoint?: DatastoreApiServerCustomEndpointConfig,
  ) => {
    if (!server) return
    setEndpointEditorError(undefined)
    setBusy('query-source')
    try {
      const discovered = await onDiscoverQuerySources({ serverId: server.id })
      const sources = discovered?.sources ?? []
      setQuerySources(sources)
      setEndpointEditor({
        mode: endpoint ? 'edit' : 'create',
        endpoint: endpoint
          ? normalizeCustomEndpoint(endpoint)
          : customEndpointFromSource(sources[0], server),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const updateEndpointDraft = (
    patch: Partial<DatastoreApiServerCustomEndpointConfig>,
  ) => {
    setEndpointEditor((current) =>
      current
        ? {
            ...current,
            endpoint: normalizeCustomEndpoint({
              ...current.endpoint,
              ...patch,
            }),
          }
        : current,
    )
  }

  const updateEndpointParameter = (
    name: string,
    patch: Partial<DatastoreApiServerCustomEndpointParameterConfig>,
  ) => {
    setEndpointEditor((current) => {
      if (!current) return current
      const parameters = (current.endpoint.parameters ?? []).map((parameter) =>
        parameter.name === name ? { ...parameter, ...patch } : parameter,
      )
      return {
        ...current,
        endpoint: normalizeCustomEndpoint({
          ...current.endpoint,
          parameters,
        }),
      }
    })
  }

  const selectEndpointSource = (sourceId: string) => {
    if (!server) return
    const source = querySources?.find((item) => item.id === sourceId)
    setEndpointEditor((current) =>
      current
        ? {
            ...current,
            endpoint: customEndpointFromSource(
              source,
              server,
              current.endpoint.id,
            ),
          }
        : current,
    )
  }

  const saveCustomEndpoint = async () => {
    if (!server || !endpointEditor) return
    const endpoint = normalizeCustomEndpoint(endpointEditor.endpoint)
    if (!endpoint.sourceLibraryNodeId || !endpoint.queryText.trim()) {
      setEndpointEditorError('Choose a saved Library query before saving.')
      return
    }
    setBusy('custom-endpoint')
    try {
      const saved =
        endpointEditor.mode === 'edit'
          ? await onUpdateCustomEndpoint({
              serverId: server.id,
              endpointId: endpoint.id,
              endpoint,
            })
          : await onAddCustomEndpoint({
              serverId: server.id,
              endpoint,
            })
      if (saved) {
        setEndpointEditor(undefined)
        setQuerySources(undefined)
        setEndpointEditorError(undefined)
      }
      await refreshStatus()
    } finally {
      setBusy(undefined)
    }
  }

  const removeCustomEndpoint = async (endpointId: string) => {
    if (!server) return
    setBusy('custom-endpoint')
    try {
      await onRemoveCustomEndpoint({ serverId: server.id, endpointId })
      await refreshStatus()
    } finally {
      setBusy(undefined)
    }
  }

  const openProjectExportDialog = async () => {
    if (!server) return
    setProjectExportDraft(defaultProjectExportDraft(server.name))
    setProjectExportResult(undefined)
    setProjectExportCapabilities(undefined)
    setProjectExportError(undefined)
    setProjectExportDialogOpen(true)
    setProjectExportCapabilitiesLoading(true)
    try {
      const capabilities = await onGetProjectExportCapabilities({
        serverId: server.id,
      })
      if (capabilities) {
        setProjectExportCapabilities(capabilities)
      } else {
        setProjectExportError(
          'Project export capabilities could not be loaded.',
        )
      }
    } finally {
      setProjectExportCapabilitiesLoading(false)
    }
  }

  const exportProject = async () => {
    if (!server) return
    const disabledReason = projectExportDisabledReason(server)
    const capabilityReason = projectExportCapabilityBlockingReason(
      projectExportCapabilities,
      projectExportDraft.framework,
    )
    if (disabledReason || capabilityReason) {
      setProjectExportError(disabledReason ?? capabilityReason)
      return
    }
    const projectName = projectExportDraft.projectName.trim()
    if (!projectName) {
      setProjectExportError('Enter a project name before exporting.')
      return
    }

    setBusy('export')
    setProjectExportResult(undefined)
    setProjectExportError(undefined)
    try {
      const response = await onExportProject({
        serverId: server.id,
        framework: projectExportDraft.framework,
        projectName,
        namespace:
          projectExportDraft.framework === 'dotnet'
            ? projectExportDraft.namespace.trim() || undefined
            : undefined,
        packageName:
          projectExportDraft.framework === 'rust'
            ? projectExportDraft.packageName.trim() || undefined
            : undefined,
      })
      if (!response) {
        setProjectExportError('The API server project export did not complete.')
        return
      }
      setProjectExportResult(response)
      if (!response.saved) {
        setProjectExportError('Export canceled before a zip file was written.')
      }
    } finally {
      setBusy(undefined)
    }
  }

  const openInBrowser = (url?: string) => {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  if (!apiServer.enabled) {
    return (
      <section
        className="environment-workspace api-server-workspace api-server-workspace--disabled"
        aria-label="API Server workspace"
      >
        <div className="environment-empty">
          <h1>API Server</h1>
          <p>
            Enable the datastore API server plugin from Settings before opening
            a listener.
          </p>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            onClick={onOpenExperimentalSettings}
          >
            Open Plugins Settings
          </button>
        </div>
      </section>
    )
  }

  return (
    <section
      className="environment-workspace api-server-workspace"
      aria-label="API Server workspace"
    >
      <header className="environment-header api-server-header">
        <div>
          <p className="sidebar-eyebrow">API Server</p>
          <h1>{server?.name ?? 'API Server'}</h1>
          {server?.description ? (
            <p className="api-server-header-description">{server.description}</p>
          ) : null}
        </div>
        <div className="environment-actions api-server-header-actions">
          {server ? (
            <button
              type="button"
              className="drawer-button"
              disabled={Boolean(projectExportDisabledReason(server) || busy)}
              title={projectExportDisabledReason(server)}
              onClick={() => void openProjectExportDialog()}
            >
              <DownloadIcon className="panel-inline-icon" />
              Export Project
            </button>
          ) : null}
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
            className="icon-button api-server-header-control"
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

      {server ? (
        <div className="api-server-summary-bar" aria-label="API Server summary">
          <div className="api-server-summary-item">
            <span>Protocol</span>
            <strong>{serverProtocolLabel}</strong>
          </div>
          <div className="api-server-summary-item">
            <span>Endpoint</span>
            <code>{baseUrl ?? `http://127.0.0.1:${server.port}`}</code>
          </div>
          <div className="api-server-summary-item">
            <span>Datastore</span>
            <strong>{selectedConnection?.name ?? 'Not selected'}</strong>
          </div>
          <div className="api-server-summary-item">
            <span>Exposed</span>
            <strong>
              {formatExposureCount(
                serverResourceCount,
                serverCustomEndpointCount,
              )}
            </strong>
          </div>
        </div>
      ) : null}

      <div className="environment-body api-server-body">
        {!server ? (
          <section className="environment-card">
            <div className="settings-empty">
              <p>No API server is selected.</p>
            </div>
          </section>
        ) : null}

        {view === 'resources' && server ? (
          <label className="mcp-access-search api-server-resources-search">
            <SearchIcon className="panel-inline-icon" />
            <input
              type="search"
              value={resourceSearch}
              placeholder="Search configured resources and custom endpoints"
              onChange={(event) => setResourceSearch(event.target.value)}
            />
          </label>
        ) : null}

        {(view === 'overview' || view === 'resources') && server ? (
          <>
            <div className="api-server-overview-grid">
              {view === 'overview' ? (
              <section className="environment-card api-server-server-card">
                <div className="environment-section-header">
                  <div className="api-server-section-title">
                    <strong>Server</strong>
                    <span>Configure the listener and selected datastore.</span>
                  </div>
                  <span>
                    {serverProtocolLabel} / {server.port}
                  </span>
                </div>
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
                    <span>Protocol</span>
                    <select
                      value={server.protocol}
                      disabled={serverRunning || Boolean(busy)}
                      onChange={(event) =>
                        void saveServer({
                          protocol: event.target.value as ApiServerProtocol,
                        })
                      }
                    >
                      <option value="rest">REST / OpenAPI</option>
                      <option value="graphql">GraphQL</option>
                      <option value="grpc">gRPC</option>
                    </select>
                  </label>
                  <label className="environment-field">
                    <span>Base path</span>
                    <input
                      type="text"
                      value={serverBasePathValue}
                      disabled={serverActionDisabled}
                      placeholder="/api"
                      onBlur={() => void commitServerTextField('basePath')}
                      onChange={(event) =>
                        updateServerDraft(
                          server.id,
                          'basePath',
                          event.target.value,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
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
                  <label className="environment-field">
                    <span>Request timeout (seconds)</span>
                    <input
                      type="number"
                      min={-1}
                      max={86400}
                      value={requestTimeoutSecondsValue}
                      disabled={Boolean(busy)}
                      placeholder="Unlimited"
                      onBlur={() => void commitServerTextField('requestTimeoutSeconds')}
                      onChange={(event) =>
                        updateServerDraft(
                          server.id,
                          'requestTimeoutSeconds',
                          event.target.value,
                        )
                      }
                    />
                    <small>Empty, 0, or -1 allows requests to run without a server deadline.</small>
                  </label>
                  <label className="environment-field">
                    <span>Datastore</span>
                    <select
                      value={server.connectionId ?? ''}
                      disabled={serverRunning || Boolean(busy)}
                      onChange={(event) =>
                        void saveServer({ connectionId: event.target.value })
                      }
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
                      value={server.environmentId ?? ''}
                      disabled={serverRunning || Boolean(busy)}
                      onChange={(event) =>
                        void saveServer({ environmentId: event.target.value })
                      }
                    >
                      {environments.map((environment) => (
                        <option key={environment.id} value={environment.id}>
                          {environment.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="environment-field api-server-auto-start-field">
                    <span>Startup</span>
                    <span className="settings-check-row api-server-auto-start-row">
                      <input
                        type="checkbox"
                        checked={server.autoStart}
                        disabled={Boolean(busy)}
                        onChange={(event) =>
                          void saveServer({ autoStart: event.target.checked })
                        }
                      />
                      <span>Start automatically</span>
                    </span>
                  </label>
                </div>
                {startDisabledReason && !serverRunning ? (
                  <p className="settings-inline-note">
                    {startDisabledReason}
                  </p>
                ) : null}
              </section>
              ) : null}

              {view === 'resources' ? (
              <section className="environment-card api-server-resources-card">
                <div className="environment-section-header">
                  <div className="api-server-section-title">
                    <strong>Resources</strong>
                    <span>Expose CRUD endpoints for selected objects.</span>
                  </div>
                  {server.resources.length ? (
                    <button
                      type="button"
                      className="drawer-button drawer-button--primary"
                      disabled={
                        !server.connectionId ||
                        !server.environmentId ||
                        Boolean(busy)
                      }
                      onClick={() => void discoverResources()}
                    >
                      <PlusIcon className="panel-inline-icon" />
                      {discoveringResources
                        ? 'Discovering...'
                        : 'Add Resources'}
                    </button>
                  ) : null}
                </div>
                {filteredConfiguredResources.length ? (
                  <div className="api-server-resource-grid">
                    {groupResourcesForDisplay(filteredConfiguredResources).map(([group, resources]) => (
                      <section key={group} className="api-server-resource-group">
                        <header><strong>{group}</strong><span>{resources.length}</span></header>
                        {resources.map((resource) => (
                          <div key={resource.id} className="api-server-resource-row">
                            <div className="api-server-resource-main">
                              <strong>{resource.label}</strong>
                              <span>
                                {resource.kind}
                                {resource.detail ? ` / ${resource.detail}` : ''}
                              </span>
                            </div>
                            <code>{resourcePath(server, resource)}</code>
                            <button
                              type="button"
                              className="drawer-button"
                              disabled={Boolean(busy)}
                              onClick={() => void removeResource(resource.id)}
                            >
                              <TrashIcon className="panel-inline-icon" />
                              Remove
                            </button>
                          </div>
                        ))}
                      </section>
                    ))}
                  </div>
                ) : server.resources.length ? (
                  <div className="settings-empty">No configured resources match the search.</div>
                ) : (
                  <div className="settings-empty api-server-empty-state">
                    <p>
                      Choose tables, collections, databases, keys, items, or
                      indexes from this datastore to generate endpoints.
                    </p>
                    <button
                      type="button"
                      className="drawer-button drawer-button--primary"
                      disabled={
                        !server.connectionId ||
                        !server.environmentId ||
                        Boolean(busy)
                      }
                      onClick={() => void discoverResources()}
                    >
                      <PlusIcon className="panel-inline-icon" />
                      {discoveringResources
                        ? 'Discovering...'
                        : 'Choose Resources'}
                    </button>
                  </div>
                )}
              </section>
              ) : null}
            </div>

            {view === 'resources' && resourcePicker ? (
              <ApiResourcePicker
                resources={resourcePicker}
                selectedIds={selectedResourceIds}
                busy={Boolean(busy)}
                onSelectionChange={setSelectedResourceIds}
                onConfirm={() => void addSelectedResources()}
                onCancel={() => setResourcePicker(undefined)}
              />
            ) : null}

            {view === 'resources' ? (
            <section className="environment-card api-server-custom-endpoints-card">
              <div className="environment-section-header">
                <div className="api-server-section-title">
                  <strong>Custom Endpoints</strong>
                  <span>
                    Expose saved Library queries with explicit API parameters.
                  </span>
                </div>
                <button
                  type="button"
                  className="drawer-button drawer-button--primary"
                  disabled={
                    !server.connectionId ||
                    !server.environmentId ||
                    Boolean(busy)
                  }
                  onClick={() => void openCustomEndpointEditor()}
                >
                  <QueryIcon className="panel-inline-icon" />
                  {busy === 'query-source'
                    ? 'Loading...'
                    : 'Add Query Endpoint'}
                </button>
              </div>
              {server.protocol !== 'rest' ? (
                <p className="settings-inline-note">
                  Custom query endpoints are stored with this server, but only
                  REST/OpenAPI servers serve them in this version.
                </p>
              ) : null}
              {filteredCustomEndpoints.length ? (
                <div className="api-server-custom-endpoint-grid">
                  {filteredCustomEndpoints.map((endpoint) => (
                    <div
                      key={endpoint.id}
                      className={`api-server-custom-endpoint-row${
                        endpoint.enabled === false ? ' is-disabled' : ''
                      }`}
                    >
                      <div className="api-server-method-path">
                        <span>{endpoint.method}</span>
                        <code>{customEndpointPath(server, endpoint)}</code>
                      </div>
                      <div className="api-server-resource-main">
                        <strong>{endpoint.label}</strong>
                        <span>
                          {endpoint.sourceName}
                          {' / '}
                          {formatParameterCount(
                            endpoint.parameters?.length ?? 0,
                          )}
                          {endpoint.enabled === false ? ' / disabled' : ''}
                        </span>
                      </div>
                      <div className="api-server-row-actions">
                        <button
                          type="button"
                          className="drawer-button"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void openCustomEndpointEditor(endpoint)
                          }
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="drawer-button"
                          disabled={Boolean(busy)}
                          onClick={() => void removeCustomEndpoint(endpoint.id)}
                        >
                          <TrashIcon className="panel-inline-icon" />
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : server.customEndpoints.length ? (
                <div className="settings-empty">No custom endpoints match the search.</div>
              ) : (
                <div className="settings-empty api-server-empty-state">
                  <p>
                    Add a saved Library query to create a concrete endpoint such
                    as <code>/users-by-email</code>.
                  </p>
                  <button
                    type="button"
                    className="drawer-button drawer-button--primary"
                    disabled={
                      !server.connectionId ||
                      !server.environmentId ||
                      Boolean(busy)
                    }
                    onClick={() => void openCustomEndpointEditor()}
                  >
                    <QueryIcon className="panel-inline-icon" />
                    {busy === 'query-source'
                      ? 'Loading...'
                      : 'Add Query Endpoint'}
                  </button>
                </div>
              )}
            </section>
            ) : null}

            {view === 'overview' ? (
            <section
              className="environment-card api-server-danger-zone"
              aria-label="Danger zone"
            >
              <div className="environment-section-header">
                <strong>Danger Zone</strong>
              </div>
              <div className="api-server-danger-row">
                <div>
                  <strong>Delete this API server</strong>
                  <p>
                    Remove this server, its resources, docs, metrics, and logs.
                  </p>
                </div>
                <button
                  type="button"
                  className="drawer-button drawer-button--danger"
                  aria-label="Delete selected API server"
                  disabled={Boolean(busy)}
                  onClick={() => void deleteServer(server.id)}
                >
                  <TrashIcon className="panel-inline-icon" />
                  Delete Server
                </button>
              </div>
            </section>
            ) : null}
          </>
        ) : null}

        {view === 'docs' && server ? (
          <section className="environment-card api-server-docs-card">
            <div className="environment-section-header">
              <strong>{docsTitle(server)}</strong>
              <span>{serverRunning ? 'Available' : 'Start the server'}</span>
            </div>
            {!serverRunning ? (
              <div className="api-server-docs-unavailable">
                <ObjectServerIcon className="api-server-docs-unavailable-icon" />
                <strong>Documentation is unavailable while the server is stopped.</strong>
                <span>Start the server to load its live interactive documentation.</span>
                <button
                  type="button"
                  className="drawer-button drawer-button--primary"
                  disabled={Boolean(startDisabledReason || busy)}
                  title={startDisabledReason}
                  onClick={() => void startServer()}
                >
                  <PlayIcon className="panel-inline-icon" />
                  Start Server
                </button>
              </div>
            ) : (
              <>
                <div className="drawer-button-row">
                  <button type="button" className="drawer-button" onClick={() => openInBrowser(docsUrl)}>
                    Open Docs
                  </button>
                  <button
                    type="button"
                    className="drawer-button"
                    disabled={!openApiUrl && !graphqlUrl && !protoUrl}
                    onClick={() => openInBrowser(openApiUrl ?? graphqlUrl ?? protoUrl)}
                  >
                    Open {server.protocol === 'grpc' ? 'Proto' : server.protocol === 'graphql' ? 'Schema' : 'JSON'}
                  </button>
                </div>
                {docsUrl ? (
                  <iframe className="api-server-docs-frame" title="API Server documentation" src={docsUrl} />
                ) : null}
              </>
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
                aria-label="Refresh API Server metrics"
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
                No endpoint metrics have been recorded yet.
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
                          <span
                            className={
                              entry.status >= 400 ? 'is-error' : 'is-ok'
                            }
                          >
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
              <div className="settings-empty">
                No endpoint logs have been recorded yet.
              </div>
            )}
          </section>
        ) : null}
      </div>
      {projectExportDialogOpen && server ? (
        <ProjectExportDialog
          busy={busy === 'export'}
          capabilities={projectExportCapabilities}
          capabilitiesLoading={projectExportCapabilitiesLoading}
          draft={projectExportDraft}
          error={projectExportError}
          result={projectExportResult}
          server={server}
          onCancel={() => {
            setProjectExportDialogOpen(false)
            setProjectExportResult(undefined)
            setProjectExportCapabilities(undefined)
            setProjectExportError(undefined)
          }}
          onExport={() => void exportProject()}
          onUpdate={(patch) =>
            setProjectExportDraft((current) =>
              normalizeProjectExportDraft({
                ...current,
                ...patch,
              }),
            )
          }
        />
      ) : null}
      {endpointEditor ? (
        <CustomEndpointEditorDialog
          busy={busy === 'custom-endpoint' || busy === 'query-source'}
          editor={endpointEditor}
          error={endpointEditorError}
          sources={querySources ?? []}
          onCancel={() => {
            setEndpointEditor(undefined)
            setQuerySources(undefined)
            setEndpointEditorError(undefined)
          }}
          onParameterChange={updateEndpointParameter}
          onSave={() => void saveCustomEndpoint()}
          onSelectSource={selectEndpointSource}
          onUpdate={updateEndpointDraft}
        />
      ) : null}
    </section>
  )
}

const apiServerViews: Array<{ id: ApiServerView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'resources', label: 'Resources' },
  { id: 'docs', label: 'Docs' },
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

function ProjectExportDialog({
  busy,
  capabilities,
  capabilitiesLoading,
  draft,
  error,
  result,
  server,
  onCancel,
  onExport,
  onUpdate,
}: {
  busy: boolean
  capabilities?: DatastoreApiServerProjectExportCapabilitiesResponse
  capabilitiesLoading: boolean
  draft: ProjectExportDraft
  error?: string
  result?: DatastoreApiServerProjectExportResponse
  server: ApiServerConfig
  onCancel(): void
  onExport(): void
  onUpdate(patch: Partial<ProjectExportDraft>): void
}) {
  const disabledReason =
    projectExportDisabledReason(server) ??
    projectExportCapabilityBlockingReason(capabilities, draft.framework)
  const validationMessages = projectExportValidationMessages(server)
  const frameworkCapability = capabilities?.frameworks.find(
    (capability) => capability.framework === draft.framework,
  )
  const enabledResources = server.resources.filter(
    (resource) => resource.enabled !== false,
  )
  const enabledCustomEndpoints = server.customEndpoints.filter(
    (endpoint) => endpoint.enabled !== false,
  )
  const frameworkLabel = draft.framework === 'dotnet' ? '.NET' : 'Rust'

  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog api-server-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-server-export-dialog-title"
      >
        <p className="sidebar-eyebrow">Hostable Project</p>
        <h2 id="api-server-export-dialog-title">Export API Server Project</h2>

        <div className="api-server-export-summary">
          <div>
            <span>Protocol</span>
            <strong>{protocolDisplayName(server.protocol)}</strong>
          </div>
          <div>
            <span>Resources</span>
            <strong>{formatNumber(enabledResources.length)}</strong>
          </div>
          <div>
            <span>Custom Endpoints</span>
            <strong>{formatNumber(enabledCustomEndpoints.length)}</strong>
          </div>
        </div>

        <div className="environment-form-grid">
          <label className="environment-field">
            <span>Framework</span>
            <select
              value={draft.framework}
              disabled={busy}
              onChange={(event) =>
                onUpdate({
                  framework: event.target
                    .value as DatastoreApiServerProjectExportFramework,
                })
              }
            >
              <option
                value="rust"
                disabled={capabilities?.frameworks.find(
                  (capability) => capability.framework === 'rust',
                )?.supported === false}
              >
                Rust / axum
              </option>
              <option
                value="dotnet"
                disabled={capabilities?.frameworks.find(
                  (capability) => capability.framework === 'dotnet',
                )?.supported === false}
              >
                .NET / ASP.NET Core
              </option>
            </select>
          </label>
          <label className="environment-field">
            <span>Project name</span>
            <input
              type="text"
              value={draft.projectName}
              disabled={busy}
              onChange={(event) =>
                onUpdate(projectNamePatch(event.target.value, draft.framework))
              }
            />
          </label>
          {draft.framework === 'dotnet' ? (
            <label className="environment-field">
              <span>Namespace</span>
              <input
                type="text"
                value={draft.namespace}
                disabled={busy}
                onChange={(event) =>
                  onUpdate({ namespace: event.target.value })
                }
              />
            </label>
          ) : (
            <label className="environment-field">
              <span>Package name</span>
              <input
                type="text"
                value={draft.packageName}
                disabled={busy}
                onChange={(event) =>
                  onUpdate({ packageName: event.target.value })
                }
              />
            </label>
          )}
        </div>

        <section className="api-server-endpoint-subsection">
          <div className="environment-section-header">
            <strong>Export Contents</strong>
            <span>{frameworkCapability?.client || frameworkLabel}</span>
          </div>
          <div className="api-server-export-list">
            {enabledResources.map((resource) => (
              <div key={resource.id}>
                <strong>{resource.label}</strong>
                <span>
                  {resource.kind} / {resourcePath(server, resource)}
                </span>
                <small>
                  {resourceCapabilityLabel(
                    frameworkCapability?.resources.find(
                      (capability) => capability.resourceId === resource.id,
                    )?.mode,
                  )}
                </small>
                {frameworkCapability?.resources.find(
                  (capability) => capability.resourceId === resource.id,
                )?.reason ? (
                  <small>
                    {
                      frameworkCapability.resources.find(
                        (capability) => capability.resourceId === resource.id,
                      )?.reason
                    }
                  </small>
                ) : null}
              </div>
            ))}
            {enabledCustomEndpoints.map((endpoint) => (
              <div key={endpoint.id}>
                <strong>{endpoint.label}</strong>
                <span>
                  {endpoint.method} / {customEndpointPath(server, endpoint)}
                </span>
                {frameworkCapability?.customEndpoints.find(
                  (capability) => capability.endpointId === endpoint.id,
                )?.reason ? (
                  <small>
                    {
                      frameworkCapability.customEndpoints.find(
                        (capability) => capability.endpointId === endpoint.id,
                      )?.reason
                    }
                  </small>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {validationMessages.length ? (
          <section className="api-server-endpoint-subsection">
            <div className="environment-section-header">
              <strong>Validation</strong>
              <span>Typed models required</span>
            </div>
            <ul className="api-server-export-validation">
              {validationMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {frameworkCapability?.reason ? (
          <p className="settings-inline-note is-error">
            {frameworkCapability.reason}
          </p>
        ) : null}
        {frameworkCapability?.warnings.length ? (
          <ul className="api-server-export-validation">
            {frameworkCapability.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}

        {result?.saved ? (
          <p className="settings-inline-note">
            Saved {result.framework} project to <code>{result.path}</code>.
          </p>
        ) : null}
        {result?.warnings.length ? (
          <ul className="api-server-export-validation">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p className="settings-inline-note is-error">{error}</p>
        ) : null}
        {capabilitiesLoading ? (
          <p className="settings-inline-note">
            Checking datastore client capabilities...
          </p>
        ) : null}

        <div className="workbench-dialog-actions">
          <button type="button" className="drawer-button" onClick={onCancel}>
            Close
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            disabled={
              busy ||
              capabilitiesLoading ||
              !capabilities ||
              Boolean(disabledReason) ||
              !draft.projectName.trim()
            }
            title={disabledReason}
            onClick={onExport}
          >
            <DownloadIcon className="panel-inline-icon" />
            {busy ? 'Exporting...' : 'Export Zip'}
          </button>
        </div>
      </section>
    </div>
  )
}

function CustomEndpointEditorDialog({
  busy,
  editor,
  error,
  sources,
  onCancel,
  onParameterChange,
  onSave,
  onSelectSource,
  onUpdate,
}: {
  busy: boolean
  editor: CustomEndpointEditorState
  error?: string
  sources: DatastoreApiServerQuerySource[]
  onCancel(): void
  onParameterChange(
    name: string,
    patch: Partial<DatastoreApiServerCustomEndpointParameterConfig>,
  ): void
  onSave(): void
  onSelectSource(sourceId: string): void
  onUpdate(patch: Partial<DatastoreApiServerCustomEndpointConfig>): void
}) {
  const endpoint = editor.endpoint
  const parameters = endpoint.parameters ?? []

  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog api-server-endpoint-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-server-endpoint-dialog-title"
      >
        <p className="sidebar-eyebrow">REST Custom Endpoint</p>
        <h2 id="api-server-endpoint-dialog-title">
          {editor.mode === 'edit'
            ? 'Edit Query Endpoint'
            : 'Add Query Endpoint'}
        </h2>

        <div className="api-server-endpoint-form">
          <label className="environment-field api-server-endpoint-source">
            <span>Library query</span>
            {editor.mode === 'edit' ? (
              <input type="text" value={endpoint.sourceName} disabled />
            ) : (
              <select
                value={endpoint.sourceLibraryNodeId}
                disabled={busy || !sources.length}
                onChange={(event) => onSelectSource(event.target.value)}
              >
                {sources.length ? null : (
                  <option value="">No compatible saved queries</option>
                )}
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            )}
          </label>

          <div className="environment-form-grid">
            <label className="environment-field">
              <span>Name</span>
              <input
                type="text"
                value={endpoint.label}
                disabled={busy}
                onChange={(event) => onUpdate({ label: event.target.value })}
              />
            </label>
            <label className="environment-field">
              <span>Slug</span>
              <input
                type="text"
                value={endpoint.endpointSlug}
                disabled={busy}
                onChange={(event) =>
                  onUpdate({ endpointSlug: event.target.value })
                }
              />
            </label>
            <label className="environment-field">
              <span>Method</span>
              <select
                value={endpoint.method}
                disabled={busy}
                onChange={(event) =>
                  onUpdate({
                    method: event.target.value === 'POST' ? 'POST' : 'GET',
                  })
                }
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </label>
            <label className="environment-field">
              <span>Max rows</span>
              <input
                type="number"
                min={1}
                max={500}
                value={endpoint.rowLimit ?? 100}
                disabled={busy}
                onChange={(event) =>
                  onUpdate({ rowLimit: Number(event.target.value) })
                }
              />
            </label>
          </div>

          <label className="environment-field">
            <span>Description</span>
            <input
              type="text"
              value={endpoint.description ?? ''}
              disabled={busy}
              onChange={(event) =>
                onUpdate({ description: event.target.value })
              }
            />
          </label>

          <label className="settings-check-row">
            <input
              type="checkbox"
              checked={endpoint.enabled !== false}
              disabled={busy}
              onChange={(event) => onUpdate({ enabled: event.target.checked })}
            />
            <span>Endpoint enabled</span>
          </label>

          <section className="api-server-endpoint-subsection">
            <div className="environment-section-header">
              <strong>Parameters</strong>
              <span>
                {parameters.length
                  ? formatParameterCount(parameters.length)
                  : 'None detected'}
              </span>
            </div>
            {parameters.length ? (
              <div className="api-server-table-wrap">
                <table className="api-server-table api-server-parameter-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Required</th>
                      <th>Serialization</th>
                      <th>Default</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parameters.map((parameter) => (
                      <tr key={parameter.name}>
                        <td>
                          <code>{parameter.name}</code>
                        </td>
                        <td>
                          <select
                            value={parameter.type}
                            disabled={busy}
                            onChange={(event) =>
                              onParameterChange(parameter.name, {
                                type: event.target
                                  .value as DatastoreApiServerCustomEndpointParameterConfig['type'],
                              })
                            }
                          >
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="boolean">Boolean</option>
                            <option value="json">JSON</option>
                          </select>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={parameter.required}
                            disabled={busy}
                            onChange={(event) =>
                              onParameterChange(parameter.name, {
                                required: event.target.checked,
                              })
                            }
                          />
                        </td>
                        <td>
                          <select
                            value={parameter.serialization ?? 'auto'}
                            disabled={busy}
                            onChange={(event) =>
                              onParameterChange(parameter.name, {
                                serialization: event.target
                                  .value as DatastoreApiServerCustomEndpointParameterConfig['serialization'],
                              })
                            }
                          >
                            <option value="auto">Auto</option>
                            <option value="sql">SQL</option>
                            <option value="json">JSON</option>
                            <option value="raw">Raw</option>
                          </select>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={
                              parameter.defaultValue === undefined
                                ? ''
                                : String(parameter.defaultValue)
                            }
                            disabled={busy}
                            onChange={(event) =>
                              onParameterChange(parameter.name, {
                                defaultValue:
                                  event.target.value === ''
                                    ? undefined
                                    : event.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={parameter.description ?? ''}
                            disabled={busy}
                            onChange={(event) =>
                              onParameterChange(parameter.name, {
                                description: event.target.value,
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="settings-empty">
                Use tokens like <code>{'{{api.email}}'}</code> in the saved
                query to accept endpoint parameters.
              </div>
            )}
          </section>

          <section className="api-server-endpoint-subsection">
            <div className="environment-section-header">
              <strong>Query Preview</strong>
              <span>{endpoint.language}</span>
            </div>
            <pre className="api-server-query-preview">
              {endpoint.queryText || 'No query selected.'}
            </pre>
          </section>

          {error ? (
            <p className="settings-inline-note is-error">{error}</p>
          ) : null}
        </div>

        <div className="workbench-dialog-actions">
          <button type="button" className="drawer-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            disabled={
              busy || !endpoint.sourceLibraryNodeId || !endpoint.queryText
            }
            onClick={onSave}
          >
            {busy ? 'Saving...' : 'Save Endpoint'}
          </button>
        </div>
      </section>
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

function normalizeApiServerConfigs(
  preferences: ApiServerPreferences,
): ApiServerConfig[] {
  const hasLegacyServer =
    !preferences.servers?.length &&
    (typeof preferences.connectionId === 'string' ||
      typeof preferences.environmentId === 'string' ||
      Boolean(preferences.autoStart) ||
      (typeof preferences.port === 'number' &&
        preferences.port !== DEFAULT_API_PORT) ||
      (typeof preferences.activeServerId === 'string' &&
        preferences.activeServerId !== 'api-server-default'))
  const servers = preferences.servers?.length
    ? preferences.servers
    : hasLegacyServer
      ? [
          {
            id: preferences.activeServerId || 'api-server-default',
            name: 'Local API Server',
            host: '127.0.0.1' as const,
            port: preferences.port ?? DEFAULT_API_PORT,
            autoStart: preferences.autoStart,
            requestTimeoutMs: undefined,
            connectionId: preferences.connectionId,
            environmentId: preferences.environmentId,
            protocol: 'rest' as const,
            basePath: '',
            resources: [],
            customEndpoints: [],
          },
        ]
      : []

  return servers.map((server, index) => {
    const port = clampPort(server.port)
    return {
      id: server.id || `api-server-${index + 1}`,
      name: server.name?.trim() || defaultApiServerName(port),
      description: server.description?.trim() || undefined,
      host: '127.0.0.1',
      port,
      autoStart: Boolean(server.autoStart),
      requestTimeoutMs: server.requestTimeoutMs,
      protocol: normalizeProtocol(server.protocol),
      basePath: normalizeBasePath(server.basePath),
      connectionId: server.connectionId,
      environmentId: server.environmentId,
      resources: normalizeResources(server.resources ?? []),
      customEndpoints: normalizeCustomEndpoints(
        server.customEndpoints ?? [],
        server.resources ?? [],
      ),
    }
  })
}

function statusToInstance(
  status: DatastoreApiServerStatus,
): DatastoreApiServerStatus['servers'][number] {
  return {
    id: status.serverId ?? status.activeServerId ?? 'api-server-default',
    name: status.name ?? defaultApiServerName(status.port),
    description: status.description,
    running: status.running,
    host: status.host,
    port: status.port,
    requestTimeoutMs: status.requestTimeoutMs,
    protocol: status.protocol ?? 'rest',
    basePath: status.basePath ?? '',
    baseUrl: status.baseUrl,
    connectionId: status.connectionId,
    environmentId: status.environmentId,
    startedAt: status.startedAt,
    message: status.message,
    warnings: status.warnings,
    resources: status.resources ?? [],
    customEndpoints: status.customEndpoints ?? [],
  }
}

async function withResourceDiscoveryTimeout<T>(
  request: Promise<T>,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), RESOURCE_DISCOVERY_TIMEOUT_MS)
  })
  try {
    return await Promise.race([request.catch(() => undefined), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function apiResourceIdentity(resource: DatastoreApiServerResourceConfig) {
  return [
    resource.kind,
    resource.nodeId,
    resource.scope,
    ...(resource.path ?? []),
    resource.label,
  ]
    .map((part) => part?.trim().toLowerCase())
    .filter(Boolean)
    .join('\u001f')
}

function mergeStatusIntoServer(
  server: ApiServerConfig | undefined,
  status: DatastoreApiServerStatus['servers'][number],
): ApiServerConfig {
  return {
    id: status.id,
    name: status.name,
    description: status.description ?? server?.description,
    host: '127.0.0.1',
    port: status.port,
    autoStart: Boolean(server?.autoStart),
    requestTimeoutMs: status.requestTimeoutMs ?? server?.requestTimeoutMs,
    protocol: normalizeProtocol(status.protocol ?? server?.protocol),
    basePath: normalizeBasePath(status.basePath ?? server?.basePath),
    connectionId: status.connectionId ?? server?.connectionId,
    environmentId: status.environmentId ?? server?.environmentId,
    resources: normalizeResources(status.resources ?? server?.resources ?? []),
    customEndpoints: normalizeCustomEndpoints(
      status.customEndpoints ?? server?.customEndpoints ?? [],
      status.resources ?? server?.resources ?? [],
    ),
  }
}

function normalizeResources(resources: DatastoreApiServerResourceConfig[]) {
  return resources.map((resource) => ({
    ...resource,
    endpointSlug: slug(resource.endpointSlug || resource.label),
    enabled: resource.enabled !== false,
  }))
}

function groupResourcesForDisplay(resources: DatastoreApiServerResourceConfig[]) {
  const groups = new Map<string, DatastoreApiServerResourceConfig[]>()
  for (const resource of resources) {
    const group = resourceGroup(resource)
    groups.set(group, [...(groups.get(group) ?? []), resource])
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function normalizeCustomEndpoints(
  endpoints: DatastoreApiServerCustomEndpointConfig[],
  resources: DatastoreApiServerResourceConfig[],
) {
  const seen = new Map<string, number>()
  for (const resource of normalizeResources(resources)) {
    seen.set(resource.endpointSlug, 1)
  }
  return endpoints.map((endpoint, index) =>
    normalizeCustomEndpoint(
      {
        ...endpoint,
        endpointSlug: uniqueSlug(endpoint.endpointSlug || endpoint.label, seen),
      },
      index,
    ),
  )
}

function normalizeCustomEndpoint(
  endpoint: DatastoreApiServerCustomEndpointConfig,
  index = 0,
): DatastoreApiServerCustomEndpointConfig {
  const label =
    endpoint.label?.trim() ||
    endpoint.sourceName?.trim() ||
    `Query Endpoint ${index + 1}`
  const sourceName = endpoint.sourceName?.trim() || label
  const endpointSlug = slug(endpoint.endpointSlug || label)
  return {
    id: endpoint.id || `api-endpoint-${index + 1}`,
    label,
    description: endpoint.description?.trim() || undefined,
    endpointSlug,
    enabled: endpoint.enabled !== false,
    method: endpoint.method === 'POST' ? 'POST' : 'GET',
    sourceLibraryNodeId: endpoint.sourceLibraryNodeId || '',
    sourceName,
    queryText: endpoint.queryText ?? '',
    language: endpoint.language ?? 'sql',
    queryViewMode:
      endpoint.queryViewMode === 'builder' ||
      endpoint.queryViewMode === 'script'
        ? endpoint.queryViewMode
        : 'raw',
    rowLimit: clampRowLimit(endpoint.rowLimit),
    parameters: normalizeEndpointParameters(
      endpoint.parameters ?? [],
      endpoint.queryText ?? '',
    ),
  }
}

function normalizeEndpointParameters(
  parameters: DatastoreApiServerCustomEndpointParameterConfig[],
  queryText: string,
) {
  const seen = new Set<string>()
  const normalized: DatastoreApiServerCustomEndpointParameterConfig[] = []
  for (const [index, parameter] of parameters.entries()) {
    const name = isApiParameterName(parameter.name)
      ? parameter.name.trim()
      : `param${index + 1}`
    if (seen.has(name)) continue
    seen.add(name)
    normalized.push({
      name,
      type:
        parameter.type === 'number' ||
        parameter.type === 'boolean' ||
        parameter.type === 'json'
          ? parameter.type
          : 'string',
      required: Boolean(parameter.required),
      defaultValue: parameter.defaultValue,
      description: parameter.description?.trim() || undefined,
      serialization:
        parameter.serialization === 'sql' ||
        parameter.serialization === 'json' ||
        parameter.serialization === 'raw'
          ? parameter.serialization
          : 'auto',
    })
  }
  for (const name of apiParameterNames(queryText)) {
    if (seen.has(name)) continue
    seen.add(name)
    normalized.push({
      name,
      type: 'string',
      required: true,
      serialization: 'auto',
    })
  }
  return normalized
}

function customEndpointFromSource(
  source: DatastoreApiServerQuerySource | undefined,
  server: ApiServerConfig,
  endpointId = `api-endpoint-${Date.now()}`,
): DatastoreApiServerCustomEndpointConfig {
  const label = source?.name?.trim() || 'Query Endpoint'
  const usedSlugs = new Map<string, number>()
  for (const resource of server.resources)
    usedSlugs.set(resource.endpointSlug, 1)
  for (const endpoint of server.customEndpoints) {
    if (endpoint.id !== endpointId) usedSlugs.set(endpoint.endpointSlug, 1)
  }
  const queryText = source?.queryText ?? ''
  return normalizeCustomEndpoint({
    id: endpointId,
    label,
    description: source?.summary,
    endpointSlug: uniqueSlug(label, usedSlugs),
    enabled: true,
    method: 'GET',
    sourceLibraryNodeId: source?.id ?? '',
    sourceName: source?.name ?? label,
    queryText,
    language: source?.language ?? 'sql',
    queryViewMode: source?.queryViewMode ?? 'raw',
    rowLimit: 100,
    parameters: normalizeEndpointParameters([], queryText),
  })
}

function resourcePath(
  server: ApiServerConfig,
  resource: DatastoreApiServerResourceConfig,
) {
  const basePath = normalizeBasePath(server.basePath)
  const endpoint = `/${slug(resource.endpointSlug || resource.label)}`
  return `${basePath}${endpoint}` || endpoint
}

function customEndpointPath(
  server: ApiServerConfig,
  endpoint: DatastoreApiServerCustomEndpointConfig,
) {
  const basePath = normalizeBasePath(server.basePath)
  const endpointPath = `/${slug(endpoint.endpointSlug || endpoint.label)}`
  return `${basePath}${endpointPath}` || endpointPath
}

function docsTitle(server: ApiServerConfig | undefined) {
  if (server?.protocol === 'graphql') return 'GraphQL'
  if (server?.protocol === 'grpc') return 'gRPC'
  return 'OpenAPI'
}

function protocolDisplayName(protocol: ApiServerProtocol | undefined) {
  if (protocol === 'graphql') return 'GraphQL'
  if (protocol === 'grpc') return 'gRPC'
  return 'REST'
}

function formatExposureCount(resources: number, customEndpoints: number) {
  if (!resources && !customEndpoints) return 'None'
  if (!customEndpoints) {
    return resources === 1
      ? '1 resource'
      : `${formatNumber(resources)} resources`
  }
  if (!resources) {
    return customEndpoints === 1
      ? '1 query endpoint'
      : `${formatNumber(customEndpoints)} query endpoints`
  }
  return `${formatNumber(resources)} CRUD / ${formatNumber(customEndpoints)} custom`
}

function formatParameterCount(count: number) {
  return count === 1 ? '1 parameter' : `${formatNumber(count)} parameters`
}

function serverStartDisabledReason(server: ApiServerConfig | undefined) {
  if (!server?.connectionId)
    return 'Choose a datastore before starting this server.'
  if (!server.environmentId)
    return 'Choose an environment before starting this server.'
  const hasCrudResource = server.resources.some(
    (resource) => resource.enabled !== false,
  )
  const hasCustomEndpoint = server.customEndpoints.some(
    (endpoint) => endpoint.enabled !== false,
  )
  if (!hasCrudResource && !hasCustomEndpoint)
    return 'Add at least one CRUD resource or query endpoint before starting this server.'
  return undefined
}

function projectExportDisabledReason(server: ApiServerConfig | undefined) {
  if (!server?.connectionId)
    return 'Choose a datastore before exporting this project.'
  if (!server.environmentId)
    return 'Choose an environment before exporting this project.'
  const enabledResources = server.resources.filter(
    (resource) => resource.enabled !== false,
  )
  const enabledCustomEndpoints = server.customEndpoints.filter(
    (endpoint) => endpoint.enabled !== false,
  )
  if (!enabledResources.length && !enabledCustomEndpoints.length) {
    return 'Add at least one CRUD resource or query endpoint before exporting this project.'
  }
  if (server.protocol !== 'rest' && enabledCustomEndpoints.length) {
    return 'Custom query endpoints can only be exported with REST/OpenAPI servers in this version.'
  }
  return undefined
}

function projectExportValidationMessages(server: ApiServerConfig) {
  const messages = [
    'Export uses environment variables only; DataPad++ secrets are not included.',
    'Typed models and physical identifiers come from datastore catalog metadata.',
  ]
  if (
    server.protocol !== 'rest' &&
    server.customEndpoints.some((endpoint) => endpoint.enabled !== false)
  ) {
    messages.push(
      'Custom query endpoints are stored with this server, but export supports them only for REST/OpenAPI projects.',
    )
  }
  return messages
}

function projectExportCapabilityBlockingReason(
  capabilities: DatastoreApiServerProjectExportCapabilitiesResponse | undefined,
  framework: DatastoreApiServerProjectExportFramework,
) {
  if (!capabilities) return 'Project export capabilities have not loaded.'
  const capability = capabilities.frameworks.find(
    (candidate) => candidate.framework === framework,
  )
  if (!capability) return 'This framework has no project export renderer.'
  if (!capability.supported) {
    return capability.reason ?? 'This framework and datastore are not supported.'
  }
  const blockedResource = capability.resources.find(
    (resource) => resource.mode === 'unsupported',
  )
  if (blockedResource) {
    return blockedResource.reason ?? 'A configured resource cannot be exported.'
  }
  const blockedEndpoint = capability.customEndpoints.find(
    (endpoint) => !endpoint.supported,
  )
  return blockedEndpoint?.reason
}

function resourceCapabilityLabel(
  mode: 'crud' | 'read-only' | 'unsupported' | undefined,
) {
  if (mode === 'crud') return 'CRUD client'
  if (mode === 'read-only') return 'Read-only client'
  if (mode === 'unsupported') return 'Unsupported'
  return 'Checking catalog metadata'
}

function defaultProjectExportDraft(
  serverName = 'API Server',
): ProjectExportDraft {
  const projectName = pascalName(serverName, 'ApiServer')
  return normalizeProjectExportDraft({
    framework: 'rust',
    projectName,
    namespace: projectName,
    packageName: slug(projectName).replaceAll('-', '_'),
  })
}

function normalizeProjectExportDraft(draft: ProjectExportDraft) {
  const projectName = draft.projectName
  const fallbackName = pascalName(projectName, 'ApiServer')
  return {
    framework: draft.framework === 'dotnet' ? 'dotnet' : 'rust',
    projectName,
    namespace: draft.namespace || fallbackName,
    packageName:
      draft.packageName ||
      slug(projectName || fallbackName).replaceAll('-', '_'),
  } satisfies ProjectExportDraft
}

function projectNamePatch(
  projectName: string,
  framework: DatastoreApiServerProjectExportFramework,
): Partial<ProjectExportDraft> {
  const normalizedName = pascalName(projectName, 'ApiServer')
  return framework === 'dotnet'
    ? { projectName, namespace: normalizedName }
    : {
        projectName,
        packageName: slug(projectName || normalizedName).replaceAll('-', '_'),
      }
}

function defaultApiServerName(port: number) {
  const safePort = clampPort(port)
  return safePort === DEFAULT_API_PORT
    ? 'Local API Server'
    : `Local API Server ${safePort}`
}

function normalizeProtocol(
  value: ApiServerConfig['protocol'] | undefined,
): ApiServerProtocol {
  return value === 'graphql' || value === 'grpc' ? value : 'rest'
}

function normalizeBasePath(value: string | undefined) {
  const trimmed = (value ?? '').trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}` : ''
}

function slug(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'resource'
  )
}

function uniqueSlug(value: string, seen: Map<string, number>) {
  const base = slug(value)
  const count = seen.get(base) ?? 0
  seen.set(base, count + 1)
  if (!count) return base
  const next = `${base}-${count + 1}`
  seen.set(next, 1)
  return next
}

function pascalName(value: string, fallback: string) {
  const parts = value
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  const name = parts
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('')
  if (!name || /^\d/.test(name)) return fallback
  return name
}

function clampPort(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_API_PORT
  return Math.min(65535, Math.max(1024, Math.floor(value)))
}

function requestTimeoutMilliseconds(value: string) {
  const seconds = Number(value.trim())
  if (!value.trim() || !Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.min(86_400, Math.max(1, Math.round(seconds))) * 1000
}

function clampRowLimit(value: number | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return 100
  return Math.min(500, Math.max(1, Math.floor(value ?? 100)))
}

function apiParameterNames(queryText: string) {
  const names: string[] = []
  const pattern = /\{\{api\.([^}]+)\}\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(queryText))) {
    const name = match[1]?.trim()
    if (name && isApiParameterName(name) && !names.includes(name)) {
      names.push(name)
    }
  }
  return names
}

function isApiParameterName(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim())
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
