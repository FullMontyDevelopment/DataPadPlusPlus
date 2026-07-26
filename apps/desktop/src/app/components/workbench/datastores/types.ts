import type { ComponentType } from 'react'
import type {
  ConnectionProfile,
  DatastoreExecutionInput,
  DatastoreQueryEditorState,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  DatastoreEngine,
  EnvironmentProfile,
  ExplorerInspectResponse,
  ExplorerNode,
  ExplorerResponse,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
  QueryBuilderState,
  ScopedQueryTarget,
  StructureRequest,
  StructureResponse,
} from '@datapadplusplus/shared-types'
import type {
  DatastoreCompletionProvider,
  EditorCompletionContext,
} from '../intellisense/types'
import type { MouseEvent, ReactNode } from 'react'
import type {
  DatastoreExplorerProvider,
  DatastoreObjectViewProvider,
} from './common/explorer/DatastoreExplorerProvider.types'

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

export interface DatastoreExplorerWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  status: 'idle' | 'loading' | 'ready'
  error?: string
  inspection?: ExplorerInspectResponse
  scopes: Record<string, ExplorerResponse>
  relationshipMap?: {
    status: 'idle' | 'loading' | 'ready'
    structure?: StructureResponse
    error?: string
    onRefresh(options?: Partial<StructureRequest>): void
  }
  isScopeLoading(scope?: string): boolean
  getScopeError(scope?: string): string | undefined
  onLoadScope(scope?: string, cursor?: string): void
  onInspectNode(node: ExplorerNode): void
  onOpenQuery(target: ScopedQueryTarget): void
  onOpenObjectView(node: ExplorerNode): void
}

export interface DatastoreExplorerNavigatorProps {
  connection: ConnectionProfile
  environment?: EnvironmentProfile
  scopes: Record<string, ExplorerResponse>
  filter: string
  selectedNodeId?: string
  compact?: boolean
  isScopeLoading(scope?: string): boolean
  getScopeError(scope?: string): string | undefined
  onLoadScope(scope?: string, cursor?: string): void
  onSelectNode(node: ExplorerNode): void
  onNodeContextMenu?(event: MouseEvent<HTMLButtonElement>, node: ExplorerNode): void
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
  modeLabels?: Partial<Record<'builder' | 'raw' | 'script', string>>
  Editor?: ComponentType<DatastoreQueryEditorWorkspaceProps>
  resolveEditorState?: (
    tab: QueryTabState,
    builderState?: QueryBuilderState,
  ) => DatastoreQueryEditorState | undefined
  applyEditorState?: (
    builderState: QueryBuilderState | undefined,
    editorState: DatastoreQueryEditorState,
  ) => QueryBuilderState | undefined
  editorStateFromBuilder?: (
    builderState: QueryBuilderState,
  ) => DatastoreQueryEditorState | undefined
  editorText?: (editorState: DatastoreQueryEditorState) => string
  prepareExecution?: (input: {
    tab: QueryTabState
    builderState?: QueryBuilderState
    editorState?: DatastoreQueryEditorState
    mode: 'builder' | 'raw'
    selectedText?: string
  }) => {
    queryText: string
    builderState?: QueryBuilderState
    datastoreExecutionInput?: DatastoreExecutionInput
    errors?: string[]
    warnings?: string[]
  }
}

export interface DatastoreQueryEditorWorkspaceProps {
  tab: QueryTabState
  connection: ConnectionProfile
  editorState?: DatastoreQueryEditorState
  value: string
  theme: string
  resetKey?: string | number
  completionContext?: EditorCompletionContext
  completionProviders: DatastoreCompletionProvider[]
  readOnly?: boolean
  onRequestCompletionRefresh?(): void
  onSelectionChange?(selectedText: string): void
  onEditorStateChange(state: DatastoreQueryEditorState): void
}

export interface DatastoreWorkbenchSlice {
  engine: DatastoreEngine
  tree?: DatastoreWorkbenchTreeHooks
  query?: DatastoreWorkbenchQueryHooks
  explorer: DatastoreExplorerProvider
  objectView: DatastoreObjectViewProvider
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
