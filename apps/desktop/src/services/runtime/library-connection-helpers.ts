import type { ConnectionProfile, LibraryNode, WorkspaceSnapshot } from '@datapadplusplus/shared-types'

export function connectionLibraryNodeId(connectionId: string) {
  return `library-connection-${connectionId}`
}

export function libraryNodeForConnection(
  nodes: LibraryNode[],
  connectionId: string,
): LibraryNode | undefined {
  return nodes.find(
    (node) => node.kind === 'connection' && node.connectionId === connectionId,
  )
}

export function ensureConnectionLibraryNodes(snapshot: WorkspaceSnapshot) {
  const timestamp = new Date().toISOString()
  const existingConnectionIds = new Set(
    snapshot.libraryNodes
      .filter((node) => node.kind === 'connection' && node.connectionId)
      .map((node) => node.connectionId),
  )

  snapshot.connections.forEach((connection) => {
    const existing = libraryNodeForConnection(snapshot.libraryNodes, connection.id)

    if (existing) {
      existing.name = connection.name
      existing.summary = connectionSummary(connection)
      existing.updatedAt = timestamp
      return
    }

    if (existingConnectionIds.has(connection.id)) {
      return
    }

    snapshot.libraryNodes.push({
      id: connectionLibraryNodeId(connection.id),
      kind: 'connection',
      name: connection.name,
      summary: connectionSummary(connection),
      tags: connection.tags ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
      connectionId: connection.id,
      environmentId: undefined,
    })
    existingConnectionIds.add(connection.id)
  })
}

export function removeConnectionLibraryNodes(
  snapshot: WorkspaceSnapshot,
  connectionId: string,
) {
  const deletedIds = new Set(
    snapshot.libraryNodes
      .filter((node) => node.kind === 'connection' && node.connectionId === connectionId)
      .map((node) => node.id),
  )

  snapshot.libraryNodes = snapshot.libraryNodes.filter((node) => !deletedIds.has(node.id))
  snapshot.libraryNodes.forEach((node) => {
    if (node.connectionId === connectionId && node.kind !== 'connection') {
      node.connectionId = undefined
    }
  })
}

export function defaultLibraryFolderForConnection(
  snapshot: WorkspaceSnapshot,
  connectionId: string | undefined,
) {
  if (!connectionId) {
    return 'library-root-queries'
  }

  return libraryNodeForConnection(snapshot.libraryNodes, connectionId)?.parentId ?? 'library-root-queries'
}

export function effectiveConnectionEnvironmentId(
  snapshot: WorkspaceSnapshot,
  connection: ConnectionProfile,
  preferredEnvironmentId?: string,
) {
  if (preferredEnvironmentId && environmentExists(snapshot, preferredEnvironmentId)) {
    return preferredEnvironmentId
  }

  const libraryNode = libraryNodeForConnection(snapshot.libraryNodes, connection.id)
  const inheritedEnvironmentId = libraryNode
    ? effectiveEnvironmentFromNode(snapshot.libraryNodes, libraryNode.id)
    : undefined

  return (
    inheritedEnvironmentId ??
    connection.environmentIds[0] ??
    snapshot.ui.activeEnvironmentId ??
    snapshot.environments[0]?.id ??
    'env-dev'
  )
}

function effectiveEnvironmentFromNode(nodes: LibraryNode[], nodeId: string) {
  let currentId: string | undefined = nodeId
  const visited = new Set<string>()

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const node = nodes.find((item) => item.id === currentId)

    if (!node) {
      return undefined
    }

    if (node.environmentId) {
      return node.environmentId
    }

    currentId = node.parentId
  }

  return undefined
}

function environmentExists(snapshot: WorkspaceSnapshot, environmentId: string) {
  return snapshot.environments.some((environment) => environment.id === environmentId)
}

function connectionSummary(connection: ConnectionProfile) {
  return `${connection.engine} / ${connection.environmentIds.length || 1} environment(s)`
}
