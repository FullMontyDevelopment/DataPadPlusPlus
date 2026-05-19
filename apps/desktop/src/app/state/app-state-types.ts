import type { Dispatch, MutableRefObject } from 'react'
import type {
  BootstrapPayload,
  CancelTestRunRequest,
  ConnectionProfile,
  ConnectionTestResult,
  CreateObjectViewTabRequest,
  CreateScopedQueryTabRequest,
  CreateTestSuiteTabRequest,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  DataEditPlanRequest,
  DataEditPlanResponse,
  DiagnosticsReport,
  EnvironmentProfile,
  ExecutionRequest,
  ExecutionResponse,
  ExecuteTestSuiteRequest,
  ExecuteTestSuiteResponse,
  ExportBundle,
  ExplorerInspectResponse,
  ExplorerRequest,
  ExplorerResponse,
  LibraryCreateFolderRequest,
  LibraryDeleteNodeRequest,
  LibraryMoveNodeRequest,
  LibraryRenameNodeRequest,
  LibrarySetEnvironmentRequest,
  LocalDatabaseCreateRequest,
  LocalDatabaseCreateResult,
  LocalDatabasePickRequest,
  LocalDatabasePickResult,
  OperationExecutionRequest,
  OperationExecutionResponse,
  OperationManifestRequest,
  OperationManifestResponse,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryViewMode,
  RedisKeyInspectRequest,
  RedisKeyScanRequest,
  RedisKeyScanResponse,
  ResultPageResponse,
  SaveQueryTabToLibraryRequest,
  SaveQueryTabToLocalFileRequest,
  StructureRequest,
  StructureResponse,
  UpdateTestSuiteTabRequest,
  UpdateQueryBuilderStateRequest,
  UpdateUiStateRequest,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'

export type LoadStatus = 'booting' | 'ready' | 'error'
export type RemoteStatus = 'idle' | 'loading' | 'ready'

export type WorkbenchMessageSeverity = 'error' | 'warning' | 'info'

export interface WorkbenchMessage {
  id: string
  severity: WorkbenchMessageSeverity
  message: string
  source: string
  createdAt: string
  details?: string
}

export interface StateShape {
  status: LoadStatus
  payload?: BootstrapPayload
  diagnostics?: DiagnosticsReport
  exportBundle?: ExportBundle
  explorerStatus: RemoteStatus
  explorer?: ExplorerResponse
  explorerError?: string
  explorerInspection?: ExplorerInspectResponse
  structureStatus: RemoteStatus
  structure?: StructureResponse
  structureError?: string
  executionStatus: RemoteStatus
  lastExecution?: ExecutionResponse
  lastExecutionRequest?: ExecutionRequest
  connectionTests: Record<string, ConnectionTestResult>
  startupErrorMessage?: string
  workbenchMessages: WorkbenchMessage[]
}

export type AppAction =
  | { type: 'BOOTSTRAP_SUCCESS'; payload: BootstrapPayload }
  | { type: 'COMMAND_SUCCESS'; payload: BootstrapPayload }
  | { type: 'DIAGNOSTICS_READY'; diagnostics: DiagnosticsReport }
  | { type: 'EXPORT_READY'; exportBundle: ExportBundle }
  | { type: 'CONNECTION_TEST_READY'; profileId: string; result: ConnectionTestResult }
  | { type: 'EXPLORER_LOADING' }
  | { type: 'EXPLORER_READY'; explorer: ExplorerResponse }
  | { type: 'EXPLORER_ERROR'; message: string }
  | { type: 'EXPLORER_INSPECTION_READY'; inspection: ExplorerInspectResponse }
  | { type: 'STRUCTURE_LOADING' }
  | { type: 'STRUCTURE_READY'; structure: StructureResponse }
  | { type: 'STRUCTURE_ERROR'; message: string }
  | { type: 'EXECUTION_LOADING'; tabId?: string }
  | { type: 'EXECUTION_FAILED'; tabId?: string; message: string }
  | { type: 'EXECUTION_READY'; execution: ExecutionResponse; request: ExecutionRequest }
  | { type: 'RESULT_PAGE_READY'; page: ResultPageResponse }
  | { type: 'BOOTSTRAP_ERROR'; message: string }
  | { type: 'COMMAND_ERROR'; message: string }
  | { type: 'WORKBENCH_MESSAGE_ADDED'; message: WorkbenchMessage }
  | { type: 'WORKBENCH_MESSAGES_OPENED' }
  | { type: 'WORKBENCH_MESSAGE_DISMISSED'; id: string }
  | { type: 'WORKBENCH_MESSAGES_CLEARED' }

export interface Actions {
  selectConnection(connectionId: string): Promise<void>
  selectTab(tabId: string): Promise<void>
  selectEnvironment(tabId: string, environmentId: string): Promise<void>
  createConnection(): Promise<void>
  duplicateConnection(connectionId: string): Promise<void>
  deleteConnection(connectionId: string): Promise<void>
  saveConnection(profile: ConnectionProfile, secret?: string): Promise<boolean>
  createEnvironment(): Promise<void>
  saveEnvironment(profile: EnvironmentProfile): Promise<void>
  deleteEnvironment(environmentId: string): Promise<void>
  createTab(connectionId: string): Promise<void>
  createExplorerTab(connectionId: string): Promise<void>
  createMetricsTab(connectionId: string, environmentId?: string): Promise<void>
  refreshMetricsTab(tabId: string): Promise<void>
  createObjectViewTab(request: CreateObjectViewTabRequest): Promise<void>
  refreshObjectViewTab(tabId: string): Promise<void>
  createTestSuiteTab(request: CreateTestSuiteTabRequest): Promise<void>
  createScopedTab(request: CreateScopedQueryTabRequest): Promise<void>
  closeTab(tabId: string): Promise<void>
  reopenClosedTab(closedTabId: string): Promise<void>
  reorderTabs(orderedTabIds: string[]): Promise<void>
  updateQuery(
    tabId: string,
    queryText: string,
    queryViewMode?: QueryViewMode,
  ): Promise<void>
  updateQueryBuilderState(request: UpdateQueryBuilderStateRequest): Promise<void>
  updateTestSuiteTab(request: UpdateTestSuiteTabRequest): Promise<void>
  renameTab(tabId: string, title: string): Promise<void>
  saveCurrentQuery(tabId: string): Promise<void>
  saveAndCloseTab(tabId: string): Promise<void>
  createLibraryFolder(request: LibraryCreateFolderRequest): Promise<void>
  renameLibraryNode(request: LibraryRenameNodeRequest): Promise<void>
  moveLibraryNode(request: LibraryMoveNodeRequest): Promise<void>
  setLibraryNodeEnvironment(request: LibrarySetEnvironmentRequest): Promise<void>
  deleteLibraryNode(request: LibraryDeleteNodeRequest): Promise<void>
  openLibraryItem(libraryItemId: string): Promise<void>
  saveQueryTabToLibrary(request: SaveQueryTabToLibraryRequest): Promise<void>
  saveQueryTabToLocalFile(request: SaveQueryTabToLocalFileRequest): Promise<void>
  openSavedWork(savedWorkId: string): Promise<void>
  deleteSavedWork(savedWorkId: string): Promise<void>
  testConnection(
    profile: ConnectionProfile,
    environmentId: string,
    secret?: string,
  ): Promise<void>
  loadExplorer(request: ExplorerRequest): Promise<void>
  loadStructureMap(request: StructureRequest): Promise<void>
  inspectExplorer(
    request: Pick<ExplorerRequest, 'connectionId' | 'environmentId'> & { nodeId: string },
  ): Promise<void>
  scanRedisKeys(request: RedisKeyScanRequest): Promise<RedisKeyScanResponse | undefined>
  inspectRedisKey(request: RedisKeyInspectRequest): Promise<void>
  executeQuery(
    tabId: string,
    mode?: ExecutionRequest['mode'],
    confirmedGuardrailId?: string,
    overrideQueryText?: string,
    executionInputMode?: ExecutionRequest['executionInputMode'],
    scriptText?: string,
  ): Promise<void>
  executeTestSuite(request: ExecuteTestSuiteRequest): Promise<ExecuteTestSuiteResponse | undefined>
  cancelTestRun(
    request: CancelTestRunRequest,
  ): Promise<{ ok: boolean; supported: boolean; message: string } | undefined>
  fetchResultPage(tabId: string, renderer?: string): Promise<void>
  cancelExecution(executionId: string, tabId?: string): Promise<void>
  pickLocalDatabaseFile(request: LocalDatabasePickRequest): Promise<LocalDatabasePickResult>
  createLocalDatabase(
    request: LocalDatabaseCreateRequest,
  ): Promise<LocalDatabaseCreateResult | undefined>
  listDatastoreOperations(
    request: OperationManifestRequest,
  ): Promise<OperationManifestResponse | undefined>
  planDatastoreOperation(
    request: OperationPlanRequest,
  ): Promise<OperationPlanResponse | undefined>
  executeDatastoreOperation(
    request: OperationExecutionRequest,
  ): Promise<OperationExecutionResponse | undefined>
  planDataEdit(request: DataEditPlanRequest): Promise<DataEditPlanResponse | undefined>
  executeDataEdit(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
  openWorkbenchMessages(): void
  dismissWorkbenchMessage(id: string): void
  clearWorkbenchMessages(): void
  setTheme(theme: WorkspaceSnapshot['preferences']['theme']): Promise<void>
  updateUiState(patch: UpdateUiStateRequest): Promise<void>
  refreshDiagnostics(): Promise<void>
  exportWorkspace(passphrase: string): Promise<void>
  importWorkspace(passphrase: string, encryptedPayload: string): Promise<void>
}

export interface AppContextValue extends StateShape {
  activeConnection?: ConnectionProfile
  activeEnvironment?: EnvironmentProfile
  actions: Actions
}

export interface AppActionContext {
  state: StateShape
  stateRef: MutableRefObject<StateShape>
  dispatch: Dispatch<AppAction>
  applyPayload(payload: BootstrapPayload): void
  handleError(error: unknown): void
}
