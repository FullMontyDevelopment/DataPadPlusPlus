import type { StructureEdge } from '@datapadplusplus/shared-types'
import type { SqlExplorerNode } from './SqlRelationshipExplorer.model'

const NODE_WIDTH = 230
const GROUP_GAP = 320
const ROW_GAP = 118

interface ExportNode {
  item: SqlExplorerNode
  x: number
  y: number
  width: number
  height: number
}

export function serializeRelationshipSvg(nodes: SqlExplorerNode[], edges: StructureEdge[]) {
  const layout = buildExportLayout(nodes, edges)
  const width = Math.max(960, layout.width + 80)
  const height = Math.max(640, layout.height + 80)
  const edgeMarkup = layout.edges
    .map((edge) => {
      const from = layout.nodeById.get(edge.from)
      const to = layout.nodeById.get(edge.to)
      return from && to
        ? `<path d="${relationshipPath(from, to)}" fill="none" stroke="${edge.inferred ? '#7c8aa0' : '#39d98a'}" stroke-width="1.4"/>`
        : ''
    })
    .join('')
  const nodeMarkup = layout.nodes
    .map(
      (node) =>
        `<g transform="translate(${node.x} ${node.y})"><rect width="${node.width}" height="${node.height}" rx="7" fill="#151a1d" stroke="#344047"/><text x="16" y="24" fill="#f4f7f8" font-family="Arial" font-size="13">${escapeSvg(node.item.objectName)}</text><text x="16" y="42" fill="#8fa3ad" font-family="Arial" font-size="11">${escapeSvg(node.item.schema)}</text></g>`,
    )
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#101214"/><g transform="translate(40 40)">${edgeMarkup}${nodeMarkup}</g></svg>`
}

function buildExportLayout(nodes: SqlExplorerNode[], edges: StructureEdge[]) {
  const schemaOrder = [...new Set(nodes.map((node) => node.schema))]
  const nodeById = new Map<string, ExportNode>()
  const graphNodes: ExportNode[] = []

  schemaOrder.forEach((schema, schemaIndex) => {
    nodes
      .filter((node) => node.schema === schema)
      .forEach((item, index) => {
        const graphNode = {
          item,
          x: schemaIndex * GROUP_GAP,
          y: 42 + index * ROW_GAP,
          width: NODE_WIDTH,
          height: 122,
        }
        graphNodes.push(graphNode)
        nodeById.set(item.node.id, graphNode)
      })
  })

  return {
    nodes: graphNodes,
    edges,
    nodeById,
    width: Math.max(1, (schemaOrder.length - 1) * GROUP_GAP + NODE_WIDTH),
    height: Math.max(1, Math.max(...graphNodes.map((node) => node.y + node.height), 1)),
  }
}

function relationshipPath(from: ExportNode, to: ExportNode) {
  const fromX = from.x + from.width
  const fromY = from.y + from.height / 2
  const toX = to.x
  const toY = to.y + to.height / 2
  const bend = Math.max(90, Math.abs(toX - fromX) / 2)

  if (fromX <= toX) {
    return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
  }

  return `M ${from.x} ${fromY} C ${from.x - bend} ${fromY}, ${to.x + to.width + bend} ${toY}, ${to.x + to.width} ${toY}`
}

function escapeSvg(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
