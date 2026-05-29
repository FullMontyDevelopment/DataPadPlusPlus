import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react'
import type { StructureEdge, StructureField } from '@datapadplusplus/shared-types'
import type { SqlExplorerNode } from './SqlRelationshipExplorer.model'
import { edgeLabel } from './SqlRelationshipExplorer.model'

interface SqlRelationshipGraphCanvasProps {
  nodes: SqlExplorerNode[]
  edges: StructureEdge[]
  selectedNodeId?: string
  onSelectNode(nodeId: string | undefined): void
}

interface GraphNode {
  item: SqlExplorerNode
  x: number
  y: number
  width: number
  height: number
  visibleFields: StructureField[]
  hiddenFieldCount: number
  expanded: boolean
}

type RelationshipEnd = 'one' | 'many' | 'zero-one' | 'zero-many' | 'unknown'

const NODE_WIDTH = 230
const NODE_HEADER_HEIGHT = 40
const FIELD_HEIGHT = 18
const GROUP_GAP = 470
const ROW_GAP = 72
const COLLAPSED_FIELD_COUNT = 4
const MAX_EXPANDED_FIELD_COUNT = 32

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

function relationshipEndLabel(end: RelationshipEnd) {
  if (end === 'many') return 'N'
  if (end === 'zero-one') return '0..1'
  if (end === 'zero-many') return '0..N'
  return '1'
}

function relationshipEnds(edge: StructureEdge): { from: RelationshipEnd; to: RelationshipEnd } {
  const cardinality = relationshipCardinality(edge)

  if (cardinality.includes('zero-many-to-zero-many')) return { from: 'zero-many', to: 'zero-many' }
  if (cardinality.includes('zero-one-to-zero-many')) return { from: 'zero-one', to: 'zero-many' }
  if (cardinality.includes('zero-many-to-zero-one')) return { from: 'zero-many', to: 'zero-one' }
  if (cardinality.includes('zero-one-to-one')) return { from: 'zero-one', to: 'one' }
  if (cardinality.includes('one-to-zero-many')) return { from: 'one', to: 'zero-many' }
  if (cardinality.includes('zero-many-to-one')) return { from: 'zero-many', to: 'one' }
  if (cardinality.includes('many-to-one')) return { from: 'many', to: 'one' }
  if (cardinality.includes('one-to-many')) return { from: 'one', to: 'many' }
  if (cardinality.includes('many-to-many')) return { from: 'many', to: 'many' }
  if (cardinality.includes('one-to-one')) return { from: 'one', to: 'one' }

  return { from: 'unknown', to: 'unknown' }
}

function relationshipCardinality(edge: StructureEdge) {
  if (edge.cardinality) {
    return normalizeCardinality(edge.cardinality)
  }

  if (edge.kind.toLowerCase().includes('foreign') || edge.fromField || edge.toField) {
    return 'many-to-one'
  }

  return 'unknown'
}

function normalizeCardinality(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/0\.\.\*/gu, 'zero-many')
    .replace(/0\.\.1/gu, 'zero-one')
    .replace(/1\.\.\*/gu, 'many')
    .replace(/\*/gu, 'many')
    .replace(/\s+/gu, '-')
    .replace(/_/gu, '-')
    .replace(/optional/gu, 'zero')
    .replace(/zero-or-one/gu, 'zero-one')
    .replace(/zero-or-many/gu, 'zero-many')
}

function buildGraphLayout(nodes: SqlExplorerNode[], edges: StructureEdge[], expandedNodeIds: Set<string>) {
  const graphNodes = nodes.map((item) => createGraphNode(item, expandedNodeIds))
  const nodeById = new Map(graphNodes.map((node) => [node.item.node.id, node]))
  const graphEdges = edges.filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to))
  const levels = calculateRelationshipLevels(graphNodes, graphEdges)
  const incomingCount = new Map<string, number>()
  const outgoingByNode = new Map<string, StructureEdge[]>()

  for (const edge of graphEdges) {
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1)
    const outgoing = outgoingByNode.get(edge.from) ?? []
    outgoing.push(edge)
    outgoingByNode.set(edge.from, outgoing)
  }

  const columns = new Map<number, GraphNode[]>()
  for (const node of graphNodes) {
    const level = levels.get(node.item.node.id) ?? 0
    const column = columns.get(level) ?? []
    column.push(node)
    columns.set(level, column)
  }

  const placedCenterY = new Map<string, number>()
  for (const level of [...columns.keys()].sort((left, right) => left - right)) {
    const column = columns.get(level) ?? []
    const sortedColumn = column.sort((left, right) => {
      const leftDesired = desiredNodeY(left, outgoingByNode, placedCenterY)
      const rightDesired = desiredNodeY(right, outgoingByNode, placedCenterY)
      if (leftDesired !== rightDesired) return leftDesired - rightDesired

      const leftIncoming = incomingCount.get(left.item.node.id) ?? 0
      const rightIncoming = incomingCount.get(right.item.node.id) ?? 0
      if (leftIncoming !== rightIncoming) return rightIncoming - leftIncoming

      return left.item.qualifiedName.localeCompare(right.item.qualifiedName)
    })
    let cursor = 42

    for (const node of sortedColumn) {
      const desiredY = desiredNodeY(node, outgoingByNode, placedCenterY)
      node.x = level * GROUP_GAP
      node.y = Math.max(cursor, desiredY)
      cursor = node.y + node.height + ROW_GAP
      placedCenterY.set(node.item.node.id, node.y + node.height / 2)
    }
  }

  const groups = buildSchemaGroups(graphNodes)

  return {
    groups,
    nodes: graphNodes,
    edges,
    nodeById,
    width: Math.max(1, Math.max(...graphNodes.map((node) => node.x + node.width), 1)),
    height: Math.max(1, Math.max(...graphNodes.map((node) => node.y + node.height), 1)),
  }
}

function createGraphNode(item: SqlExplorerNode, expandedNodeIds: Set<string>): GraphNode {
  const allFields = item.node.fields ?? []
  const expanded = expandedNodeIds.has(item.node.id)
  const visibleFields = expanded
    ? allFields.slice(0, MAX_EXPANDED_FIELD_COUNT)
    : allFields.slice(0, COLLAPSED_FIELD_COUNT)
  const hiddenFieldCount = Math.max(0, allFields.length - COLLAPSED_FIELD_COUNT)
  const footerHeight = hiddenFieldCount > 0 ? 36 : 18

  return {
    item,
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEADER_HEIGHT + visibleFields.length * FIELD_HEIGHT + footerHeight + 14,
    visibleFields,
    hiddenFieldCount,
    expanded,
  }
}

function calculateRelationshipLevels(nodes: GraphNode[], edges: StructureEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.item.node.id))
  const parentEdges = new Map<string, StructureEdge[]>()
  const memo = new Map<string, number>()

  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      continue
    }

    const parents = parentEdges.get(edge.from) ?? []
    parents.push(edge)
    parentEdges.set(edge.from, parents)
  }

  const visit = (nodeId: string, visiting: Set<string>): number => {
    const cached = memo.get(nodeId)
    if (cached !== undefined) {
      return cached
    }

    if (visiting.has(nodeId)) {
      return 0
    }

    visiting.add(nodeId)
    const parentLevel = Math.max(
      -1,
      ...(parentEdges.get(nodeId) ?? []).map((edge) => visit(edge.to, visiting)),
    )
    visiting.delete(nodeId)

    const level = parentLevel + 1
    memo.set(nodeId, level)
    return level
  }

  for (const node of nodes) {
    visit(node.item.node.id, new Set())
  }

  return memo
}

function desiredNodeY(
  node: GraphNode,
  outgoingByNode: Map<string, StructureEdge[]>,
  placedCenterY: Map<string, number>,
) {
  const parentCenters = (outgoingByNode.get(node.item.node.id) ?? [])
    .map((edge) => placedCenterY.get(edge.to))
    .filter((value): value is number => value !== undefined)

  if (parentCenters.length === 0) {
    return 42
  }

  const averageParentCenter = parentCenters.reduce((sum, value) => sum + value, 0) / parentCenters.length
  return Math.max(42, averageParentCenter - node.height / 2)
}

function buildSchemaGroups(nodes: GraphNode[]) {
  const bySchema = new Map<string, GraphNode[]>()
  for (const node of nodes) {
    const group = bySchema.get(node.item.schema) ?? []
    group.push(node)
    bySchema.set(node.item.schema, group)
  }

  return [...bySchema.entries()].map(([schema, group]) => ({
    id: schema,
    label: schema,
    x: Math.min(...group.map((node) => node.x)),
    y: Math.min(...group.map((node) => node.y)) - 16,
  }))
}

function relationshipGeometry(edge: StructureEdge, from: GraphNode, to: GraphNode) {
  const sameColumn = Math.abs(from.x - to.x) < 8
  const fromSide: 'left' | 'right' = sameColumn || from.x <= to.x ? 'right' : 'left'
  const toSide: 'left' | 'right' = sameColumn || from.x > to.x ? 'right' : 'left'
  const fromX = fromSide === 'right' ? from.x + from.width : from.x
  const toX = toSide === 'right' ? to.x + to.width : to.x
  const fromY = fieldAnchorY(from, edge.fromField)
  const toY = fieldAnchorY(to, edge.toField)
  const fromBadgePoint = {
    x: fromX + (fromSide === 'right' ? 24 : -24),
    y: fromY,
  }
  const toBadgePoint = {
    x: toX + (toSide === 'right' ? 24 : -24),
    y: toY,
  }

  if (sameColumn) {
    const loopX = Math.max(from.x + from.width, to.x + to.width) + 84
    return {
      path: `M ${fromX} ${fromY} C ${loopX} ${fromY}, ${loopX} ${toY}, ${toX} ${toY}`,
      fromBadgePoint,
      toBadgePoint,
      labelPoint: { x: loopX, y: (fromY + toY) / 2 - 20 },
    }
  }

  const bend = Math.max(90, Math.abs(toX - fromX) / 2)
  const labelPoint = {
    x: (fromX + toX) / 2,
    y: (fromY + toY) / 2 - 20,
  }

  if (fromX <= toX) {
    return {
      path: `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`,
      fromBadgePoint,
      toBadgePoint,
      labelPoint,
    }
  }

  return {
    path: `M ${fromX} ${fromY} C ${fromX - bend} ${fromY}, ${toX + bend} ${toY}, ${toX} ${toY}`,
    fromBadgePoint,
    toBadgePoint,
    labelPoint,
  }
}

function fieldAnchorY(node: GraphNode, fieldName: string | undefined) {
  const fieldIndex = node.visibleFields.findIndex((field) => field.name === fieldName)
  if (fieldIndex >= 0) {
    return node.y + NODE_HEADER_HEIGHT + 9 + fieldIndex * FIELD_HEIGHT
  }

  return node.y + node.height / 2
}

function toggleExpandedNode(current: Set<string>, nodeId: string) {
  const next = new Set(current)
  if (next.has(nodeId)) {
    next.delete(nodeId)
  } else {
    next.add(nodeId)
  }
  return next
}
