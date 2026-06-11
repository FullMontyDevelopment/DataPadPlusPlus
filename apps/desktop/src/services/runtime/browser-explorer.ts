import type {
  ConnectionProfile,
  ExplorerInspectRequest,
  ExplorerInspectResponse,
  ExplorerNode,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { findConnection } from './browser-store'
import { runtimeSliceForEngine } from './datastores/registry'

export function createExplorerNodes(
  connection: ConnectionProfile,
  scope?: string,
): ExplorerNode[] {
  return runtimeSliceForEngine(connection.engine)?.explorer?.createNodes?.(connection, scope) ?? []
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

  const explorer = runtimeSliceForEngine(connection.engine)?.explorer

  return {
    nodeId: request.nodeId,
    summary: `Inspection ready for ${request.nodeId} on ${connection.name}.`,
    queryTemplate: explorer?.inspectQueryTemplate?.(connection, request.nodeId),
    payload: explorer?.inspectPayload?.(connection, request.nodeId) ?? {
      engine: connection.engine,
      objectName: request.nodeId,
      objectView: 'unavailable',
      warnings: [
        'Preview metadata is not available for this datastore adapter yet.',
      ],
    },
  }
}
