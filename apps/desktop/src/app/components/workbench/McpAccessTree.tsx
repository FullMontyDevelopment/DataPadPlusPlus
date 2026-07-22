import { useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  LibraryNode,
} from '@datapadplusplus/shared-types'
import { ChevronDownIcon, SearchIcon } from './icons'
import { assignedEnvironmentIdsForConnection } from './connection-environment-assignments'

const NO_ENVIRONMENT_ID = '__no-environment__'

interface McpAccessTreeProps {
  connections: ConnectionProfile[]
  environments: EnvironmentProfile[]
  libraryNodes: LibraryNode[]
  environmentIds: string[]
  connectionIds: string[]
  allowNoEnvironment: boolean
  disabled?: boolean
  onChange(next: {
    environmentIds: string[]
    connectionIds: string[]
    allowNoEnvironment: boolean
  }): void
}

type AccessRow =
  | { id: string; kind: 'context'; label: string; detail: string }
  | { id: string; kind: 'connection'; connection: ConnectionProfile; contextCount: number }

export function McpAccessTree({
  connections,
  environments,
  libraryNodes,
  environmentIds,
  connectionIds,
  allowNoEnvironment,
  disabled,
  onChange,
}: McpAccessTreeProps) {
  const [contextSearch, setContextSearch] = useState('')
  const [datastoreSearch, setDatastoreSearch] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const assignedEnvironmentIds = useMemo(
    () => new Map(connections.map((connection) => [
      connection.id,
      assignedEnvironmentIdsForConnection(connection, libraryNodes),
    ])),
    [connections, libraryNodes],
  )
  const hasNoEnvironmentConnections = connections.some(
    (connection) => (assignedEnvironmentIds.get(connection.id)?.length ?? 0) === 0,
  )
  const selectedContextIds = useMemo(
    () => new Set(environmentIds),
    [environmentIds],
  )
  const selectedContextCount = environmentIds.length + (allowNoEnvironment ? 1 : 0)
  const filteredEnvironments = useMemo(() => {
    const query = contextSearch.trim().toLocaleLowerCase()
    if (!query) return environments
    return environments.filter((environment) =>
      `${environment.label} ${environment.risk}`.toLocaleLowerCase().includes(query),
    )
  }, [contextSearch, environments])
  const selectedContexts = useMemo(
    () => environments.filter((environment) => selectedContextIds.has(environment.id)),
    [environments, selectedContextIds],
  )
  const availableContextCountByConnection = useMemo(() => {
    const counts = new Map<string, number>()
    for (const connection of connections) {
      const environmentsForConnection = assignedEnvironmentIds.get(connection.id) ?? []
      const count = environmentsForConnection.filter((id) => selectedContextIds.has(id)).length
        + (allowNoEnvironment && environmentsForConnection.length === 0 ? 1 : 0)
      counts.set(connection.id, count)
    }
    return counts
  }, [allowNoEnvironment, assignedEnvironmentIds, connections, selectedContextIds])
  const query = datastoreSearch.trim().toLocaleLowerCase()
  const matchesDatastoreSearch = useCallback((connection: ConnectionProfile) =>
    !query || `${connection.name} ${connection.engine} ${connection.family}`
      .toLocaleLowerCase()
      .includes(query), [query])

  const rows = useMemo(() => {
    const next: AccessRow[] = []
    for (const environment of selectedContexts) {
      next.push({
        id: `context:${environment.id}`,
        kind: 'context',
        label: environment.label,
        detail: `${environment.risk}${environment.safeMode ? ' / safe mode' : ''}`,
      })
      for (const connection of connections) {
        if (
          !assignedEnvironmentIds.get(connection.id)?.includes(environment.id) ||
          !matchesDatastoreSearch(connection)
        ) continue
        next.push({
          id: `connection:${environment.id}:${connection.id}`,
          kind: 'connection',
          connection,
          contextCount: availableContextCountByConnection.get(connection.id) ?? 1,
        })
      }
    }
    if (allowNoEnvironment) {
      next.push({
        id: `context:${NO_ENVIRONMENT_ID}`,
        kind: 'context',
        label: 'No environment',
        detail: 'Low risk / no variables',
      })
      for (const connection of connections) {
        if (
          (assignedEnvironmentIds.get(connection.id)?.length ?? 0) > 0 ||
          !matchesDatastoreSearch(connection)
        ) continue
        next.push({
          id: `connection:${NO_ENVIRONMENT_ID}:${connection.id}`,
          kind: 'connection',
          connection,
          contextCount: 1,
        })
      }
    }
    return next
  }, [
    allowNoEnvironment,
    assignedEnvironmentIds,
    availableContextCountByConnection,
    connections,
    matchesDatastoreSearch,
    selectedContexts,
  ])
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index]?.kind === 'context' ? 38 : 46,
    overscan: 10,
  })
  const changeContext = (contextId: string, checked: boolean) => {
    const nextEnvironmentIds = contextId === NO_ENVIRONMENT_ID
      ? environmentIds
      : checked
        ? [...new Set([...environmentIds, contextId])]
        : environmentIds.filter((id) => id !== contextId)
    const nextAllowNoEnvironment = contextId === NO_ENVIRONMENT_ID ? checked : allowNoEnvironment
    const nextSelected = new Set(nextEnvironmentIds)
    const nextConnectionIds = connectionIds.filter((connectionId) => {
      const connection = connections.find((item) => item.id === connectionId)
      const environmentsForConnection = connection
        ? assignedEnvironmentIds.get(connection.id) ?? []
        : []
      return Boolean(connection && (
        environmentsForConnection.some((id) => nextSelected.has(id)) ||
        (nextAllowNoEnvironment && environmentsForConnection.length === 0)
      ))
    })
    onChange({
      environmentIds: nextEnvironmentIds,
      connectionIds: nextConnectionIds,
      allowNoEnvironment: nextAllowNoEnvironment,
    })
  }

  const changeConnection = (connectionId: string, checked: boolean) => {
    onChange({
      environmentIds,
      allowNoEnvironment,
      connectionIds: checked
        ? [...new Set([...connectionIds, connectionId])]
        : connectionIds.filter((id) => id !== connectionId),
    })
  }

  return (
    <div className="mcp-access-layout">
      <section className="environment-card mcp-access-contexts">
        <div className="environment-section-header">
          <div className="api-server-section-title">
            <strong>1. Environments</strong>
            <span>Select environments before granting datastore access.</span>
          </div>
          <span>{selectedContextCount} selected</span>
        </div>
        <label className="mcp-access-search">
          <SearchIcon className="panel-inline-icon" />
          <input
            type="search"
            value={contextSearch}
            placeholder="Search environments"
            onChange={(event) => setContextSearch(event.target.value)}
          />
        </label>
        <div className="mcp-access-context-list">
          {filteredEnvironments.map((environment) => (
            <label key={environment.id} className="settings-check-row mcp-access-context-row">
              <input
                type="checkbox"
                aria-label={`${environment.label} ${environment.risk}${environment.safeMode ? ' safe mode' : ''}`}
                checked={selectedContextIds.has(environment.id)}
                disabled={disabled}
                onChange={(event) => changeContext(environment.id, event.target.checked)}
              />
              <span className="mcp-access-environment-label">
                <strong>{environment.label}</strong>
                <small className={`mcp-access-risk mcp-access-risk--${environment.risk}`}>
                  {environment.risk}
                </small>
                {environment.safeMode ? <small className="mcp-access-safe-mode">Safe mode</small> : null}
              </span>
            </label>
          ))}
          {hasNoEnvironmentConnections ? (
            <label className="settings-check-row mcp-access-context-row">
              <input
                type="checkbox"
                checked={allowNoEnvironment}
                disabled={disabled}
                onChange={(event) => changeContext(NO_ENVIRONMENT_ID, event.target.checked)}
              />
              <span>
                <strong>No environment</strong>
                <small>Connections with no assigned environment</small>
              </span>
            </label>
          ) : null}
        </div>
      </section>

      <section className="environment-card mcp-access-datastores">
        <div className="environment-section-header">
          <div className="api-server-section-title">
            <strong>2. Datastores</strong>
            <span>Only connections assigned to a selected environment are shown.</span>
          </div>
          <span>{connectionIds.length} enabled</span>
        </div>
        {selectedContextCount === 0 ? (
          <div className="settings-empty mcp-access-empty">
            Select at least one environment to choose datastores.
          </div>
        ) : (
          <>
            <label className="mcp-access-search">
              <SearchIcon className="panel-inline-icon" />
              <input
                type="search"
                value={datastoreSearch}
                placeholder="Search available datastores"
                onChange={(event) => setDatastoreSearch(event.target.value)}
              />
            </label>
            <div ref={scrollRef} className="mcp-access-tree" role="tree" aria-label="MCP datastore access">
              <div className="mcp-access-tree-spacer" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index]
                  if (!row) return null
                  return (
                    <div
                      key={row.id}
                      className={`mcp-access-tree-row mcp-access-tree-row--${row.kind}`}
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                      role="treeitem"
                    >
                      {row.kind === 'context' ? (
                        <>
                          <ChevronDownIcon className="panel-inline-icon" />
                          <strong>{row.label}</strong>
                          <span>{row.detail}</span>
                        </>
                      ) : (
                        <label>
                          <input
                            type="checkbox"
                            checked={connectionIds.includes(row.connection.id)}
                            disabled={disabled}
                            onChange={(event) => changeConnection(row.connection.id, event.target.checked)}
                          />
                          <span>
                            <strong>{row.connection.name}</strong>
                            <small>{row.connection.engine} / {row.connection.family}</small>
                          </span>
                          {row.contextCount > 1 ? (
                            <span className="mcp-access-badge">{row.contextCount} environments</span>
                          ) : null}
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
