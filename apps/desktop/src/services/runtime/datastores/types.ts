import type {
  ConnectionProfile,
  DataEditPlanRequest,
  DatastoreEngine,
  ExplorerNode,
  OperationPlanRequest,
} from '@datapadplusplus/shared-types'

export interface DatastoreRuntimeExplorerHooks {
  createNodes?: (connection: ConnectionProfile, scope?: string) => ExplorerNode[]
  inspectQueryTemplate?: (
    connection: ConnectionProfile,
    nodeId: string,
  ) => string | undefined
  inspectPayload?: (connection: ConnectionProfile, nodeId: string) => unknown
}

export interface DatastoreRuntimeOperationHooks {
  buildRequest?: (
    connection: ConnectionProfile,
    request: OperationPlanRequest,
  ) => string
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
  explorer?: DatastoreRuntimeExplorerHooks
  operation?: DatastoreRuntimeOperationHooks
  validation?: unknown
  dataEdit?: DatastoreRuntimeDataEditHooks
  payload?: unknown
  fixtures?: unknown
}
