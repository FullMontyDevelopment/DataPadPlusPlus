import type {
  BottomPanelTab,
  ConnectionGroupMode,
  ResultsDock,
  RightDrawerView,
  SidebarPane,
  UiActivity,
} from './app'
import type { ConnectionProfile, DatastoreEngine, DatastoreFamily } from './connection'
import type {
  AdapterCapability,
  DatastoreTreeManifest,
  ExecutionCapabilities,
} from './capabilities'
import type { GuardrailDecision } from './security'
import type { DatastoreCompletenessSummary } from './datastore-completeness'
import type {
  ExecutionResultEnvelope,
  ExplorerNode,
  DatastoreTestAssertionKind,
  DatastoreTestRunResult,
  DatastoreTestSuiteDefinition,
  DatastoreTestTemplate,
  QueryBuilderKind,
  QueryBuilderState,
  QueryLanguage,
  QueryViewMode,
  ScopedQueryTarget,
  QueryTabState,
  ResultPageInfo,
  ResultPayload,
  ResultRenderer,
  StructureEdge,
  StructureGroup,
  StructureMetric,
  StructureNode,
} from './workspace'

export type QueryExecutionMode = 'full' | 'selection' | 'explain'

export const DATASTORE_OPERATION_RISKS = [
  'read',
  'diagnostic',
  'write',
  'destructive',
  'costly',
] as const

export type DatastoreOperationRisk = (typeof DATASTORE_OPERATION_RISKS)[number]

export const DATASTORE_OPERATION_SCOPES = [
  'connection',
  'cluster',
  'database',
  'schema',
  'table',
  'collection',
  'document',
  'key',
  'item',
  'index',
  'query',
  'user',
  'role',
  'file',
] as const

export type DatastoreOperationScope = (typeof DATASTORE_OPERATION_SCOPES)[number]

export type DatastoreOperationExecutionSupport = 'live' | 'plan-only' | 'unsupported'

export interface DatastoreOperationManifest {
  id: string
  engine: DatastoreEngine
  family: DatastoreFamily
  label: string
  scope: DatastoreOperationScope
  risk: DatastoreOperationRisk
  requiredCapabilities: AdapterCapability[]
  supportedRenderers: ResultRenderer[]
  description: string
  requiresConfirmation: boolean
  executionSupport: DatastoreOperationExecutionSupport
  disabledReason?: string
  previewOnly?: boolean
}

export interface OperationPlan {
  operationId: string
  engine: DatastoreEngine
  summary: string
  generatedRequest: string
  requestLanguage: QueryLanguage
  destructive: boolean
  estimatedCost?: string
  estimatedScanImpact?: string
  requiredPermissions: string[]
  confirmationText?: string
  warnings: string[]
}

export interface PermissionInspection {
  engine: DatastoreEngine
  principal?: string
  effectiveRoles: string[]
  effectivePrivileges: string[]
  iamSignals: string[]
  unavailableActions: Array<{
    operationId: string
    reason: string
  }>
  warnings: string[]
}

export interface AdapterDiagnostics {
  engine: DatastoreEngine
  plans: ResultPayload[]
  profiles: ResultPayload[]
  metrics: ResultPayload[]
  queryHistory: ResultPayload[]
  costEstimates: ResultPayload[]
  warnings: string[]
}

export interface DatastoreExperienceObjectKind {
  kind: string
  label: string
  description: string
  childKinds: string[]
  queryable: boolean
  supportsContextMenu: boolean
}

export interface DatastoreExperienceAction {
  id: string
  label: string
  scope: DatastoreOperationScope
  risk: DatastoreOperationRisk
  operationId?: string
  requiresSelection: boolean
  description: string
}

export interface DatastoreExperienceBuilder {
  kind: QueryBuilderKind
  label: string
  scope: DatastoreOperationScope
  defaultMode: 'visual' | 'split' | 'raw'
}

export interface DatastoreEditableScope {
  scope: DatastoreOperationScope
  label: string
  editKinds: DataEditKind[]
  requiresPrimaryKey: boolean
  liveExecution: boolean
}

export interface DatastoreDiagnosticsTab {
  id: string
  label: string
  description: string
  defaultRenderer: ResultRenderer
}

export interface DatastoreExperienceManifest {
  engine: DatastoreEngine
  family: DatastoreFamily
  label: string
  maturity: 'mvp' | 'beta' | 'planned'
  objectKinds: DatastoreExperienceObjectKind[]
  contextActions: DatastoreExperienceAction[]
  queryBuilders: DatastoreExperienceBuilder[]
  editableScopes: DatastoreEditableScope[]
  diagnosticsTabs: DatastoreDiagnosticsTab[]
  resultRenderers: ResultRenderer[]
  safetyRules: string[]
  tree?: DatastoreTreeManifest
  testTemplates: DatastoreTestTemplate[]
  testAssertions: DatastoreTestAssertionKind[]
  completeness?: DatastoreCompletenessSummary
}

export interface DatastoreExperienceResponse {
  experiences: DatastoreExperienceManifest[]
}

export type DataEditKind =
  | 'insert-row'
  | 'update-row'
  | 'delete-row'
  | 'set-field'
  | 'unset-field'
  | 'rename-field'
  | 'change-field-type'
  | 'insert-document'
  | 'set-key-value'
  | 'set-ttl'
  | 'delete-key'
  | 'rename-key'
  | 'persist-ttl'
  | 'hash-set-field'
  | 'hash-delete-field'
  | 'list-push'
  | 'list-set-index'
  | 'list-remove-value'
  | 'set-add-member'
  | 'set-remove-member'
  | 'zset-add-member'
  | 'zset-remove-member'
  | 'stream-add-entry'
  | 'stream-delete-entry'
  | 'json-set-path'
  | 'json-delete-path'
  | 'timeseries-add-sample'
  | 'timeseries-delete-sample'
  | 'vector-add-member'
  | 'vector-remove-member'
  | 'vector-set-attributes'
  | 'put-item'
  | 'update-item'
  | 'delete-item'
  | 'index-document'
  | 'update-document'
  | 'delete-document'

export interface DataEditTarget {
  objectKind: string
  path: string[]
  schema?: string
  table?: string
  collection?: string
  key?: string
  documentId?: unknown
  itemKey?: Record<string, unknown>
  primaryKey?: Record<string, unknown>
}

export interface DataEditChange {
  field?: string
  path?: string[]
  value?: unknown
  valueType?: string
  newName?: string
}

export interface DataEditPlanRequest {
  connectionId: string
  environmentId: string
  editKind: DataEditKind
  target: DataEditTarget
  changes: DataEditChange[]
}

export interface DataEditPlanResponse {
  connectionId: string
  environmentId: string
  editKind: DataEditKind
  executionSupport: DatastoreOperationExecutionSupport
  plan: OperationPlan
}

export interface DataEditExecutionRequest extends DataEditPlanRequest {
  confirmationText?: string
}

export interface DataEditExecutionResponse {
  connectionId: string
  environmentId: string
  editKind: DataEditKind
  executionSupport: DatastoreOperationExecutionSupport
  executed: boolean
  plan: OperationPlan
  messages: string[]
  warnings: string[]
  result?: ExecutionResultEnvelope
  metadata?: unknown
}

export interface OperationManifestRequest {
  connectionId: string
  environmentId: string
  scope?: string
}

export interface OperationManifestResponse {
  connectionId: string
  environmentId: string
  engine: DatastoreEngine
  operations: DatastoreOperationManifest[]
}

export interface OperationPlanRequest {
  connectionId: string
  environmentId: string
  operationId: string
  objectName?: string
  parameters?: Record<string, unknown>
}

export interface OperationPlanResponse {
  connectionId: string
  environmentId: string
  plan: OperationPlan
}

export interface OperationExecutionRequest {
  connectionId: string
  environmentId: string
  operationId: string
  objectName?: string
  parameters?: Record<string, unknown>
  confirmationText?: string
  rowLimit?: number
  tabId?: string
}

export interface OperationExecutionResponse {
  connectionId: string
  environmentId: string
  operationId: string
  executionSupport: DatastoreOperationExecutionSupport
  executed: boolean
  plan: OperationPlan
  result?: ExecutionResultEnvelope
  permissionInspection?: PermissionInspection
  diagnostics?: AdapterDiagnostics
  metadata?: unknown
  messages: string[]
  warnings: string[]
}

export interface PermissionInspectionRequest {
  connectionId: string
  environmentId: string
}

export interface PermissionInspectionResponse {
  connectionId: string
  environmentId: string
  inspection: PermissionInspection
}

export interface AdapterDiagnosticsRequest {
  connectionId: string
  environmentId: string
  scope?: string
}

export interface AdapterDiagnosticsResponse {
  connectionId: string
  environmentId: string
  diagnostics: AdapterDiagnostics
}

export interface ConnectionTestRequest {
  profile: ConnectionProfile
  environmentId: string
  secret?: string
}

export interface ConnectionTestResult {
  ok: boolean
  engine: DatastoreEngine
  message: string
  warnings: string[]
  resolvedHost: string
  resolvedDatabase?: string
  durationMs?: number
}

export interface ExplorerRequest {
  connectionId: string
  environmentId: string
  limit?: number
  scope?: string
}

export interface ExplorerResponse {
  connectionId: string
  environmentId: string
  scope?: string
  summary: string
  capabilities: ExecutionCapabilities
  nodes: ExplorerNode[]
}

export interface ExplorerInspectRequest {
  connectionId: string
  environmentId: string
  nodeId: string
}

export interface ExplorerInspectResponse {
  nodeId: string
  summary: string
  queryTemplate?: string
  payload?: unknown
}

export interface StructureRequest {
  connectionId: string
  environmentId: string
  limit?: number
  scope?: string
}

export interface StructureResponse {
  connectionId: string
  environmentId: string
  engine: DatastoreEngine
  summary: string
  groups: StructureGroup[]
  nodes: StructureNode[]
  edges: StructureEdge[]
  metrics: StructureMetric[]
  truncated?: boolean
  nextCursor?: string
}

export interface ExecutionRequest {
  executionId?: string
  tabId: string
  connectionId: string
  environmentId: string
  language: QueryLanguage
  queryText: string
  executionInputMode?: QueryViewMode
  scriptText?: string
  selectedText?: string
  mode?: QueryExecutionMode
  rowLimit?: number
  confirmedGuardrailId?: string
}

export interface ExecutionResponse {
  executionId: string
  tab: QueryTabState
  result?: ExecutionResultEnvelope
  guardrail: GuardrailDecision
  diagnostics: string[]
}

export interface ResultPageRequest {
  tabId: string
  connectionId: string
  environmentId: string
  language: QueryLanguage
  queryText: string
  selectedText?: string
  renderer: string
  pageSize?: number
  pageIndex?: number
  cursor?: string
}

export interface ResultPageResponse {
  tabId: string
  resultId?: string
  payload: ResultPayload
  pageInfo: ResultPageInfo
  notices: string[]
}

export interface RedisKeySummary {
  key: string
  type: string
  ttlSeconds?: number
  ttlLabel?: string
  memoryUsageBytes?: number
  memoryUsageLabel?: string
  length?: number
  encoding?: string
  idleSeconds?: number
  referenceCount?: number
  databaseIndex?: number
}

export interface RedisKeyScanRequest {
  tabId?: string
  connectionId: string
  environmentId: string
  databaseIndex?: number
  delimiter?: string
  pattern?: string
  typeFilter?: string
  cursor?: string
  count?: number
  pageSize?: number
  filters?: {
    ttl?: 'all' | 'expiring' | 'persistent'
    minBytes?: number
    maxBytes?: number
  }
}

export interface RedisKeyScanResponse {
  connectionId: string
  environmentId: string
  databaseIndex?: number
  cursor: string
  nextCursor?: string
  scannedCount: number
  keys: RedisKeySummary[]
  usedTypeFilterFallback: boolean
  moduleTypes: string[]
  warnings: string[]
}

export interface RedisKeyInspectRequest {
  tabId: string
  connectionId: string
  environmentId: string
  key: string
  sampleSize?: number
}

export interface CancelExecutionRequest {
  executionId: string
  tabId?: string
}

export interface CancelExecutionResult {
  ok: boolean
  supported: boolean
  message: string
}

export interface QueryTabReorderRequest {
  orderedTabIds: string[]
}

export interface CreateScopedQueryTabRequest {
  connectionId: string
  environmentId?: string
  target: ScopedQueryTarget
}

export interface CreateTestSuiteTabRequest {
  connectionId?: string
  environmentId?: string
  templateId?: string
  suite?: DatastoreTestSuiteDefinition
}

export interface UpdateTestSuiteTabRequest {
  tabId: string
  suite?: DatastoreTestSuiteDefinition
  rawText?: string
}

export interface ExecuteTestSuiteRequest {
  tabId: string
  caseId?: string
  confirmedGuardrailId?: string
}

export interface ExecuteTestSuiteResponse {
  tab: QueryTabState
  run: DatastoreTestRunResult
  diagnostics: string[]
}

export interface CancelTestRunRequest {
  runId: string
  tabId?: string
}

export interface OpenTestSuiteTemplateRequest {
  connectionId?: string
  environmentId?: string
  templateId: string
}

export interface UpdateQueryBuilderStateRequest {
  tabId: string
  builderState: QueryBuilderState
  queryText?: string
  queryViewMode?: QueryViewMode
}

export interface UpdateQueryTabRequest {
  tabId: string
  queryText: string
  queryViewMode?: QueryViewMode
}

export type LocalDatabaseCreateMode = 'empty' | 'starter'

export interface LocalDatabasePickRequest {
  engine: DatastoreEngine
  purpose: 'open' | 'create'
  currentPath?: string
}

export interface LocalDatabasePickResult {
  canceled: boolean
  path?: string
}

export interface LocalDatabaseCreateRequest {
  engine: DatastoreEngine
  path: string
  mode: LocalDatabaseCreateMode
  connectionId?: string
  environmentId?: string
}

export interface LocalDatabaseCreateResult {
  engine: DatastoreEngine
  path: string
  message: string
  warnings: string[]
}

export interface UpdateUiStateRequest {
  activeEnvironmentId?: string
  activeActivity?: UiActivity
  sidebarCollapsed?: boolean
  activeSidebarPane?: SidebarPane
  sidebarWidth?: number
  explorerFilter?: string
  explorerView?: 'tree' | 'structure'
  connectionGroupMode?: ConnectionGroupMode
  sidebarSectionStates?: Record<string, boolean>
  bottomPanelVisible?: boolean
  activeBottomPanelTab?: BottomPanelTab
  bottomPanelHeight?: number
  resultsDock?: ResultsDock
  resultsSideWidth?: number
  rightDrawer?: RightDrawerView
  rightDrawerWidth?: number
}
