import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  DatastoreEngine,
  EnvironmentProfile,
  ExplorerNode,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
  QueryBuilderState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import type { ComponentType, ReactNode } from 'react'

export interface ObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
  onOpenObjectView?(connectionId: string, node: ExplorerNode): void
  onPlanOperation?(request: OperationPlanRequest): Promise<OperationPlanResponse | undefined>
  onExecuteDataEdit?(request: DataEditExecutionRequest): Promise<DataEditExecutionResponse | undefined>
}

export interface DatastoreWorkbenchTreeHooks {
  placement?: (node: ExplorerNode) => 'root' | 'group' | 'leaf'
  managementActions?: (node: ExplorerNode) => readonly string[]
}

export interface DatastoreWorkbenchQueryHooks {
  supportsScripting?: boolean
  supportsDocumentEfficiency?: boolean
  supportsAddDocument?: boolean
  requiresStructureRefresh?: (connection: ConnectionProfile) => boolean
  targets?: (connection: ConnectionProfile, nodes: ExplorerNode[]) => ScopedQueryTarget[]
  template?: (target: ScopedQueryTarget, connection: ConnectionProfile) => string | undefined
  serializeBuilder?: (
    state: QueryBuilderState,
    connection: ConnectionProfile,
    tab: QueryTabState,
  ) => string | undefined
}

export interface DatastoreWorkbenchSlice {
  engine: DatastoreEngine
  tree?: DatastoreWorkbenchTreeHooks
  query?: DatastoreWorkbenchQueryHooks
  objectViewWorkspace?: ComponentType<ObjectViewWorkspaceProps>
  descriptors?: unknown
  relationalDescriptor?: (kind: string) => unknown
  relationalInsights?: (props: {
    kind: string
    payload: Record<string, unknown>
  }) => ReactNode
  operationActions?: unknown
  queryBuilders?: unknown
  completionProviders?: unknown
  warehouseInsights?: (props: {
    kind: string
    payload: Record<string, unknown>
  }) => ReactNode
}
