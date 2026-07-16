import type { ResultPayload } from '@datapadplusplus/shared-types'

export type GraphPayload = Extract<ResultPayload, { renderer: 'graph' }>

export interface NormalizedGraphNode {
  id: string
  label: string
  kind: string
  properties: Record<string, unknown>
  raw: unknown
}

export interface NormalizedGraphEdge {
  id: string
  from: string
  to: string
  label: string
  kind: string
  properties: Record<string, unknown>
  raw: unknown
}

export interface GraphModel {
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

export interface GraphKindSummary {
  kind: string
  count: number
  color: string
}

export type SelectedGraphItem =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }

const DEFAULT_VISUAL_NODE_CAP = 10_000
const DEFAULT_VISUAL_EDGE_CAP = 25_000

export function buildGraphModel(payload: GraphPayload): GraphModel {
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

  return {
    nodes,
    edges,
    visualNodes,
    visualEdges,
    nodeById,
    edgeById,
    degreeByNode,
    capped: nodes.length > visualNodes.length || edges.length > visualEdges.length || Boolean(payload.truncated),
    warnings: stringArray(payload.warnings),
  }
}

export function graphItemValue(model: GraphModel, selected: SelectedGraphItem) {
  if (selected.kind === 'node') {
    const node = model.nodeById.get(selected.id)
    return node
      ? { id: node.id, label: node.label, kind: node.kind, properties: node.properties, raw: node.raw }
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

export function graphObjectRows(model: GraphModel, filter: string) {
  const needle = filter.trim().toLocaleLowerCase()
  const rows = [
    ...model.nodes.map((node) => ({
      kind: 'node' as const,
      id: node.id,
      label: node.label,
      detail: `${node.kind} / ${node.id}`,
    })),
    ...model.edges.map((edge) => ({
      kind: 'edge' as const,
      id: edge.id,
      label: edge.label,
      detail: `${edge.from} -> ${edge.to}`,
    })),
  ]
  return needle
    ? rows.filter((row) =>
        `${row.kind} ${row.id} ${row.label} ${row.detail}`.toLocaleLowerCase().includes(needle),
      )
    : rows
}

export function formatGraphCount(value: number) {
  return new Intl.NumberFormat().format(value)
}

export function graphKindSummary(model: GraphModel): GraphKindSummary[] {
  const counts = new Map<string, number>()
  model.visualNodes.forEach((node) => {
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1)
  })

  return Array.from(counts, ([kind, count]) => ({
    kind,
    count,
    color: graphNodeColor(kind),
  })).sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind))
}

export function graphNodeColor(kind: string) {
  const palette = ['#62b8e8', '#5dc8a6', '#e489b6', '#e6c75f', '#9d8ee2', '#e8867e']
  const hash = Array.from(kind).reduce(
    (total, character) => ((total * 31) + character.charCodeAt(0)) | 0,
    17,
  )
  return palette[Math.abs(hash) % palette.length] ?? '#62b8e8'
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

  return { id, label, kind, properties, raw: record.raw ?? value }
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
  if (!from || !to) {
    return undefined
  }
  return {
    id,
    from,
    to,
    label,
    kind: stringValue(record.kind) ?? label,
    properties: recordValue(record.properties),
    raw: record.raw ?? value,
  }
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
