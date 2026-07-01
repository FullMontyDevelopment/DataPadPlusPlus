import { useDeferredValue, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  StructureRequest,
  StructureNode,
  StructureResponse,
} from '@datapadplusplus/shared-types'
import { environmentAccentVariables } from './SideBar.helpers'
import {
  buildSqlRelationshipModel,
  type SqlExplorerNode,
} from './SqlRelationshipExplorer.model'
import { serializeRelationshipSvg } from './SqlRelationshipGraphExport'
import { SqlRelationshipGraphCanvas } from './SqlRelationshipGraphCanvas'
import { SqlRelationshipInspector } from './SqlRelationshipInspector'
import {
  DownloadIcon,
  ExplorerIcon,
  HideIcon,
  ObjectRelationshipIcon,
  PanelIcon,
  RefreshIcon,
  SearchIcon,
  ShowIcon,
} from './icons'

interface SqlRelationshipExplorerWorkspaceProps {
  activeConnection: ConnectionProfile
  activeEnvironment?: EnvironmentProfile
  status: 'idle' | 'loading' | 'ready'
  structure?: StructureResponse
  error?: string
  onRefresh(options?: Partial<StructureRequest>): void
  onInspectNode(node: StructureNode): void
  onOpenQuery(node: SqlExplorerNode, queryText: string): void
  onOpenObjectView(node: ExplorerNode): void
}

const MAX_GRAPH_NODES = 80

export function SqlRelationshipExplorerWorkspace({
  activeConnection,
  activeEnvironment,
  status,
  structure,
  error,
  onRefresh,
  onInspectNode,
  onOpenQuery,
  onOpenObjectView,
}: SqlRelationshipExplorerWorkspaceProps) {
  const [filter, setFilter] = useState('')
  const [schemaFilter, setSchemaFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [includeSystemObjects, setIncludeSystemObjects] = useState(false)
  const [inferredRelationshipMode, setInferredRelationshipMode] = useState<'auto' | 'on' | 'off'>('auto')
  const [depth, setDepth] = useState(1)
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>()
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const deferredFilter = useDeferredValue(filter)
  const environmentStyle = environmentAccentVariables(activeEnvironment)
  const catalogRef = useRef<HTMLDivElement>(null)
  const declaredRelationshipCount = structure?.edges?.filter((edge) => !edge.inferred).length ?? 0
  const includeInferredRelationships =
    inferredRelationshipMode === 'on' || (inferredRelationshipMode === 'auto' && declaredRelationshipCount === 0)
  const model = useMemo(
    () => buildSqlRelationshipModel(structure, includeInferredRelationships),
    [includeInferredRelationships, structure],
  )
  const filteredNodes = useMemo(() => {
    const needle = deferredFilter.trim().toLowerCase()
    return model.nodes.filter((node) => {
      if (!includeSystemObjects && node.isSystem) return false
      if (schemaFilter !== 'all' && node.schema !== schemaFilter) return false
      if (kindFilter !== 'all' && node.objectKind !== kindFilter) return false
      return !needle || node.searchText.includes(needle)
    })
  }, [deferredFilter, includeSystemObjects, kindFilter, model.nodes, schemaFilter])
  const focusedNodes = useMemo(
    () => orderFocusedNodes(filteredNodes, model.edges, selectedNodeId, depth),
    [depth, filteredNodes, model.edges, selectedNodeId],
  )
  const graphNodes = focusedNodes.slice(0, MAX_GRAPH_NODES)
  const graphIds = new Set(graphNodes.map((node) => node.node.id))
  const graphEdges = model.edges.filter((edge) => graphIds.has(edge.from) && graphIds.has(edge.to))
  const selectedNode = selectedNodeId ? model.nodeById.get(selectedNodeId) : undefined
  const showInspector = Boolean(selectedNode && !inspectorCollapsed)
  // eslint-disable-next-line react-hooks/incompatible-library
  const catalogVirtualizer = useVirtualizer({
    count: filteredNodes.length,
    getScrollElement: () => catalogRef.current,
    estimateSize: () => 46,
    overscan: 8,
    initialRect: { width: 240, height: 480 },
  })
  const virtualCatalogRows = catalogVirtualizer.getVirtualItems()
  const catalogRows =
    virtualCatalogRows.length > 0
      ? virtualCatalogRows.map((row) => ({ index: row.index, start: row.start }))
      : filteredNodes.slice(0, 100).map((_, index) => ({ index, start: index * 46 }))

  const refreshStructure = () => {
    onRefresh({
      includeSystemObjects,
      includeInferredRelationships,
      maxNodes: 320,
      maxEdges: 1000,
      depth,
      mode: 'relationships',
    })
  }

  const selectNode = (nodeId: string | undefined) => {
    setSelectedNodeId(nodeId)
    if (nodeId) {
      setInspectorCollapsed(false)
    }
  }

  return (
    <section
      className={`structure-workspace sql-rel-workspace${activeEnvironment ? ' has-environment-accent' : ''}`}
      style={environmentStyle as CSSProperties}
      aria-label="Visual database structure"
    >
      <header className="structure-header sql-rel-header">
        <div>
          <p className="sidebar-eyebrow">Relationships</p>
          <h1>{activeConnection.name}</h1>
          <p>{activeConnection.engine}{activeEnvironment ? ` / ${activeEnvironment.label}` : ''}</p>
        </div>
        <div className="structure-actions">
          <button
            type="button"
            className="toolbar-action"
            disabled={status === 'loading'}
            title="Refresh relationship metadata"
            onClick={refreshStructure}
          >
            <RefreshIcon className="toolbar-icon" />
          </button>
          <button
            type="button"
            className="toolbar-action"
            disabled={!structure}
            title="Export relationship JSON"
            onClick={() => downloadTextFile(`${activeConnection.name}-relationships.json`, JSON.stringify(structure, null, 2), 'application/json')}
          >
            <DownloadIcon className="toolbar-icon" />
            JSON
          </button>
          <button
            type="button"
            className="toolbar-action"
            disabled={graphNodes.length === 0}
            title="Export diagram SVG"
            onClick={() => downloadTextFile(`${activeConnection.name}-relationships.svg`, serializeRelationshipSvg(graphNodes, graphEdges), 'image/svg+xml')}
          >
            <DownloadIcon className="toolbar-icon" />
            SVG
          </button>
        </div>
      </header>

      {error ? (
        <div className="structure-empty structure-empty--error" data-tour-id="explorer-metadata">
          <ExplorerIcon className="empty-icon" />
          <h2>Structure unavailable</h2>
          <p>{error}</p>
        </div>
      ) : (
        <div className="sql-rel-body">
          <div className="sql-rel-toolbar">
            <label className="structure-search">
              <SearchIcon className="toolbar-icon" />
              <span className="sr-only">Search tables and columns</span>
              <input
                type="search"
                placeholder="Search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            <select value={schemaFilter} title="Schema" onChange={(event) => setSchemaFilter(event.target.value)}>
              <option value="all">All schemas</option>
              {model.schemas.map((schema) => (
                <option key={schema} value={schema}>{schema}</option>
              ))}
            </select>
            <select value={kindFilter} title="Object type" onChange={(event) => setKindFilter(event.target.value)}>
              <option value="all">All objects</option>
              {model.objectKinds.map((kind) => (
                <option key={kind} value={kind}>{kind}</option>
              ))}
            </select>
            <button
              type="button"
              className={`toolbar-action${includeSystemObjects ? ' is-active' : ''}`}
              title={includeSystemObjects ? 'Hide system objects' : 'Show system objects'}
              onClick={() => setIncludeSystemObjects((value) => !value)}
            >
              {includeSystemObjects ? <ShowIcon className="toolbar-icon" /> : <HideIcon className="toolbar-icon" />}
            </button>
            <button
              type="button"
              className={`toolbar-action${includeInferredRelationships ? ' is-active' : ''}`}
              title={includeInferredRelationships ? 'Hide inferred relationships' : 'Show inferred relationships'}
              onClick={() => setInferredRelationshipMode(includeInferredRelationships ? 'off' : 'on')}
            >
              <ObjectRelationshipIcon className="toolbar-icon" />
            </button>
            {selectedNode ? (
              <button
                type="button"
                className={`toolbar-action${showInspector ? ' is-active' : ''}`}
                title={showInspector ? 'Hide details' : 'Show details'}
                aria-label={showInspector ? 'Hide relationship details' : 'Show relationship details'}
                onClick={() => setInspectorCollapsed((value) => !value)}
              >
                <PanelIcon className="toolbar-icon" />
              </button>
            ) : null}
            <select value={depth} title="Relationship depth" onChange={(event) => setDepth(Number(event.target.value))}>
              <option value={0}>Focus</option>
              <option value={1}>1 hop</option>
              <option value={2}>2 hops</option>
              <option value={3}>3 hops</option>
            </select>
            <div className="structure-metrics">
              <span>{filteredNodes.length} object(s)</span>
              <span>{model.edges.length} link(s)</span>
              {structure?.truncated ? <span>Truncated</span> : null}
            </div>
          </div>

          {status === 'loading' ? (
            <div className="structure-empty" data-tour-id="explorer-metadata">
              <ExplorerIcon className="empty-icon" />
              <h2>Loading relationships...</h2>
            </div>
          ) : filteredNodes.length === 0 ? (
            <div className="structure-empty" data-tour-id="explorer-metadata">
              <ExplorerIcon className="empty-icon" />
              <h2>No structure objects found</h2>
            </div>
          ) : (
            <div
              className={`sql-rel-layout${showInspector ? ' has-inspector' : ''}`}
              data-tour-id="explorer-metadata"
            >
              <aside className="sql-rel-catalog" aria-label="Table catalog">
                <div className="sql-rel-catalog-header">
                  <strong>Catalog</strong>
                  <span>{filteredNodes.length}</span>
                </div>
                <div ref={catalogRef} className="sql-rel-catalog-list">
                  <div style={{ height: catalogVirtualizer.getTotalSize(), position: 'relative' }}>
                    {catalogRows.map((virtualRow) => {
                      const node = filteredNodes[virtualRow.index]
                      if (!node) {
                        return null
                      }

                      return (
                        <button
                          key={node.node.id}
                          type="button"
                          className={`sql-rel-catalog-row${selectedNodeId === node.node.id ? ' is-active' : ''}`}
                          style={{
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                          onClick={() => selectNode(selectedNodeId === node.node.id ? undefined : node.node.id)}
                        >
                          <span>{node.objectName}</span>
                          <code>{node.schema}</code>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </aside>
              <main className="sql-rel-main">
                {focusedNodes.length > MAX_GRAPH_NODES ? (
                  <div className="sql-rel-cap">
                    Showing {MAX_GRAPH_NODES} of {focusedNodes.length}. Select a table or narrow the filter.
                  </div>
                ) : null}
                <SqlRelationshipGraphCanvas
                  nodes={graphNodes}
                  edges={graphEdges}
                  selectedNodeId={selectedNode?.node.id}
                  onSelectNode={selectNode}
                />
              </main>
              {showInspector && selectedNode ? (
                <SqlRelationshipInspector
                  connection={activeConnection}
                  model={model}
                  selectedNode={selectedNode}
                  onCollapse={() => setInspectorCollapsed(true)}
                  onInspectNode={onInspectNode}
                  onOpenQuery={onOpenQuery}
                  onOpenObjectView={onOpenObjectView}
                />
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function orderFocusedNodes(
  nodes: SqlExplorerNode[],
  edges: StructureResponse['edges'],
  selectedNodeId: string | undefined,
  depth: number,
) {
  if (!selectedNodeId || depth < 0) {
    return nodes
  }

  const nodeIds = new Set(nodes.map((node) => node.node.id))
  const visibleIds = new Set([selectedNodeId])
  let frontier = new Set([selectedNodeId])

  for (let index = 0; index < depth; index += 1) {
    const next = new Set<string>()
    for (const edge of edges) {
      if (frontier.has(edge.from) && nodeIds.has(edge.to)) next.add(edge.to)
      if (frontier.has(edge.to) && nodeIds.has(edge.from)) next.add(edge.from)
    }
    for (const id of next) visibleIds.add(id)
    frontier = next
  }

  const focusedNodes = nodes.filter((node) => visibleIds.has(node.node.id))
  const otherNodes = nodes.filter((node) => !visibleIds.has(node.node.id))
  return [...focusedNodes, ...otherNodes]
}

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
