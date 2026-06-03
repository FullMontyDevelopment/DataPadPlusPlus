import type { ExplorerResponse } from '@datapadplusplus/shared-types'

export function mergeExplorerResponse(
  current: ExplorerResponse | undefined,
  incoming: ExplorerResponse,
): ExplorerResponse {
  if (
    !current ||
    current.connectionId !== incoming.connectionId ||
    current.environmentId !== incoming.environmentId
  ) {
    return incoming
  }

  const mergedNodes = new Map(current.nodes.map((node) => [node.id, node]))

  for (const node of incoming.nodes) {
    mergedNodes.set(node.id, node)
  }

  return {
    ...incoming,
    summary: incoming.summary,
    nodes: Array.from(mergedNodes.values()),
  }
}
