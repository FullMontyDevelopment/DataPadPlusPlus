import type {
  ConnectionProfile,
  LibraryNode,
} from '@datapadplusplus/shared-types'

export function assignedEnvironmentIdsForConnection(
  connection: ConnectionProfile,
  libraryNodes: LibraryNode[],
) {
  const environmentIds = new Set(connection.environmentIds)
  const nodeById = new Map(libraryNodes.map((node) => [node.id, node]))

  for (const node of libraryNodes) {
    if (node.kind !== 'connection' || node.connectionId !== connection.id) continue

    let current: LibraryNode | undefined = node
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      if (current.environmentId) {
        environmentIds.add(current.environmentId)
        break
      }
      current = current.parentId ? nodeById.get(current.parentId) : undefined
    }
  }

  return [...environmentIds]
}
