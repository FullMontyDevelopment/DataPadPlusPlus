import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  DatastoreApiServerCreateRequest,
  DatastoreApiServerProtocol,
  DatastoreApiServerResourceConfig,
  DatastoreApiServerResourceDiscoveryRequest,
  DatastoreApiServerResourceDiscoveryResponse,
  EnvironmentProfile,
  LibraryNode,
} from '@datapadplusplus/shared-types'
import { ApiResourcePicker } from './ApiResourcePicker'
import { assignedEnvironmentIdsForConnection } from './connection-environment-assignments'
import { SearchIcon } from './icons'

const WIZARD_STEPS = ['Details', 'Datastore', 'Resources', 'Review'] as const

export interface ApiServerWizardInitialState {
  connectionId?: string
  environmentId?: string
  name?: string
  description?: string
  resource?: DatastoreApiServerResourceConfig
}

interface ApiServerCreateWizardProps {
  connections: ConnectionProfile[]
  environments: EnvironmentProfile[]
  libraryNodes: LibraryNode[]
  initial: ApiServerWizardInitialState
  onCancel(): void
  onDiscover(
    request: DatastoreApiServerResourceDiscoveryRequest,
  ): Promise<DatastoreApiServerResourceDiscoveryResponse | undefined>
  onFinish(request: DatastoreApiServerCreateRequest): Promise<boolean>
}

export function ApiServerCreateWizard({
  connections,
  environments,
  libraryNodes,
  initial,
  onCancel,
  onDiscover,
  onFinish,
}: ApiServerCreateWizardProps) {
  const initialConnection = connections.find((connection) => connection.id === initial.connectionId)
  const [step, setStep] = useState(0)
  const [name, setName] = useState(initial.name ?? 'Datastore API')
  const [description, setDescription] = useState(initial.description ?? '')
  const [protocol, setProtocol] = useState<DatastoreApiServerProtocol>('rest')
  const [port, setPort] = useState(17640)
  const [timeoutSeconds, setTimeoutSeconds] = useState('')
  const [connectionId, setConnectionId] = useState(initial.connectionId ?? '')
  const initialEnvironmentIds = initialConnection
    ? assignedEnvironmentIdsForConnection(initialConnection, libraryNodes)
    : []
  const [environmentId, setEnvironmentId] = useState(
    initial.environmentId ?? initialEnvironmentIds[0] ?? '',
  )
  const [contextSearch, setContextSearch] = useState('')
  const [resources, setResources] = useState<DatastoreApiServerResourceConfig[]>(
    initial.resource ? [initial.resource] : [],
  )
  const [discoveredResources, setDiscoveredResources] = useState<DatastoreApiServerResourceConfig[]>()
  const [selectedResourceIds, setSelectedResourceIds] = useState(
    new Set(initial.resource ? [initial.resource.id] : []),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selectedConnection = connections.find((connection) => connection.id === connectionId)
  const selectedEnvironment = environments.find((environment) => environment.id === environmentId)
  const environmentIdsByConnection = useMemo(
    () => new Map(connections.map((connection) => [
      connection.id,
      assignedEnvironmentIdsForConnection(connection, libraryNodes),
    ])),
    [connections, libraryNodes],
  )
  const availableEnvironments = useMemo(() => {
    const assigned = selectedConnection
      ? new Set(environmentIdsByConnection.get(selectedConnection.id) ?? [])
      : new Set<string>()
    return environments.filter((environment) => assigned.has(environment.id))
  }, [environmentIdsByConnection, environments, selectedConnection])
  const filteredConnections = useMemo(() => {
    const query = contextSearch.trim().toLocaleLowerCase()
    return connections.filter((connection) =>
      !query || `${connection.name} ${connection.engine} ${connection.family}`
        .toLocaleLowerCase()
        .includes(query),
    )
  }, [connections, contextSearch])
  const canContinue = step === 0
    ? Boolean(name.trim() && port >= 1024 && port <= 65535)
    : step === 1
      ? Boolean(connectionId && environmentId)
      : true

  const discoverResources = useCallback(async () => {
    if (!connectionId || !environmentId) return
    setBusy(true)
    setError('')
    try {
      const response = await onDiscover({ connectionId, environmentId, limit: 500 })
      const discovered = response?.resources ?? []
      setDiscoveredResources(discovered)
    } catch (reason) {
      setError(sanitizedWizardError(reason, 'Resource discovery failed.'))
    } finally {
      setBusy(false)
    }
  }, [connectionId, environmentId, onDiscover])

  const updateSelectedResources = (next: Set<string>) => {
    setSelectedResourceIds(next)
    setResources((discoveredResources ?? []).filter((resource) => next.has(resource.id)))
  }

  const selectConnection = (connection: ConnectionProfile) => {
    const nextEnvironmentIds = environmentIdsByConnection.get(connection.id) ?? []
    setConnectionId(connection.id)
    setEnvironmentId(nextEnvironmentIds[0] ?? '')
    setResources([])
    setSelectedResourceIds(new Set())
    setDiscoveredResources(undefined)
  }

  const advanceStep = () => {
    const nextStep = step + 1
    setStep(nextStep)
    if (nextStep === 2 && discoveredResources === undefined) {
      void discoverResources()
    }
  }

  const finish = async () => {
    setBusy(true)
    setError('')
    try {
      const completed = await onFinish({
        name: name.trim(),
        description: description.trim() || undefined,
        protocol,
        port,
        requestTimeoutMs: timeoutMilliseconds(timeoutSeconds),
        connectionId,
        environmentId,
        resources,
      })
      if (!completed) setError('The API server could not be created. Review the settings and try again.')
    } catch (reason) {
      setError(sanitizedWizardError(reason, 'The API server could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog api-server-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-server-wizard-title"
      >
        <p className="sidebar-eyebrow">API Server</p>
        <h2 id="api-server-wizard-title">Create API Server</h2>
        <ol className="api-server-wizard-steps" aria-label="Creation steps">
          {WIZARD_STEPS.map((label, index) => (
            <li key={label} className={index === step ? 'is-active' : index < step ? 'is-complete' : undefined}>
              <span>{index + 1}</span>{label}
            </li>
          ))}
        </ol>

        <div className="api-server-wizard-content">
          {step === 0 ? (
            <div className="environment-form-grid">
              <label className="environment-field">
                <span>Name</span>
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="environment-field">
                <span>Description</span>
                <input value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
              <label className="environment-field">
                <span>Protocol</span>
                <select value={protocol} onChange={(event) => setProtocol(event.target.value as DatastoreApiServerProtocol)}>
                  <option value="rest">REST / OpenAPI</option>
                  <option value="graphql">GraphQL</option>
                  <option value="grpc">gRPC</option>
                </select>
              </label>
              <label className="environment-field">
                <span>Port</span>
                <input type="number" min={1024} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} />
              </label>
              <label className="environment-field">
                <span>Request timeout (seconds)</span>
                <input
                  type="number"
                  min={-1}
                  max={86400}
                  value={timeoutSeconds}
                  placeholder="Unlimited"
                  onChange={(event) => setTimeoutSeconds(event.target.value)}
                />
              </label>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="api-server-wizard-context">
              <div className="api-server-wizard-context-toolbar">
                <label className="mcp-access-search">
                  <SearchIcon className="panel-inline-icon" />
                  <input
                    type="search"
                    autoFocus
                    value={contextSearch}
                    placeholder="Search datastores"
                    onChange={(event) => setContextSearch(event.target.value)}
                  />
                </label>
                <label className="environment-field api-server-wizard-environment-select">
                  <span>Environment</span>
                  <select
                    value={environmentId}
                    disabled={!selectedConnection || availableEnvironments.length === 0}
                    onChange={(event) => {
                      setEnvironmentId(event.target.value)
                      setResources([])
                      setSelectedResourceIds(new Set())
                      setDiscoveredResources(undefined)
                    }}
                  >
                    {availableEnvironments.length === 0 ? (
                      <option value="">No assigned environments</option>
                    ) : null}
                    {availableEnvironments.map((environment) => (
                      <option key={environment.id} value={environment.id}>
                        {environment.label} ({environment.risk})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <section className="api-server-wizard-datastore-list">
                <header>
                  <div className="api-server-section-title">
                    <strong>Datastore</strong>
                    <span>Select the connection this server will expose.</span>
                  </div>
                  <span>{filteredConnections.length} available</span>
                </header>
                <div role="radiogroup" aria-label="Datastore">
                  {filteredConnections.map((connection) => {
                    const assignedCount = environmentIdsByConnection.get(connection.id)?.length ?? 0
                    return (
                      <label key={connection.id} className="settings-check-row">
                        <input
                          type="radio"
                          name="api-server-connection"
                          checked={connectionId === connection.id}
                          onChange={() => selectConnection(connection)}
                        />
                        <span>
                          <strong>{connection.name}</strong>
                          <small>{connection.engine} / {connection.family}</small>
                        </span>
                        <small>{assignedCount} {assignedCount === 1 ? 'environment' : 'environments'}</small>
                      </label>
                    )
                  })}
                </div>
                {filteredConnections.length === 0 ? (
                  <div className="settings-empty">No datastores match this search.</div>
                ) : null}
              </section>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="api-server-wizard-resources">
              {busy && discoveredResources === undefined ? (
                <div className="settings-empty">Discovering Explorer resources...</div>
              ) : discoveredResources ? (
                <ApiResourcePicker
                  embedded
                  resources={discoveredResources}
                  selectedIds={selectedResourceIds}
                  busy={busy}
                  onSelectionChange={updateSelectedResources}
                />
              ) : (
                <div className="settings-empty api-server-wizard-resource-error">
                  <p>Resources could not be loaded.</p>
                  <button type="button" className="drawer-button" onClick={() => void discoverResources()}>
                    Retry Discovery
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="api-server-wizard-review">
              <header>
                <strong>Ready to create</strong>
                <span>The server remains stopped until you start it.</span>
              </header>
              <div className="api-server-wizard-review-grid">
                <section>
                  <span>Server</span>
                  <strong>{name}</strong>
                  <small>{protocol.toUpperCase()} on port {port}</small>
                </section>
                <section>
                  <span>Datastore</span>
                  <strong>{selectedConnection?.name ?? 'Not selected'}</strong>
                  <small>{selectedEnvironment?.label ?? 'No environment selected'}</small>
                </section>
                <section>
                  <span>Exposure</span>
                  <strong>{resources.length} {resources.length === 1 ? 'resource' : 'resources'}</strong>
                  <small>{timeoutMilliseconds(timeoutSeconds) ? `${timeoutSeconds} second timeout` : 'Unlimited request time'}</small>
                </section>
              </div>
              {description.trim() ? <p>{description.trim()}</p> : null}
            </div>
          ) : null}
        </div>

        {error ? <p className="settings-inline-note is-error" role="alert">{error}</p> : null}
        <div className="drawer-button-row api-server-wizard-actions">
          <button type="button" className="drawer-button" disabled={busy || step === 0} onClick={() => setStep((current) => current - 1)}>
            Back
          </button>
          <span />
          <button type="button" className="drawer-button" disabled={busy} onClick={onCancel}>Cancel</button>
          {step < WIZARD_STEPS.length - 1 ? (
            <button type="button" className="drawer-button drawer-button--primary" disabled={!canContinue || busy} onClick={advanceStep}>
              Next
            </button>
          ) : (
            <button type="button" className="drawer-button drawer-button--primary" disabled={busy} onClick={() => void finish()}>
              {busy ? 'Creating...' : 'Finish'}
            </button>
          )}
        </div>
      </section>

    </div>
  )
}

function timeoutMilliseconds(value: string) {
  const seconds = Number(value.trim())
  if (!value.trim() || !Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.min(86_400, Math.max(1, Math.round(seconds))) * 1000
}

function sanitizedWizardError(reason: unknown, fallback: string) {
  if (!(reason instanceof Error)) return fallback
  return reason.message.replace(/(password|token|secret|key)\s*[:=]\s*\S+/gi, '$1=[redacted]') || fallback
}
