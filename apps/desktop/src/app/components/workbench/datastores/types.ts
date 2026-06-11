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

export interface DatastoreWorkbenchSlice {
  engine: DatastoreEngine
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
