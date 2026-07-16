import { useEffect, useRef } from 'react'

import type {
  GraphModel,
  NormalizedGraphNode,
  SelectedGraphItem,
} from './GraphResultsView.model'
import { graphKindSummary, graphNodeColor } from './GraphResultsView.model'
import { FitViewIcon, ZoomInIcon, ZoomOutIcon } from '../icons'

const FORCE_LAYOUT_NODE_LIMIT = 1_500
const LABEL_NODE_LIMIT = 450

interface GraphRenderer {
  kill(): void
  refresh?(): void
  resize?(force?: boolean): void
  getCamera?(): {
    animatedZoom(options?: { duration?: number }): void
    animatedUnzoom(options?: { duration?: number }): void
    animatedReset(options?: { duration?: number }): void
  }
}

export function GraphCanvas({
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
  const rendererRef = useRef<GraphRenderer | undefined>(undefined)
  const selectedRef = useRef<SelectedGraphItem | undefined>(selected)
  const kinds = graphKindSummary(model)

  useEffect(() => {
    selectedRef.current = selected
    rendererRef.current?.refresh?.()
  }, [selected])

  useEffect(() => {
    let cancelled = false
    let renderer: GraphRenderer | undefined
    let layout: { start(): void; stop(): void; kill(): void } | undefined
    let resizeObserver: ResizeObserver | undefined
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
        model.visualNodes.forEach((node) => {
          graph.addNode(node.id, {
            label: node.label,
            size: nodeSize(node, model.degreeByNode),
            color: graphNodeColor(node.kind),
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
            size: 1.6,
            color: '#8794a6',
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
            layout = new ForceAtlas2Layout(graph, { settings: forceAtlas2.inferSettings(graph) })
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
          renderEdgeLabels: model.visualEdges.length > 0 && model.visualEdges.length <= 500,
          renderLabels: model.visualNodes.length <= 2_000,
          stagePadding: 24,
          nodeReducer: (node: string, data: Record<string, unknown>) => {
            const current = selectedRef.current
            const selectedNodeId = current?.kind === 'node' ? current.id : undefined
            const selectedEdgeId = current?.kind === 'edge' ? current.id : undefined
            if (!selectedNodeId && !selectedEdgeId) {
              return data
            }
            const selectedEdgeKey = selectedEdgeId ? visualEdgeKeys.get(selectedEdgeId) : undefined
            const related = selectedEdgeKey
              ? graph.extremities(selectedEdgeKey).includes(node)
              : selectedNodeId === node
                || Boolean(selectedNodeId && graph.hasNode(selectedNodeId) && graph.areNeighbors(selectedNodeId, node))
            return {
              ...data,
              color: related ? data.color : '#3f4650',
              forceLabel: selectedNodeId === node,
              zIndex: related ? 2 : 0,
            }
          },
          edgeReducer: (edge: string, data: Record<string, unknown>) => {
            const current = selectedRef.current
            const selectedNodeId = current?.kind === 'node' ? current.id : undefined
            const selectedEdgeId = current?.kind === 'edge' ? current.id : undefined
            const selectedEdgeKey = selectedEdgeId ? visualEdgeKeys.get(selectedEdgeId) : undefined
            if (!selectedEdgeKey && !selectedNodeId) {
              return data
            }
            const active = edge === selectedEdgeKey
              || Boolean(selectedNodeId && graph.extremities(edge).includes(selectedNodeId))
            return {
              ...data,
              color: active ? '#f0c94f' : '#414a57',
              size: active ? 2.8 : 0.9,
              zIndex: active ? 2 : 0,
            }
          },
        })
        rendererRef.current = renderer
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (cancelled) {
              return
            }
            renderer?.resize?.(true)
            renderer?.refresh?.()
          })
          resizeObserver.observe(container)
        }
        const eventRenderer = renderer as unknown as {
          on(event: string, handler: (event: { node?: string; edge?: string }) => void): void
        }
        eventRenderer.on('clickNode', (event) => {
          if (event.node) {
            onSelect({ kind: 'node', id: event.node })
          }
        })
        eventRenderer.on('clickEdge', (event) => {
          if (event.edge) {
            const edge = model.visualEdges.find((item) =>
              item.id === event.edge || event.edge?.startsWith(`${item.id}:`),
            )
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
      resizeObserver?.disconnect()
      layout?.kill()
      if (rendererRef.current === renderer) {
        rendererRef.current = undefined
      }
      renderer?.kill()
    }
  }, [model, onError, onSelect])

  const moveCamera = (operation: 'zoom-in' | 'zoom-out' | 'fit') => {
    const camera = rendererRef.current?.getCamera?.()
    if (!camera) {
      return
    }
    if (operation === 'zoom-in') {
      camera.animatedZoom({ duration: 180 })
    } else if (operation === 'zoom-out') {
      camera.animatedUnzoom({ duration: 180 })
    } else {
      camera.animatedReset({ duration: 220 })
    }
  }

  return (
    <div className="graph-result-canvas-shell">
      <div ref={containerRef} className="graph-result-canvas" aria-label="Graph visualization" />
      <div className="graph-result-canvas-controls" aria-label="Graph zoom controls">
        <button type="button" aria-label="Zoom graph in" title="Zoom in" onClick={() => moveCamera('zoom-in')}>
          <ZoomInIcon className="panel-inline-icon" />
        </button>
        <button type="button" aria-label="Zoom graph out" title="Zoom out" onClick={() => moveCamera('zoom-out')}>
          <ZoomOutIcon className="panel-inline-icon" />
        </button>
        <button type="button" aria-label="Fit graph to view" title="Fit graph to view" onClick={() => moveCamera('fit')}>
          <FitViewIcon className="panel-inline-icon" />
        </button>
      </div>
      {kinds.length ? (
        <div className="graph-result-legend" aria-label="Node type legend">
          {kinds.slice(0, 6).map((entry) => (
            <span key={entry.kind} title={`${entry.count.toLocaleString()} node(s)`}>
              <i style={{ backgroundColor: entry.color }} />
              {entry.kind}
            </span>
          ))}
          {kinds.length > 6 ? <strong>+{kinds.length - 6}</strong> : null}
        </div>
      ) : null}
    </div>
  )
}

function assignDeterministicLayout(
  graph: { setNodeAttribute(node: string, attribute: string, value: number): void },
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
  return Math.min(14, 4 + Math.sqrt(degreeByNode.get(node.id) ?? 0))
}
