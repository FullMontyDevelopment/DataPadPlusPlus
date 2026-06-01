import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react'
import type { StructureEdge } from '@datapadplusplus/shared-types'
import type { SqlExplorerNode } from './SqlRelationshipExplorer.model'
import { edgeLabel } from './SqlRelationshipExplorer.model'
import {
  FIELD_HEIGHT,
  NODE_HEADER_HEIGHT,
  buildGraphLayout,
  relationshipCardinality,
  relationshipEndLabel,
  relationshipEnds,
  relationshipGeometry,
  toggleExpandedNode,
  type GraphNode,
  type RelationshipEnd,
} from './SqlRelationshipGraph.layout'

interface SqlRelationshipGraphCanvasProps {
  nodes: SqlExplorerNode[]
  edges: StructureEdge[]
  selectedNodeId?: string
  onSelectNode(nodeId: string | undefined): void
}

export function SqlRelationshipGraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
}: SqlRelationshipGraphCanvasProps) {
  const [viewport, setViewport] = useState({ x: 32, y: 32, scale: 1 })
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set())
  const [showOverview, setShowOverview] = useState(false)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; viewX: number; viewY: number } | undefined>(
    undefined,
  )
  const layout = useMemo(() => buildGraphLayout(nodes, edges, expandedNodeIds), [edges, expandedNodeIds, nodes])
  const selectedNeighbors = useMemo(() => {
    if (!selectedNodeId) {
      return new Set<string>()
    }

    return new Set(
      edges.flatMap((edge) => {
        if (edge.from === selectedNodeId) return [edge.to]
        if (edge.to === selectedNodeId) return [edge.from]
        return []
      }),
    )
  }, [edges, selectedNodeId])
  const hasSelection = Boolean(selectedNodeId)

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('[data-graph-node]')) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      viewX: viewport.x,
      viewY: viewport.y,
    }
  }

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    setViewport((current) => ({
      ...current,
      x: drag.viewX + event.clientX - drag.x,
      y: drag.viewY + event.clientY - drag.y,
    }))
  }

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = undefined
    }
  }

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const nextScale = Math.min(1.8, Math.max(0.45, viewport.scale + (event.deltaY > 0 ? -0.08 : 0.08)))
    setViewport((current) => ({ ...current, scale: nextScale }))
  }

  const fitToView = () => {
    setViewport({ x: 32, y: 32, scale: layout.nodes.length > 18 ? 0.72 : 1 })
  }

  return (
    <div className="sql-rel-graph-shell">
      <div className="sql-rel-graph-actions">
        <button type="button" className="icon-button" title="Fit diagram" onClick={fitToView}>
          Fit
        </button>
        <button
          type="button"
          className={`icon-button${showOverview ? ' is-active' : ''}`}
          title={showOverview ? 'Hide overview' : 'Show overview'}
          onClick={() => setShowOverview((value) => !value)}
        >
          Map
        </button>
      </div>
      <svg
        className="sql-rel-graph"
        role="img"
        aria-label="SQL table relationship diagram"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onSelectNode(undefined)
          }
        }}
      >
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          {layout.groups.map((group) => (
            <g key={group.id}>
              <text className="sql-rel-group-label" x={group.x} y={group.y - 18}>
                {group.label}
              </text>
            </g>
          ))}
          {layout.edges.map((edge) => {
            const from = layout.nodeById.get(edge.from)
            const to = layout.nodeById.get(edge.to)

            if (!from || !to) {
              return null
            }

            const selected = edge.from === selectedNodeId || edge.to === selectedNodeId
            const dimmed = hasSelection && !selected
            const geometry = relationshipGeometry(edge, from, to)
            const cardinality = relationshipCardinality(edge)
            const ends = relationshipEnds(edge)
            const label = `${edgeLabel(edge)} | ${cardinality}`
            const labelWidth = Math.min(220, Math.max(96, label.length * 6.2 + 18))

            return (
              <g key={edge.id} className={edge.inferred ? 'is-inferred' : undefined}>
                <path
                  className={`sql-rel-edge${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`}
                  d={geometry.path}
                />
                <RelationshipEndBadge end={ends.from} point={geometry.fromBadgePoint} />
                <RelationshipEndBadge end={ends.to} point={geometry.toBadgePoint} />
                {selected ? (
                  <g className="sql-rel-edge-label-pill" transform={`translate(${geometry.labelPoint.x - labelWidth / 2} ${geometry.labelPoint.y - 11})`}>
                    <rect width={labelWidth} height="22" rx="4" />
                    <text x="9" y="15">{label}</text>
                  </g>
                ) : null}
              </g>
            )
          })}
          {layout.nodes.map((node) => {
            const selected = node.item.node.id === selectedNodeId
            const related = selectedNeighbors.has(node.item.node.id)
            const dimmed = hasSelection && !selected && !related

            return (
              <g
                key={node.item.node.id}
                data-graph-node
                className={`sql-rel-node${selected ? ' is-selected' : ''}${related ? ' is-related' : ''}${dimmed ? ' is-dimmed' : ''}`}
                transform={`translate(${node.x} ${node.y})`}
                tabIndex={0}
                role="button"
                aria-label={`Select ${node.item.qualifiedName}`}
                onClick={() => onSelectNode(selected ? undefined : node.item.node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectNode(selected ? undefined : node.item.node.id)
                  }
                }}
              >
                <rect className="sql-rel-node-card" width={node.width} height={node.height} rx="7" />
                <rect className="sql-rel-node-accent" width="4" height={node.height} rx="2" />
                <text className="sql-rel-node-title" x="16" y="24">
                  {node.item.objectName}
                </text>
                <text className="sql-rel-node-kind" x="16" y="38">
                  {node.item.schema} / {node.item.objectKind}
                </text>
                <line className="sql-rel-node-divider" x1="0" y1={NODE_HEADER_HEIGHT + 4} x2={node.width} y2={NODE_HEADER_HEIGHT + 4} />
                <line
                  className="sql-rel-node-column-divider"
                  x1="122"
                  y1={NODE_HEADER_HEIGHT + 4}
                  x2="122"
                  y2={NODE_HEADER_HEIGHT + node.visibleFields.length * FIELD_HEIGHT + 8}
                />
                {node.visibleFields.map((field, index) => (
                  <g
                    key={`${node.item.node.id}-${field.name}`}
                    transform={`translate(16 ${NODE_HEADER_HEIGHT + 18 + index * FIELD_HEIGHT})`}
                  >
                    <line className="sql-rel-node-row-line" x1="-16" y1="-13" x2={node.width - 16} y2="-13" />
                    <text className={field.primary ? 'sql-rel-field is-primary' : 'sql-rel-field'}>
                      {field.primary ? '* ' : ''}
                      {field.name}
                    </text>
                    <text className="sql-rel-field-type" x="122">
                      {field.dataType}
                    </text>
                  </g>
                ))}
                {node.hiddenFieldCount > 0 ? (
                  <MoreColumnsButton
                    node={node}
                    onToggle={(event) => {
                      event.stopPropagation()
                      setExpandedNodeIds((current) => toggleExpandedNode(current, node.item.node.id))
                    }}
                  />
                ) : null}
              </g>
            )
          })}
        </g>
      </svg>
      {showOverview ? <MiniMap layout={layout} selectedNodeId={selectedNodeId} /> : null}
    </div>
  )
}

function MoreColumnsButton({
  node,
  onToggle,
}: {
  node: GraphNode
  onToggle(event: { stopPropagation(): void }): void
}) {
  const label = node.expanded ? 'Show fewer' : `+${node.hiddenFieldCount} columns`
  const ariaLabel = node.expanded
    ? `Show fewer columns for ${node.item.qualifiedName}`
    : `Show all columns for ${node.item.qualifiedName}`

  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(event)
    }
  }

  return (
    <g
      className="sql-rel-node-more-action"
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      transform={`translate(12 ${node.height - 28})`}
      onClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <rect className="sql-rel-more-button" width="104" height="20" rx="3" />
      <text className="sql-rel-node-more" x="8" y="14">
        {label}
      </text>
    </g>
  )
}

function MiniMap({ layout, selectedNodeId }: { layout: ReturnType<typeof buildGraphLayout>; selectedNodeId?: string }) {
  const width = 132
  const height = 86
  const scale = Math.min(width / Math.max(layout.width, 1), height / Math.max(layout.height, 1))

  return (
    <svg className="sql-rel-minimap" width={width} height={height} aria-hidden="true">
      {layout.nodes.map((node) => (
        <rect
          key={node.item.node.id}
          x={node.x * scale}
          y={node.y * scale}
          width={Math.max(5, node.width * scale)}
          height={Math.max(4, node.height * scale)}
          className={node.item.node.id === selectedNodeId ? 'is-selected' : undefined}
          rx="1"
        />
      ))}
    </svg>
  )
}

function RelationshipEndBadge({ end, point }: { end: RelationshipEnd; point: { x: number; y: number } }) {
  if (end === 'unknown') {
    return null
  }

  const label = relationshipEndLabel(end)
  const width = label.length > 1 ? 34 : 22

  return (
    <g className="sql-rel-cardinality-badge" transform={`translate(${point.x - width / 2} ${point.y - 10})`}>
      <rect width={width} height="20" rx="4" />
      <text x={width / 2} y="14">
        {label}
      </text>
    </g>
  )
}
