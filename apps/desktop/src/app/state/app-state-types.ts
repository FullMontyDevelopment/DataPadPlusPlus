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
  DatastoreApiServerLogs,
  DatastoreApiServerLogsRequest,
  DatastoreApiServerMetrics,
  DatastoreApiServerAddResourcesRequest,
  DatastoreApiServerAddCustomEndpointRequest,
  DatastoreApiServerCreateRequest,
  DatastoreApiServerDeleteRequest,
  DatastoreApiServerProjectExportCapabilitiesRequest,
  DatastoreApiServerProjectExportCapabilitiesResponse,
  DatastoreApiServerProjectExportRequest,
  DatastoreApiServerProjectExportResponse,
  DatastoreApiServerQuerySourceDiscoveryRequest,
  DatastoreApiServerQuerySourceDiscoveryResponse,
  DatastoreApiServerRemoveCustomEndpointRequest,
  DatastoreApiServerResourceDiscoveryRequest,
  DatastoreApiServerResourceDiscoveryResponse,
  DatastoreApiServerRemoveResourceRequest,
  DatastoreApiServerSettingsRequest,
  DatastoreApiServerStartRequest,
  DatastoreApiServerStatus,
  DatastoreApiServerStopRequest,
  DatastoreApiServerUpdateCustomEndpointRequest,
  DatastoreApiServerUpdateRequest,
  DatastoreMcpClientSetupApplyRequest,
  DatastoreMcpClientSetupApplyResponse,
  DatastoreMcpClientSetupPreview,
  DatastoreMcpClientSetupRequest,
  DatastoreMcpServerCreateRequest,
  DatastoreMcpServerDeleteRequest,
  DatastoreMcpServerLogs,
  DatastoreMcpServerLogsRequest,
  DatastoreMcpServerMetrics,
  DatastoreMcpServerSettingsRequest,
  DatastoreMcpServerStartRequest,
  DatastoreMcpServerStatus,
  DatastoreMcpServerStopRequest,
  DatastoreMcpServerTokenCreateRequest,
  DatastoreMcpServerTokenCreateResponse,
  DatastoreMcpServerTokenDeleteRequest,
  DatastoreMcpServerUpdateRequest,
  DatastoreSecurityChecksRefreshRequest,
  DatastoreSecurityChecksSettingsRequest,
  DatastoreSecurityChecksStatus,
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
  ExplorerFolderOrderRequest,
  ExplorerInspectResponse,
  ExplorerRequest,
  ExplorerResponse,
  FirstInstallGuidePersistedStatus,
  FirstInstallGuideStepId,
  LibraryCreateFolderRequest,
  LibraryDeleteNodeRequest,
  LibraryDuplicateNodeRequest,
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
  QueryBuilderState,
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
  UpdateQueryTabTargetRequest,
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
  WorkspaceCreateRequest,
  WorkspaceRenameRequest,
  WorkspaceSearchSettingsRequest,
  WorkspaceSnapshot,
  WorkspaceSwitcherSettingsRequest,
  WorkspaceSwitcherStatus,
  WorkspaceSwitchRequest,
} from '@datapadplusplus/shared-types'
import type { ConnectionHealth, ConnectionHealthSource } from './connection-health'
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

export type AppErrorOptions = { suppressWorkbenchMessage?: boolean; openMessages?: boolean }

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
  structureRequestId?: string
  structureRequest?: StructureRequest
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
  workspaceSwitcherStatus?: WorkspaceSwitcherStatus
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
  | { type: 'STRUCTURE_LOADING'; request: StructureRequest; requestId: string }
  | { type: 'STRUCTURE_READY'; structure: StructureResponse; requestId: string }
  | { type: 'STRUCTURE_ERROR'; message: string; requestId: string }
  | { type: 'STRUCTURE_INVALIDATED'; connectionId: string; environmentId: string }
  | { type: 'EXECUTION_LOADING'; tabId?: string; execution: QueryTabActiveExecution }
  | { type: 'EXECUTION_PHASE'; tabId?: string; executionId: string; phase: QueryTabActiveExecution['phase']; message?: string }
  | { type: 'EXECUTION_DISPLAYED'; tabId?: string; executionId: string }
  | { type: 'EXECUTION_FAILED'; tabId?: string; executionId?: string; code?: string; message: string }
  | { type: 'EXECUTION_READY'; execution: ExecutionResponse; request: ExecutionRequest; waitForDisplay?: boolean }
  | { type: 'RESULT_PAGE_LOADING'; tabId: string; execution: QueryTabActiveExecution }
  | { type: 'RESULT_PAGE_READY'; page: ResultPageResponse; executionId?: string; waitForDisplay?: boolean }
  | { type: 'BOOTSTRAP_ERROR'; message: string }
  | { type: 'COMMAND_ERROR'; message: string; openMessages?: boolean }
  | { type: 'WORKBENCH_MESSAGE_ADDED'; message: WorkbenchMessage; openMessages?: boolean }
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
  | { type: 'WORKSPACE_SWITCHER_STATUS_READY'; status: WorkspaceSwitcherStatus }

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
  createApiServerTab(serverId?: string): Promise<void>
  createMcpServerTab(serverId?: string): Promise<void>
  createWorkspaceSearchTab(): Promise<void>
  createSecurityChecksTab(): Promise<void>
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
    documentEfficiencyMode?: boolean,
  ): Promise<void>
  updateQueryBuilderState(request: UpdateQueryBuilderStateRequest): Promise<void>
  updateQueryTarget(request: UpdateQueryTabTargetRequest): Promise<boolean>
  updateTestSuiteTab(request: UpdateTestSuiteTabRequest): Promise<void>
  renameTab(tabId: string, title: string): Promise<void>
  saveCurrentQuery(tabId: string): Promise<void>
  saveAndCloseTab(tabId: string): Promise<void>
  createLibraryFolder(request: LibraryCreateFolderRequest): Promise<void>
  renameLibraryNode(request: LibraryRenameNodeRequest): Promise<void>
  moveLibraryNode(request: LibraryMoveNodeRequest): Promise<void>
  setLibraryNodeEnvironment(request: LibrarySetEnvironmentRequest): Promise<void>
  deleteLibraryNode(request: LibraryDeleteNodeRequest): Promise<void>
  duplicateLibraryNode(request: LibraryDuplicateNodeRequest): Promise<void>
  openLibraryItem(libraryItemId: string): Promise<void>
  saveQueryTabToLibrary(request: SaveQueryTabToLibraryRequest): Promise<void>
  saveQueryTabToLocalFile(request: SaveQueryTabToLocalFileRequest): Promise<void>
  openSavedWork(savedWorkId: string): Promise<void>
  deleteSavedWork(savedWorkId: string): Promise<void>
  testConnection(
    profile: ConnectionProfile,
    environmentId: string,
    secret?: string,
  ): Promise<ConnectionTestResult | undefined>
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
    builderState?: QueryBuilderState,
  ): Promise<void>
  executeBuilderCount(request: {
    tabId: string; builderState: QueryBuilderState; queryText: string; countQueryText: string
  }): Promise<void>
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
  setFirstInstallGuideStatus(
    status: FirstInstallGuidePersistedStatus,
    currentStepId?: FirstInstallGuideStepId,
  ): Promise<void>
  setExplorerFolderOrder(request: ExplorerFolderOrderRequest): Promise<void>
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
  getWorkspaceSwitcherStatus(): Promise<WorkspaceSwitcherStatus | undefined>
  setWorkspaceSwitcherEnabled(request: WorkspaceSwitcherSettingsRequest): Promise<boolean>
  createWorkspace(request: WorkspaceCreateRequest): Promise<boolean>
  renameWorkspace(request: WorkspaceRenameRequest): Promise<boolean>
  switchWorkspace(request: WorkspaceSwitchRequest): Promise<boolean>
  updateWorkspaceBackupSettings(request: WorkspaceBackupSettingsRequest): Promise<boolean>
  updateWorkspaceSearchSettings(request: WorkspaceSearchSettingsRequest): Promise<boolean>
  getDatastoreSecurityCheckStatus(): Promise<DatastoreSecurityChecksStatus | undefined>
  updateDatastoreSecurityCheckSettings(
    request: DatastoreSecurityChecksSettingsRequest,
  ): Promise<boolean>
  refreshDatastoreSecurityChecks(
    request?: DatastoreSecurityChecksRefreshRequest,
  ): Promise<boolean>
  getDatastoreApiServerStatus(): Promise<DatastoreApiServerStatus | undefined>
  getDatastoreApiServerMetrics(): Promise<DatastoreApiServerMetrics | undefined>
  getDatastoreApiServerLogs(request?: DatastoreApiServerLogsRequest): Promise<DatastoreApiServerLogs | undefined>
  createDatastoreApiServer(request: DatastoreApiServerCreateRequest): Promise<boolean>
  updateDatastoreApiServer(request: DatastoreApiServerUpdateRequest): Promise<boolean>
  discoverDatastoreApiServerResources(
    request: DatastoreApiServerResourceDiscoveryRequest,
  ): Promise<DatastoreApiServerResourceDiscoveryResponse | undefined>
  discoverDatastoreApiServerQuerySources(
    request: DatastoreApiServerQuerySourceDiscoveryRequest,
  ): Promise<DatastoreApiServerQuerySourceDiscoveryResponse | undefined>
  addDatastoreApiServerResources(request: DatastoreApiServerAddResourcesRequest): Promise<boolean>
  removeDatastoreApiServerResource(request: DatastoreApiServerRemoveResourceRequest): Promise<boolean>
  addDatastoreApiServerCustomEndpoint(request: DatastoreApiServerAddCustomEndpointRequest): Promise<boolean>
  updateDatastoreApiServerCustomEndpoint(request: DatastoreApiServerUpdateCustomEndpointRequest): Promise<boolean>
  removeDatastoreApiServerCustomEndpoint(request: DatastoreApiServerRemoveCustomEndpointRequest): Promise<boolean>
  getDatastoreApiServerProjectExportCapabilities(
    request: DatastoreApiServerProjectExportCapabilitiesRequest,
  ): Promise<DatastoreApiServerProjectExportCapabilitiesResponse | undefined>
  exportDatastoreApiServerProjectFile(
    request: DatastoreApiServerProjectExportRequest,
  ): Promise<DatastoreApiServerProjectExportResponse | undefined>
  updateDatastoreApiServerSettings(request: DatastoreApiServerSettingsRequest): Promise<boolean>
  startDatastoreApiServer(request: DatastoreApiServerStartRequest): Promise<DatastoreApiServerStatus | undefined>
  stopDatastoreApiServer(request?: DatastoreApiServerStopRequest): Promise<DatastoreApiServerStatus | undefined>
  deleteDatastoreApiServer(request: DatastoreApiServerDeleteRequest): Promise<boolean>
  getDatastoreMcpServerStatus(): Promise<DatastoreMcpServerStatus | undefined>
  getDatastoreMcpServerMetrics(): Promise<DatastoreMcpServerMetrics | undefined>
  getDatastoreMcpServerLogs(request?: DatastoreMcpServerLogsRequest): Promise<DatastoreMcpServerLogs | undefined>
  createDatastoreMcpServer(request: DatastoreMcpServerCreateRequest): Promise<boolean>
  updateDatastoreMcpServer(request: DatastoreMcpServerUpdateRequest): Promise<boolean>
  updateDatastoreMcpServerSettings(request: DatastoreMcpServerSettingsRequest): Promise<boolean>
  startDatastoreMcpServer(request: DatastoreMcpServerStartRequest): Promise<DatastoreMcpServerStatus | undefined>
  stopDatastoreMcpServer(request?: DatastoreMcpServerStopRequest): Promise<DatastoreMcpServerStatus | undefined>
  deleteDatastoreMcpServer(request: DatastoreMcpServerDeleteRequest): Promise<boolean>
  createDatastoreMcpServerToken(
    request: DatastoreMcpServerTokenCreateRequest,
  ): Promise<DatastoreMcpServerTokenCreateResponse | undefined>
  deleteDatastoreMcpServerToken(
    request: DatastoreMcpServerTokenDeleteRequest,
  ): Promise<DatastoreMcpServerStatus | undefined>
  previewDatastoreMcpClientSetup(
    request: DatastoreMcpClientSetupRequest,
  ): Promise<DatastoreMcpClientSetupPreview | undefined>
  applyDatastoreMcpClientSetup(
    request: DatastoreMcpClientSetupApplyRequest,
  ): Promise<DatastoreMcpClientSetupApplyResponse | undefined>
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
  handleError(error: unknown, options?: AppErrorOptions): void
}
