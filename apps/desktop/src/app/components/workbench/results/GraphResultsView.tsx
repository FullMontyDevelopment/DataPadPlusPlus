import type { ResultPayload } from '@datapadplusplus/shared-types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { JsonTreeView } from './JsonTreeView'

type GraphPayload = Extract<ResultPayload, { renderer: 'graph' }>

interface NormalizedGraphNode {
  id: string
  label: string
  kind: string
  properties: Record<string, unknown>
  raw: unknown
}

interface NormalizedGraphEdge {
  id: string
  from: string
  to: string
  label: string
  kind: string
  properties: Record<string, unknown>
  raw: unknown
}

interface GraphModel {
  nodes: NormalizedGraphNode[]
  edges: NormalizedGraphEdge[]
  visualNodes: NormalizedGraphNode[]
  visualEdges: NormalizedGraphEdge[]
  nodeById: Map<string, NormalizedGraphNode>
  edgeById: Map<string, NormalizedGraphEdge>
  degreeByNode: Map<string, number>
  capped: boolean
  warnings: string[]
}

type SelectedGraphItem =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }

const DEFAULT_VISUAL_NODE_CAP = 10_000
const DEFAULT_VISUAL_EDGE_CAP = 25_000
const FORCE_LAYOUT_NODE_LIMIT = 1_500
const LABEL_NODE_LIMIT = 450
const GRAPH_OBJECT_ROW_HEIGHT = 38

export function GraphResultsView({ payload }: { payload: GraphPayload }) {
  const [mode, setMode] = useState<'graph' | 'objects'>('graph')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<SelectedGraphItem>()
  const [canvasError, setCanvasError] = useState('')
  const model = useMemo(() => buildGraphModel(payload), [payload])
  const selectedValue = selected ? graphItemValue(model, selected) : undefined
  const hasVisualGraph = model.visualNodes.length > 0

  useEffect(() => {
    setSelected((current) => {
      if (current && graphItemValue(model, current)) {
        return current
      }
      const firstNode = model.visualNodes[0] ?? model.nodes[0]
      if (firstNode) {
        return { kind: 'node', id: firstNode.id }
      }
      const firstEdge = model.visualEdges[0] ?? model.edges[0]
      return firstEdge ? { kind: 'edge', id: firstEdge.id } : undefined
    })
  }, [model])

  return (
    <div className="graph-result-view">
      <header className="graph-result-toolbar">
        <div className="graph-result-mode-toggle" role="tablist" aria-label="Graph result view">
          <button
            type="button"
            role="tab"
            className={mode === 'graph' ? 'is-active' : undefined}
            aria-selected={mode === 'graph'}
            onClick={() => setMode('graph')}
          >
            Graph
          </button>
          <button
            type="button"
            role="tab"
            className={mode === 'objects' ? 'is-active' : undefined}
            aria-selected={mode === 'objects'}
            onClick={() => setMode('objects')}
          >
            Objects
          </button>
        </div>
        <div className="graph-result-stats" aria-label="Graph result counts">
          <span>{formatNumber(payload.nodeCount ?? model.nodes.length)} nodes</span>
          <span>{formatNumber(payload.edgeCount ?? model.edges.length)} edges</span>
          {model.capped || payload.truncated ? <strong>sample capped</strong> : null}
        </div>
      </header>

      {model.warnings.length > 0 ? (
        <div className="graph-result-warnings">
          {model.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}

      <div className="graph-result-body">
        <main className="graph-result-main">
          {mode === 'graph' ? (
            hasVisualGraph ? (
              <GraphCanvas
                model={model}
                selected={selected}
                onSelect={setSelected}
                onError={setCanvasError}
              />
            ) : (
              <GraphEmptyState />
            )
          ) : (
            <GraphObjectsView
              filter={filter}
              model={model}
              selected={selected}
              onFilterChange={setFilter}
              onSelect={setSelected}
            />
          )}
          {mode === 'graph' && canvasError ? (
            <p className="graph-result-fallback">{canvasError}</p>
          ) : null}
        </main>
        <aside className="graph-result-detail" aria-label="Graph result detail">
          {selectedValue ? (
            <>
              <header>
                <span>{selected?.kind === 'edge' ? 'Edge' : 'Node'}</span>
                <strong>{selectedValue.label}</strong>
              </header>
              <JsonTreeView value={selectedValue} label={selected?.kind ?? 'item'} />
            </>
          ) : (
            <p className="panel-footnote">No graph object selected.</p>
          )}
        </aside>
      </div>
    </div>
  )
}

function GraphCanvas({
  model,
  selected,
  onSelect,
  onError,
}: {
  model: GraphModel
  selected?: SelectedGraphItem
  onSelect(item: SelectedGraphItem | undefined): void
  onError(message: string): void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<{ kill(): void; refresh?(): void } | undefined>(undefined)
  const selectedRef = useRef<SelectedGraphItem | undefined>(selected)

  useEffect(() => {
    selectedRef.current = selected
    rendererRef.current?.refresh?.()
  }, [selected])

  useEffect(() => {
    let cancelled = false
    let renderer: { kill(): void; refresh?(): void } | undefined
    let layout: { start(): void; stop(): void; kill(): void } | undefined
    let stopTimer: number | undefined

    async function mountGraph() {
      const container = containerRef.current
      if (!container) {
        return
      }

      try {
        const [{ default: Sigma }, { default: Graph }, graphologyLayout] = await Promise.all([
          import('sigma'),
          import('graphology'),
          import('graphology-layout'),
        ])
        if (cancelled) {
          return
        }

        const graph = new Graph({ multi: true, type: 'directed' })
        const visualEdgeKeys = new Map<string, string>()

        model.visualNodes.forEach((node, index) => {
          graph.addNode(node.id, {
            label: node.label,
            size: nodeSize(node, model.degreeByNode),
            color: nodeColor(node.kind, index),
            x: 0,
            y: 0,
          })
        })
        model.visualEdges.forEach((edge, index) => {
          if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) {
            return
          }
          const key = graph.hasEdge(edge.id) ? `${edge.id}:${index}` : edge.id
          visualEdgeKeys.set(edge.id, key)
          graph.addDirectedEdgeWithKey(key, edge.from, edge.to, {
            label: edge.label,
            size: 1.2,
            color: '#77808f',
          })
        })

        if (model.visualNodes.length <= FORCE_LAYOUT_NODE_LIMIT) {
          graphologyLayout.circular.assign(graph, { scale: 100 })
        } else {
          assignDeterministicLayout(graph, model.visualNodes)
        }

        if (typeof Worker !== 'undefined' && model.visualNodes.length <= FORCE_LAYOUT_NODE_LIMIT) {
          const [{ default: forceAtlas2 }, { default: ForceAtlas2Layout }] = await Promise.all([
            import('graphology-layout-forceatlas2'),
            import('graphology-layout-forceatlas2/worker'),
          ])
          if (!cancelled) {
            layout = new ForceAtlas2Layout(graph, {
              settings: forceAtlas2.inferSettings(graph),
            })
            layout.start()
            stopTimer = window.setTimeout(() => layout?.stop(), 1_500)
          }
        }

        renderer = new Sigma(graph, container, {
          allowInvalidContainer: true,
          defaultNodeColor: '#7dd3fc',
          defaultEdgeColor: '#77808f',
          enableEdgeEvents: true,
          hideEdgesOnMove: model.visualEdges.length > 6_000,
          hideLabelsOnMove: true,
          labelColor: { color: '#e5edf7' },
          labelDensity: 0.08,
          labelRenderedSizeThreshold: model.visualNodes.length <= LABEL_NODE_LIMIT ? 6 : 14,
          renderLabels: model.visualNodes.length <= 2_000,
          stagePadding: 24,
          nodeReducer: (node: string, data: Record<string, unknown>) => {
            const selected = selectedRef.current
            const selectedNodeId = selected?.kind === 'node' ? selected.id : undefined
            const selectedEdgeId = selected?.kind === 'edge' ? selected.id : undefined
            if (!selectedNodeId && !selectedEdgeId) {
              return data
            }
            const selectedEdgeKey = selectedEdgeId ? visualEdgeKeys.get(selectedEdgeId) : undefined
            const related = selectedEdgeKey
              ? graph.extremities(selectedEdgeKey).includes(node)
              : selectedNodeId === node ||
                Boolean(
                  selectedNodeId &&
                    graph.hasNode(selectedNodeId) &&
                    graph.areNeighbors(selectedNodeId, node),
                )
            return {
              ...data,
              color: related ? data.color : '#3f4650',
              forceLabel: selectedNodeId === node,
              zIndex: related ? 2 : 0,
            }
          },
          edgeReducer: (edge: string, data: Record<string, unknown>) => {
            const selected = selectedRef.current
            const selectedEdgeId = selected?.kind === 'edge' ? selected.id : undefined
            const selectedEdgeKey = selectedEdgeId ? visualEdgeKeys.get(selectedEdgeId) : undefined
            if (!selectedEdgeKey) {
              return data
            }
            const active = edge === selectedEdgeKey
            return {
              ...data,
              color: active ? '#f5c542' : '#4d5561',
              size: active ? 3 : 1,
              zIndex: active ? 2 : 0,
            }
          },
        })
        rendererRef.current = renderer
        ;(renderer as unknown as { on(event: string, handler: (event: { node?: string; edge?: string }) => void): void })
          .on('clickNode', (event) => {
            if (event.node) {
              onSelect({ kind: 'node', id: event.node })
            }
          })
        ;(renderer as unknown as { on(event: string, handler: (event: { node?: string; edge?: string }) => void): void })
          .on('clickEdge', (event) => {
            if (event.edge) {
              const edge = model.visualEdges.find((item) => item.id === event.edge || event.edge?.startsWith(`${item.id}:`))
              if (edge) {
                onSelect({ kind: 'edge', id: edge.id })
              }
            }
          })
        onError('')
      } catch (error) {
        onError(`Graph canvas unavailable. Objects view is still available. ${String(error)}`)
      }
    }

    void mountGraph()

    return () => {
      cancelled = true
      if (stopTimer !== undefined) {
        window.clearTimeout(stopTimer)
      }
      layout?.kill()
      if (rendererRef.current === renderer) {
        rendererRef.current = undefined
      }
      renderer?.kill()
    }
  }, [model, onError, onSelect])

  return <div ref={containerRef} className="graph-result-canvas" aria-label="Graph visualization" />
}

function GraphObjectsView({
  filter,
  model,
  selected,
  onFilterChange,
  onSelect,
}: {
  filter: string
  model: GraphModel
  selected?: SelectedGraphItem
  onFilterChange(value: string): void
  onSelect(item: SelectedGraphItem): void
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => graphObjectRows(model, filter), [filter, model])
  // TanStack Virtual keeps large graph object lists responsive without mounting every row.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => GRAPH_OBJECT_ROW_HEIGHT,
    overscan: 24,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const renderedRows =
    virtualItems.length > 0
      ? virtualItems.map((item) => ({ key: item.key, index: item.index, start: item.start }))
      : rows.map((_row, index) => ({ key: index, index, start: index * GRAPH_OBJECT_ROW_HEIGHT }))

  return (
    <section className="graph-result-objects">
      <div className="graph-result-object-filter">
        <input
          aria-label="Filter graph objects"
          placeholder="Filter"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        />
      </div>
      <div ref={parentRef} className="graph-result-object-list" role="listbox" aria-label="Graph objects">
        <div className="graph-result-object-virtual-space" style={{ height: virtualizer.getTotalSize() }}>
          {renderedRows.map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) {
              return null
            }
            const active = selected?.kind === row.kind && selected.id === row.id
            return (
              <button
                key={virtualRow.key}
                type="button"
                className={`graph-result-object-row${active ? ' is-active' : ''}`}
                role="option"
                aria-selected={active}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
                onClick={() => onSelect({ kind: row.kind, id: row.id })}
              >
                <span>{row.kind}</span>
                <strong>{row.label}</strong>
                <small>{row.detail}</small>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function GraphEmptyState() {
  return (
    <div className="graph-result-empty">
      <strong>No visual graph objects</strong>
      <span>Open Objects or JSON for the returned payload.</span>
    </div>
  )
}

function buildGraphModel(payload: GraphPayload): GraphModel {
  const nodes = arrayValue(payload.nodes).map(normalizeNode).filter(isPresent)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges = arrayValue(payload.edges).map(normalizeEdge).filter(isPresent)
  const visualNodeCap = finiteNumber(payload.visualNodeCap) ?? DEFAULT_VISUAL_NODE_CAP
  const visualEdgeCap = finiteNumber(payload.visualEdgeCap) ?? DEFAULT_VISUAL_EDGE_CAP
  const visualNodes = nodes.slice(0, Math.min(visualNodeCap, DEFAULT_VISUAL_NODE_CAP))
  const visualNodeIds = new Set(visualNodes.map((node) => node.id))
  const visualEdges = edges
    .filter((edge) => visualNodeIds.has(edge.from) && visualNodeIds.has(edge.to))
    .slice(0, Math.min(visualEdgeCap, DEFAULT_VISUAL_EDGE_CAP))
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
  const degreeByNode = new Map<string, number>()
  visualEdges.forEach((edge) => {
    degreeByNode.set(edge.from, (degreeByNode.get(edge.from) ?? 0) + 1)
    degreeByNode.set(edge.to, (degreeByNode.get(edge.to) ?? 0) + 1)
  })
  const warnings = stringArray(payload.warnings)
  const capped =
    nodes.length > visualNodes.length ||
    edges.length > visualEdges.length ||
    Boolean(payload.truncated)

  return {
    nodes,
    edges,
    visualNodes,
    visualEdges,
    nodeById,
    edgeById,
    degreeByNode,
    capped,
    warnings,
  }
}

function normalizeNode(value: unknown, index: number): NormalizedGraphNode | undefined {
  const record = recordValue(value)
  const rawRecord = recordValue(record.raw)
  const id = stringValue(record.id) ?? stringValue(rawRecord.id) ?? `node-${index}`
  const kind = stringValue(record.kind)
    ?? firstString(record.labels)
    ?? stringValue(rawRecord.kind)
    ?? firstString(rawRecord.labels)
    ?? stringValue(rawRecord.label)
    ?? 'node'
  const properties = recordValue(record.properties)
  const rawProperties = recordValue(rawRecord.properties)
  const label = stringValue(record.label)
    ?? stringValue(properties.name)
    ?? stringValue(rawProperties.name)
    ?? kind
    ?? id

  return {
    id,
    label,
    kind,
    properties,
    raw: record.raw ?? value,
  }
}

function normalizeEdge(value: unknown, index: number): NormalizedGraphEdge | undefined {
  const record = recordValue(value)
  const rawRecord = recordValue(record.raw)
  const id = stringValue(record.id) ?? stringValue(rawRecord.id) ?? `edge-${index}`
  const from = stringValue(record.from)
    ?? stringValue(rawRecord.from)
    ?? stringValue(rawRecord.startNode)
    ?? stringValue(rawRecord.outV)
    ?? stringValue(rawRecord._from)
    ?? ''
  const to = stringValue(record.to)
    ?? stringValue(rawRecord.to)
    ?? stringValue(rawRecord.endNode)
    ?? stringValue(rawRecord.inV)
    ?? stringValue(rawRecord._to)
    ?? ''
  const label = stringValue(record.label)
    ?? stringValue(record.kind)
    ?? stringValue(rawRecord.type)
    ?? stringValue(rawRecord.label)
    ?? 'edge'
  const kind = stringValue(record.kind) ?? label

  if (!from || !to) {
    return undefined
  }

  return {
    id,
    from,
    to,
    label,
    kind,
    properties: recordValue(record.properties),
    raw: record.raw ?? value,
  }
}

function graphItemValue(model: GraphModel, selected: SelectedGraphItem) {
  if (selected.kind === 'node') {
    const node = model.nodeById.get(selected.id)
    return node
      ? {
          id: node.id,
          label: node.label,
          kind: node.kind,
          properties: node.properties,
          raw: node.raw,
        }
      : undefined
  }
  const edge = model.edgeById.get(selected.id)
  return edge
    ? {
        id: edge.id,
        label: edge.label,
        kind: edge.kind,
        from: edge.from,
        to: edge.to,
        properties: edge.properties,
        raw: edge.raw,
      }
    : undefined
}

function graphObjectRows(model: GraphModel, filter: string) {
  const needle = filter.trim().toLocaleLowerCase()
  const nodeRows = model.nodes.map((node) => ({
    kind: 'node' as const,
    id: node.id,
    label: node.label,
    detail: `${node.kind} / ${node.id}`,
  }))
  const edgeRows = model.edges.map((edge) => ({
    kind: 'edge' as const,
    id: edge.id,
    label: edge.label,
    detail: `${edge.from} -> ${edge.to}`,
  }))
  const rows = [...nodeRows, ...edgeRows]

  if (!needle) {
    return rows
  }

  return rows.filter((row) =>
    `${row.kind} ${row.id} ${row.label} ${row.detail}`.toLocaleLowerCase().includes(needle),
  )
}

function assignDeterministicLayout(
  graph: {
    setNodeAttribute(node: string, attribute: string, value: number): void
  },
  nodes: NormalizedGraphNode[],
) {
  const columns = Math.ceil(Math.sqrt(nodes.length))
  const spacing = 8
  nodes.forEach((node, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    graph.setNodeAttribute(node.id, 'x', (column - columns / 2) * spacing)
    graph.setNodeAttribute(node.id, 'y', row * spacing)
  })
}

function nodeSize(node: NormalizedGraphNode, degreeByNode: Map<string, number>) {
  const degree = degreeByNode.get(node.id) ?? 0
  return Math.min(14, 4 + Math.sqrt(degree))
}

function nodeColor(kind: string, index: number) {
  const palette = ['#7dd3fc', '#a7f3d0', '#f9a8d4', '#fde68a', '#c4b5fd', '#fca5a5']
  const hash = Array.from(kind).reduce((total, character) => total + character.charCodeAt(0), index)
  return palette[Math.abs(hash) % palette.length]
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return undefined
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === 'string') : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}
