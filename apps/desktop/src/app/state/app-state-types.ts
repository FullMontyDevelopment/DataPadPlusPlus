import type { Dispatch, MutableRefObject } from 'react'
import type {
  BootstrapPayload,
  CancelTestRunRequest,
  AppLogFileContent,
  AppLogFileSummary,
  AppShortcutId,
  AppUpdateCheckResult,
  AppUpdateDownloadEvent,
  AppUpdateSettings,
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
  DocumentNodeChildrenRequest,
  DocumentNodeChildrenResponse,
  EnvironmentProfile,
  ExecutionRequest,
  ExecutionResponse,
  ExportResultFileRequest,
  ExportResultFileResponse,
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
  QueryTabActiveExecution,
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
  WorkspaceBackupDeleteRequest,
  WorkspaceBackupRestoreRequest,
  WorkspaceBackupRunRequest,
  WorkspaceBackupRunResponse,
  WorkspaceBackupSettingsRequest,
  WorkspaceBackupSummary,
  WorkspaceBundleFileExportRequest,
  WorkspaceBundleFileExportResponse,
  WorkspaceBundleFileImportRequest,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import type {
  ConnectionHealth,
  ConnectionHealthSource,
} from './connection-health'

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

export interface ExplorerCacheEntry {
  connectionId: string
  environmentId: string
  response: ExplorerResponse
  scopes: Record<string, ExplorerResponse>
}

export interface StateShape {
  status: LoadStatus
  payload?: BootstrapPayload
  diagnostics?: DiagnosticsReport
  exportBundle?: ExportBundle
  explorerStatus: RemoteStatus
  explorer?: ExplorerResponse
  explorerCache?: Record<string, ExplorerCacheEntry>
  explorerLoadingRequests: Record<string, string>
  explorerError?: string
  explorerInspection?: ExplorerInspectResponse
  structureStatus: RemoteStatus
  structure?: StructureResponse
  structureError?: string
  executionStatus: RemoteStatus
  executionsByTab: Record<string, QueryTabActiveExecution>
  latestExecutionsByTab: Record<string, string>
  lastExecution?: ExecutionResponse
  lastExecutionRequest?: ExecutionRequest
  connectionTests: Record<string, ConnectionTestResult>
  connectionHealthByKey: Record<string, ConnectionHealth>
  startupErrorMessage?: string
  workbenchMessages: WorkbenchMessage[]
  appUpdateSettings?: AppUpdateSettings
  appUpdateCheckResult?: AppUpdateCheckResult
  appUpdateStatus: RemoteStatus
  appUpdateInstallStatus: 'idle' | 'installing' | 'installed' | 'error'
  appUpdateDownload?: {
    downloadedBytes: number
    contentLength?: number
  }
  appUpdateError?: string
}

export type AppAction =
  | { type: 'BOOTSTRAP_SUCCESS'; payload: BootstrapPayload }
  | { type: 'COMMAND_SUCCESS'; payload: BootstrapPayload }
  | { type: 'DIAGNOSTICS_READY'; diagnostics: DiagnosticsReport }
  | { type: 'EXPORT_READY'; exportBundle: ExportBundle }
  | { type: 'CONNECTION_TEST_READY'; profileId: string; result: ConnectionTestResult }
  | {
      type: 'CONNECTION_HEALTH_CHECKING'
      connectionId: string
      environmentId: string
      source: ConnectionHealthSource
      message?: string
      checkId?: string
    }
  | {
      type: 'CONNECTION_HEALTH_SETTLED'
      connectionId: string
      environmentId: string
      source: ConnectionHealthSource
      checkId?: string
    }
  | {
      type: 'CONNECTION_HEALTH_READY'
      connectionId: string
      environmentId: string
      source: ConnectionHealthSource
      result: ConnectionTestResult
      checkId?: string
    }
  | {
      type: 'CONNECTION_HEALTH_CONNECTED'
      connectionId: string
      environmentId: string
      source: ConnectionHealthSource
      message?: string
      durationMs?: number
    }
  | {
      type: 'CONNECTION_HEALTH_ISSUE'
      connectionId: string
      environmentId: string
      source: ConnectionHealthSource
      message: string
      warnings?: string[]
    }
  | { type: 'EXPLORER_LOADING'; request: ExplorerRequest; requestId: string }
  | { type: 'EXPLORER_READY'; explorer: ExplorerResponse; requestId: string }
  | { type: 'EXPLORER_ERROR'; request: ExplorerRequest; requestId?: string; message: string }
  | { type: 'EXPLORER_INSPECTION_READY'; inspection: ExplorerInspectResponse }
  | { type: 'STRUCTURE_LOADING' }
  | { type: 'STRUCTURE_READY'; structure: StructureResponse }
  | { type: 'STRUCTURE_ERROR'; message: string }
  | { type: 'EXECUTION_LOADING'; tabId?: string; execution: QueryTabActiveExecution }
  | { type: 'EXECUTION_PHASE'; tabId?: string; executionId: string; phase: QueryTabActiveExecution['phase']; message?: string }
  | { type: 'EXECUTION_DISPLAYED'; tabId?: string; executionId: string }
  | { type: 'EXECUTION_FAILED'; tabId?: string; executionId?: string; message: string }
  | { type: 'EXECUTION_READY'; execution: ExecutionResponse; request: ExecutionRequest; waitForDisplay?: boolean }
  | { type: 'RESULT_PAGE_LOADING'; tabId: string; execution: QueryTabActiveExecution }
  | { type: 'RESULT_PAGE_READY'; page: ResultPageResponse; executionId?: string; waitForDisplay?: boolean }
  | { type: 'BOOTSTRAP_ERROR'; message: string }
  | { type: 'COMMAND_ERROR'; message: string }
  | { type: 'WORKBENCH_MESSAGE_ADDED'; message: WorkbenchMessage }
  | { type: 'WORKBENCH_MESSAGES_OPENED' }
  | { type: 'WORKBENCH_MESSAGE_DISMISSED'; id: string }
  | { type: 'WORKBENCH_MESSAGES_CLEARED' }
  | { type: 'APP_UPDATE_SETTINGS_READY'; settings: AppUpdateSettings }
  | { type: 'APP_UPDATE_CHECKING' }
  | { type: 'APP_UPDATE_CHECK_READY'; result: AppUpdateCheckResult }
  | { type: 'APP_UPDATE_CHECK_ERROR'; message: string }
  | { type: 'APP_UPDATE_INSTALLING' }
  | { type: 'APP_UPDATE_DOWNLOAD_EVENT'; event: AppUpdateDownloadEvent }
  | { type: 'APP_UPDATE_INSTALLED' }
  | { type: 'APP_UPDATE_INSTALL_ERROR'; message: string }

export interface Actions {
  selectConnection(connectionId: string): Promise<void>
  selectTab(tabId: string): Promise<void>
  selectEnvironment(tabId: string, environmentId: string): Promise<void>
  createConnection(): Promise<void>
  duplicateConnection(connectionId: string): Promise<void>
  deleteConnection(connectionId: string): Promise<void>
  saveConnection(profile: ConnectionProfile, secret?: string): Promise<boolean>
  createEnvironment(): Promise<void>
  saveEnvironment(profile: EnvironmentProfile, secretDrafts?: Record<string, string>): Promise<boolean>
  deleteEnvironment(environmentId: string): Promise<void>
  createTab(connectionId: string): Promise<void>
  createExplorerTab(connectionId: string): Promise<void>
  createMetricsTab(connectionId: string, environmentId?: string): Promise<void>
  createEnvironmentTab(environmentId: string): Promise<void>
  createSettingsTab(): Promise<void>
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
    documentEfficiencyMode?: boolean,
    selectedText?: string,
  ): Promise<void>
  executeTestSuite(request: ExecuteTestSuiteRequest): Promise<ExecuteTestSuiteResponse | undefined>
  cancelTestRun(
    request: CancelTestRunRequest,
  ): Promise<{ ok: boolean; supported: boolean; message: string } | undefined>
  fetchResultPage(tabId: string, renderer?: string): Promise<void>
  fetchDocumentNodeChildren(
    request: DocumentNodeChildrenRequest,
  ): Promise<DocumentNodeChildrenResponse | undefined>
  markExecutionDisplayed(tabId: string, executionId: string): void
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
  setSafeModeEnabled(enabled: boolean): Promise<void>
  setKeyboardShortcut(shortcutId: AppShortcutId, shortcut: string): Promise<void>
  updateUiState(patch: UpdateUiStateRequest): Promise<void>
  refreshDiagnostics(): Promise<void>
  listAppLogFiles(): Promise<AppLogFileSummary[] | undefined>
  readAppLogFile(fileName: string): Promise<AppLogFileContent | undefined>
  clearAppLogFile(fileName: string): Promise<AppLogFileContent | undefined>
  deleteAppLogFile(fileName: string): Promise<AppLogFileSummary[] | undefined>
  exportResultFile(
    request: ExportResultFileRequest,
  ): Promise<ExportResultFileResponse | undefined>
  exportWorkspace(passphrase: string, includeSecrets?: boolean): Promise<void>
  importWorkspace(passphrase: string, encryptedPayload: string): Promise<void>
  exportWorkspaceFile(
    request: WorkspaceBundleFileExportRequest,
  ): Promise<WorkspaceBundleFileExportResponse | undefined>
  importWorkspaceFile(request: WorkspaceBundleFileImportRequest): Promise<void>
  updateWorkspaceBackupSettings(request: WorkspaceBackupSettingsRequest): Promise<boolean>
  listWorkspaceBackups(): Promise<WorkspaceBackupSummary[] | undefined>
  createWorkspaceBackupNow(
    request: WorkspaceBackupRunRequest,
  ): Promise<WorkspaceBackupRunResponse | undefined>
  restoreWorkspaceBackup(request: WorkspaceBackupRestoreRequest): Promise<void>
  deleteWorkspaceBackup(
    request: WorkspaceBackupDeleteRequest,
  ): Promise<WorkspaceBackupSummary[] | undefined>
  getAppUpdateSettings(): Promise<AppUpdateSettings | undefined>
  setAppUpdateSettings(includePrereleases: boolean): Promise<void>
  checkAppUpdate(): Promise<AppUpdateCheckResult | undefined>
  installAppUpdate(): Promise<void>
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
