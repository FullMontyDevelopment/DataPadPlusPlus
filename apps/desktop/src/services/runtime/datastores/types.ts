import type {
  ConnectionProfile,
  DataEditPlanRequest,
  DatastoreEngine,
  ExplorerNode,
  ExplorerPageInfo,
  ExplorerRequest,
  OperationPlanRequest,
} from '@datapadplusplus/shared-types'

export interface DatastoreRuntimeExplorerHooks {
  createNodes: (connection: ConnectionProfile, scope?: string) => ExplorerNode[]
  pageNodes?: (
    nodes: ExplorerNode[],
    request: ExplorerRequest,
  ) => { nodes: ExplorerNode[]; pageInfo?: ExplorerPageInfo }
  inspectQueryTemplate?: (
    connection: ConnectionProfile,
    nodeId: string,
  ) => string | undefined
  inspectPayload: (connection: ConnectionProfile, nodeId: string) => unknown
}

export interface DatastoreRuntimeOperationHooks {
  buildRequest?: (
    connection: ConnectionProfile,
    request: OperationPlanRequest,
  ) => string
  refreshScopesAfterExecution?: (request: OperationPlanRequest) => string[]
}

export interface DatastoreRuntimeDataEditHooks {
  buildRequest?: (
    connection: ConnectionProfile,
    request: DataEditPlanRequest,
  ) => string
  warnings?: (
    connection: ConnectionProfile,
    request: DataEditPlanRequest,
  ) => string[]
  permission?: (
    connection: ConnectionProfile,
    request: DataEditPlanRequest,
  ) => string
}

export interface DatastoreRuntimeSlice {
  engine: DatastoreEngine
  explorer: DatastoreRuntimeExplorerHooks
  operation?: DatastoreRuntimeOperationHooks
  validation?: unknown
  dataEdit?: DatastoreRuntimeDataEditHooks
  payload?: unknown
  fixtures?: unknown
}
