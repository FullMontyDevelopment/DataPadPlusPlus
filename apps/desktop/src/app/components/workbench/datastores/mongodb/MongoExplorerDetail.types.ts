import type {
  ConnectionProfile,
  ExplorerInspectResponse,
  ExplorerNode,
  ExplorerResponse,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import type { ComponentType } from 'react'

export type MongoExplorerDetailMode = 'scope' | 'inspection' | 'launch' | 'state'

export type MongoExplorerDetailActionId =
  | 'open-query'
  | 'open-aggregation'
  | 'open-schema'
  | 'open-indexes'
  | 'open-validation'
  | 'open-statistics'
  | 'open-overview'
  | 'open-pipeline'

export interface MongoExplorerDetailAction {
  id: MongoExplorerDetailActionId
  label: string
  primary?: boolean
}

export interface MongoExplorerDetailProps {
  connection: ConnectionProfile
  node: ExplorerNode
  inspection?: ExplorerInspectResponse
  scopeResponse?: ExplorerResponse
  scopeLoading: boolean
  scopeError?: string
  actions: readonly MongoExplorerDetailAction[]
  onLoadScope(scope?: string, cursor?: string): void
  onSelectNode(node: ExplorerNode): void
  onRunAction(action: MongoExplorerDetailActionId, node: ExplorerNode): void
}

export interface MongoExplorerDetailProvider {
  kind: string
  mode: MongoExplorerDetailMode
  component: ComponentType<MongoExplorerDetailProps>
  actions?: readonly MongoExplorerDetailAction[]
}

export interface MongoExplorerActionHandlers {
  onOpenQuery(target: ScopedQueryTarget): void
  onOpenObjectView(node: ExplorerNode): void
}
