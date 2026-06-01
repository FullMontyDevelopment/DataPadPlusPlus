import type { StructureEdge, StructureField } from '@datapadplusplus/shared-types'
import type { SqlExplorerNode } from './SqlRelationshipExplorer.model'

export interface GraphNode {
  item: SqlExplorerNode
  x: number
  y: number
  width: number
  height: number
  visibleFields: StructureField[]
  hiddenFieldCount: number
  expanded: boolean
}

export type RelationshipEnd = 'one' | 'many' | 'zero-one' | 'zero-many' | 'unknown'

export const NODE_WIDTH = 230
export const NODE_HEADER_HEIGHT = 40
export const FIELD_HEIGHT = 18

const GROUP_GAP = 470
const ROW_GAP = 72
const COLLAPSED_FIELD_COUNT = 4
const MAX_EXPANDED_FIELD_COUNT = 32

export function buildGraphLayout(
  nodes: SqlExplorerNode[],
  edges: StructureEdge[],
  expandedNodeIds: Set<string>,
) {
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

  return {
    groups: buildSchemaGroups(graphNodes),
    nodes: graphNodes,
    edges,
    nodeById,
    width: Math.max(1, Math.max(...graphNodes.map((node) => node.x + node.width), 1)),
    height: Math.max(1, Math.max(...graphNodes.map((node) => node.y + node.height), 1)),
  }
}

export function relationshipGeometry(edge: StructureEdge, from: GraphNode, to: GraphNode) {
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

export function relationshipEnds(edge: StructureEdge): { from: RelationshipEnd; to: RelationshipEnd } {
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

export function relationshipCardinality(edge: StructureEdge) {
  if (edge.cardinality) {
    return normalizeCardinality(edge.cardinality)
  }

  if (edge.kind.toLowerCase().includes('foreign') || edge.fromField || edge.toField) {
    return 'many-to-one'
  }

  return 'unknown'
}

export function relationshipEndLabel(end: RelationshipEnd) {
  if (end === 'many') return 'N'
  if (end === 'zero-one') return '0..1'
  if (end === 'zero-many') return '0..N'
  return '1'
}

export function toggleExpandedNode(current: Set<string>, nodeId: string) {
  const next = new Set(current)
  if (next.has(nodeId)) {
    next.delete(nodeId)
  } else {
    next.add(nodeId)
  }
  return next
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

function fieldAnchorY(node: GraphNode, fieldName: string | undefined) {
  const fieldIndex = node.visibleFields.findIndex((field) => field.name === fieldName)
  if (fieldIndex >= 0) {
    return node.y + NODE_HEADER_HEIGHT + 9 + fieldIndex * FIELD_HEIGHT
  }

  return node.y + node.height / 2
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
