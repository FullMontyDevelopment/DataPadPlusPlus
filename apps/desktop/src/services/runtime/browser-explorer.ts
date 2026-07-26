import type {
  ConnectionProfile,
  ExplorerInspectRequest,
  ExplorerInspectResponse,
  ExplorerNode,
  ExplorerRequest,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { findConnection } from './browser-store'
import {
  registeredRuntimeSliceForEngine,
  runtimeSliceForEngine,
} from './datastores/registry'
import { pageBrowserExplorerNodes } from './browser-explorer-paging'

export function createExplorerNodes(
  connection: ConnectionProfile,
  scope?: string,
): ExplorerNode[] {
  return registeredRuntimeSliceForEngine(connection.engine)?.explorer.createNodes(connection, scope) ?? []
}

export function pageExplorerNodes(
  connection: ConnectionProfile,
  nodes: ExplorerNode[],
  request: ExplorerRequest,
) {
  return runtimeSliceForEngine(connection.engine).explorer.pageNodes?.(nodes, request)
    ?? pageBrowserExplorerNodes(connection, nodes, request)
}

export function inspectExplorerNodeLocally(
  snapshot: WorkspaceSnapshot,
  request: ExplorerInspectRequest,
): ExplorerInspectResponse {
  const connection = findConnection(snapshot, request.connectionId)

  if (!connection) {
    return {
      nodeId: request.nodeId,
      summary: 'Explorer node is not available in the current workspace.',
    }
  }

  const explorer = registeredRuntimeSliceForEngine(connection.engine)?.explorer

  if (!explorer) {
    return {
      nodeId: request.nodeId,
      summary: 'Explorer metadata is not registered for this datastore engine.',
    }
  }

  return {
    nodeId: request.nodeId,
    summary: `Inspection ready for ${request.nodeId} on ${connection.name}.`,
    queryTemplate: explorer?.inspectQueryTemplate?.(connection, request.nodeId),
    payload: explorer.inspectPayload(connection, request.nodeId),
  }
}
