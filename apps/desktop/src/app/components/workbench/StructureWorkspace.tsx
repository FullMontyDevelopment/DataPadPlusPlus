import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  StructureNode,
  StructureResponse,
} from '@datapadplusplus/shared-types'
import { DatastoreIcon } from './DatastoreIcon'
import { environmentAccentVariables } from './SideBar.helpers'
import {
  DatabaseIcon,
  ExplorerIcon,
  JsonIcon,
  KeyValueIcon,
  RefreshIcon,
  SearchIcon,
  TableIcon,
} from './icons'

interface StructureWorkspaceProps {
  activeConnection?: ConnectionProfile
  activeEnvironment?: EnvironmentProfile
  status: 'idle' | 'loading' | 'ready'
  structure?: StructureResponse
  error?: string
  onRefresh(): void
  onInspectNode(node: StructureNode): void
}

export function StructureWorkspace({
  activeConnection,
  activeEnvironment,
  status,
  structure,
  error,
  onRefresh,
  onInspectNode,
}: StructureWorkspaceProps) {
  const [filter, setFilter] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>()
  const environmentStyle = environmentAccentVariables(activeEnvironment)
  const filteredNodes = useMemo(() => {
    const needle = filter.trim().toLowerCase()

    if (!needle) {
      return structure?.nodes ?? []
    }

    return (structure?.nodes ?? []).filter((node) => {
      const haystack = `${node.label} ${node.kind} ${node.detail ?? ''} ${(node.fields ?? [])
        .map((field) => `${field.name} ${field.dataType}`)
        .join(' ')}`.toLowerCase()

      return haystack.includes(needle)
    })
  }, [filter, structure?.nodes])
  const selectedNode =
    filteredNodes.find((node) => node.id === selectedNodeId) ?? filteredNodes[0]

  return (
    <section
      className={`structure-workspace${activeEnvironment ? ' has-environment-accent' : ''}`}
      style={environmentStyle as CSSProperties}
      aria-label="Visual database structure"
    >
      <header className="structure-header">
        <div>
          <p className="sidebar-eyebrow">Explorer</p>
          <h1>{activeConnection ? activeConnection.name : 'Database structure'}</h1>
          <p>
            {activeConnection && activeEnvironment
              ? `${activeConnection.engine} / ${activeEnvironment.label}`
              : 'Choose a connection to inspect its structure.'}
          </p>
        </div>

        <div className="structure-actions">
          <button
            type="button"
            className="toolbar-action"
            disabled={!activeConnection || !activeEnvironment || status === 'loading'}
            title="Reload the visual structure map using safe bounded metadata limits."
            onClick={onRefresh}
          >
            <RefreshIcon className="toolbar-icon" />
            Refresh
          </button>
        </div>
      </header>

      {!activeConnection || !activeEnvironment ? (
        <div className="structure-empty">
          <ExplorerIcon className="empty-icon" />
          <h2>Connect first</h2>
          <p>Create or select a connection, then Explorer can map schemas, collections, or keys.</p>
        </div>
      ) : error ? (
        <div className="structure-empty structure-empty--error">
          <ExplorerIcon className="empty-icon" />
          <h2>Structure unavailable</h2>
          <p>{error}</p>
        </div>
      ) : (
        <div className="structure-body">
          <div className="structure-toolbar">
            <label className="structure-search">
              <SearchIcon className="toolbar-icon" />
              <span className="sr-only">Search structure</span>
              <input
                type="search"
                placeholder="Search tables, collections, keys, fields"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            <div className="structure-metrics">
              {(structure?.metrics ?? []).map((metric) => (
                <span key={`${metric.label}-${metric.value}`}>
                  {metric.label}: <strong>{metric.value}</strong>
                </span>
              ))}
              {structure?.truncated ? <span>Metadata truncated</span> : null}
            </div>
          </div>

          {status === 'loading' ? (
            <div className="structure-empty">
              <ExplorerIcon className="empty-icon" />
              <h2>Loading structure...</h2>
              <p>Metadata is loading with safe limits.</p>
            </div>
          ) : filteredNodes.length === 0 ? (
            <div className="structure-empty">
              <ExplorerIcon className="empty-icon" />
              <h2>No structure objects found</h2>
              <p>Refresh metadata or adjust the filter.</p>
            </div>
          ) : (
            <div className="structure-map-layout">
              <div className="structure-canvas">
                {(structure?.groups ?? [{ id: 'objects', label: 'Objects', kind: 'group' }]).map(
                  (group) => {
                    const groupNodes = filteredNodes.filter(
                      (node) => (node.groupId ?? 'objects') === group.id,
                    )

                    if (groupNodes.length === 0) {
                      return null
                    }

                    return (
                      <section key={group.id} className="structure-group">
                        <div className="structure-group-header">
                          <strong>{group.label}</strong>
                          <span>{group.kind}</span>
                        </div>
                        <div className="structure-node-grid">
                          {groupNodes.map((node) => (
                            <button
                              key={node.id}
                              type="button"
                              className={`structure-node${selectedNode?.id === node.id ? ' is-active' : ''}`}
                              title={`${node.label}: inspect fields, metrics, and relationships.`}
                              onClick={() => {
                                setSelectedNodeId(node.id)
                              }}
                            >
                              <span className="structure-node-title">
                                <StructureNodeIcon connection={activeConnection} node={node} />
                                <strong>{node.label}</strong>
                                <button
                                  type="button"
                                  className="structure-node-inspect"
                                  aria-label={`Inspect ${node.label}`}
                                  title={`Inspect ${node.label} in the Details panel.`}
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setSelectedNodeId(node.id)
                                    onInspectNode(node)
                                  }}
                                >
                                  Inspect
                                </button>
                              </span>
                              <span className="structure-node-kind">{node.kind}</span>
                              {(node.fields ?? []).slice(0, 5).map((field) => (
                                <span key={`${node.id}-${field.name}`} className="structure-field">
                                  <span>{field.primary ? 'PK ' : ''}{field.name}</span>
                                  <code>{field.dataType}</code>
                                </span>
                              ))}
                              {(node.fields?.length ?? 0) > 5 ? (
                                <span className="structure-node-more">
                                  +{(node.fields?.length ?? 0) - 5} more field(s)
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </section>
                    )
                  },
                )}
              </div>

              <aside className="structure-details" aria-label="Selected structure details">
                {selectedNode ? (
                  <>
                    <div className="structure-details-header">
                      <StructureNodeIcon connection={activeConnection} node={selectedNode} />
                      <div>
                        <strong>{selectedNode.label}</strong>
                        <span>{selectedNode.detail ?? selectedNode.kind}</span>
                      </div>
                    </div>
                    <div className="structure-details-grid">
                      {(selectedNode.metrics ?? []).map((metric) => (
                        <div key={`${metric.label}-${metric.value}`} className="detail-row">
                          <span>{metric.label}</span>
                          <strong>{metric.value}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="details-section">
                      <strong>Fields</strong>
                      {(selectedNode.fields ?? []).length === 0 ? (
                        <p className="panel-footnote">No field metadata for this object.</p>
                      ) : (
                        <div className="structure-field-list">
                          {(selectedNode.fields ?? []).map((field) => (
                            <div key={`${selectedNode.id}-${field.name}`} className="structure-field-row">
                              <span>{field.name}</span>
                              <code>{field.dataType}</code>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="details-section">
                      <strong>Relationships</strong>
                      {(structure?.edges ?? []).filter(
                        (edge) => edge.from === selectedNode.id || edge.to === selectedNode.id,
                      ).length === 0 ? (
                        <p className="panel-footnote">No relationships found.</p>
                      ) : (
                        <ul className="messages-list">
                          {(structure?.edges ?? [])
                            .filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id)
                            .map((edge) => (
                              <li key={edge.id}>
                                {edge.label}
                                {edge.inferred ? ' (inferred)' : ''}
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="panel-footnote">Select an object to inspect fields and relationships.</p>
                )}
              </aside>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function StructureNodeIcon({
  connection,
  node,
}: {
  connection?: ConnectionProfile
  node: StructureNode
}) {
  if (
    connection &&
    ['bucket', 'database', 'dataset', 'graph', 'keyspace', 'schema'].includes(node.kind)
  ) {
    return (
      <DatastoreIcon
        className="structure-datastore-icon"
        decorative
        engine={connection.engine}
      />
    )
  }

  if (node.family === 'document') {
    return <JsonIcon className="structure-icon" />
  }

  if (node.family === 'keyvalue') {
    return <KeyValueIcon className="structure-icon" />
  }

  if (node.kind === 'table' || node.kind.includes('table')) {
    return <TableIcon className="structure-icon" />
  }

  return <DatabaseIcon className="structure-icon" />
}
