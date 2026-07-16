import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MutableRefObject } from 'react'
import type {
  ConnectionProfile,
  DatastoreApiServerInstanceStatus,
  DatastoreApiServerResourceConfig,
  DatastoreApiServerStatus,
  DatastoreMcpServerInstanceStatus,
  DatastoreMcpServerStatus,
  EnvironmentProfile,
  ExecutionRequest,
  ExplorerNode,
  AppShortcutId,
  LibraryItemKind,
  LibraryNode,
  OperationPlan,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryBuilderState,
  QueryTabState,
  QueryViewMode,
  ScopedQueryTarget,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { ErrorBoundary } from './components/ErrorBoundary'
import {
  CloseSavedTabDialog,
  DeleteConnectionDialog,
  DeleteEnvironmentDialog,
  DeleteLibraryNodeDialog,
  SaveQueryDialog,
} from './components/workbench/AppDialogs'
import { BootSurface, WelcomeSurface } from './components/workbench/BootSurfaces'
import { DesktopCodeEditor } from './components/workbench/DesktopCodeEditor'
import { EditorTabs } from './components/workbench/EditorTabs'
import { EditorToolbar } from './components/workbench/EditorToolbar'
import { FirstInstallGuide } from './components/workbench/FirstInstallGuide'
import { comparableEnvironment } from './components/workbench/EnvironmentWorkspace.helpers'
import { useReviewConfirmation } from './components/workbench/use-review-confirmation'
import { RedisConsoleEditor } from './components/workbench/datastores/common/keyvalue/RedisConsoleEditor'
import { StatusBar } from './components/workbench/StatusBar'
import type { SettingsSection } from './components/workbench/SettingsWorkspace.constants'
import {
  buildCqlPartitionQueryText,
  isCqlPartitionBuilderState,
} from './components/workbench/query-builder/cql-partition'
import {
  buildDynamoDbKeyConditionQueryText,
  isDynamoDbKeyConditionBuilderState,
} from './components/workbench/query-builder/dynamodb-key-condition'
import {
  buildMongoFindQueryText,
  isMongoFindBuilderState,
} from './components/workbench/query-builder/mongo-find'
import {
  buildMongoAggregationQueryText,
  isMongoAggregationBuilderState,
} from './components/workbench/query-builder/mongo-aggregation'
import {
  buildSqlSelectQueryText,
  isSqlSelectBuilderState,
} from './components/workbench/query-builder/sql-select'
import {
  buildSearchDslQueryText,
  isSearchDslBuilderState,
} from './components/workbench/query-builder/search-dsl'
import {
  isRedisKeyBrowserState,
} from './components/workbench/query-builder/redis-key-browser'
import {
  isRedisConsoleTab,
  redisConsoleCommandFromQueryText,
} from './components/workbench/query-builder/redis-console'
import { mongoQueryScopeForTab } from './components/workbench/query-builder/mongo-query-scope'
import {
  ENVIRONMENT_VARIABLE_COMPLETION_PROVIDER,
  completionProvidersForConnection,
} from './components/workbench/intellisense/providers'
import { useQueryIntellisenseCatalog } from './components/workbench/intellisense/useQueryIntellisenseCatalog'
import { SavedWorkIcon } from './components/workbench/icons'
import { AppStateProvider, useAppState } from './state/app-state'
import type { Actions } from './state/app-state-types'
import {
  explorerCacheKey,
  hasExplorerScope,
  isExplorerRequestLoading,
} from './state/app-state-reducer-helpers'
import { connectionUsesManagedOracleRuntime } from './state/oracle-runtime'
import {
  connectionHealthKey,
  connectionHealthToConnectionTest,
} from './state/connection-health'
import { ConnectionHealthChip } from './components/workbench/ConnectionHealthBadge'
import { connectionLibraryNodeId } from '../services/runtime/library-connection-helpers'
import { createConnectionProfile, createEnvironmentProfile } from './state/app-state-factories'
import {
  resolveKeyboardShortcuts,
  shortcutMatchesEvent,
} from './keyboard-shortcuts'
import { normalizeQueryWindowMode } from './query-window-mode'
import {
  appendFieldToQueryText,
  builderStateForTab,
  defaultCapabilities,
  deriveCapabilities,
  defaultScriptTextForConnection,
  queryBuilderObjectOptions,
  resolveThemeMode,
  selectPayload,
} from './workspace-helpers'

const BottomPanel = lazy(() =>
  import('./components/workbench/BottomPanel').then((module) => ({
    default: module.BottomPanel,
  })),
)
const EnvironmentWorkspace = lazy(() =>
  import('./components/workbench/EnvironmentWorkspace').then((module) => ({
    default: module.EnvironmentWorkspace,
  })),
)
const ApiServerWorkspace = lazy(() =>
  import('./components/workbench/ApiServerWorkspace').then((module) => ({
    default: module.ApiServerWorkspace,
  })),
)
const McpServerWorkspace = lazy(() =>
  import('./components/workbench/McpServerWorkspace').then((module) => ({
    default: module.McpServerWorkspace,
  })),
)
const WorkspaceSearchWorkspace = lazy(() =>
  import('./components/workbench/WorkspaceSearchWorkspace').then((module) => ({
    default: module.WorkspaceSearchWorkspace,
  })),
)
const SecurityChecksWorkspace = lazy(() =>
  import('./components/workbench/SecurityChecksWorkspace').then((module) => ({
    default: module.SecurityChecksWorkspace,
  })),
)
const MetricsWorkspace = lazy(() =>
  import('./components/workbench/MetricsWorkspace').then((module) => ({
    default: module.MetricsWorkspace,
  })),
)
const ObjectViewWorkspace = lazy(() =>
  import('./components/workbench/ObjectViewWorkspace').then((module) => ({
    default: module.ObjectViewWorkspace,
  })),
)
const QueryBuilderPanel = lazy(() =>
  import('./components/workbench/query-builder/QueryBuilderPanel').then((module) => ({
    default: module.QueryBuilderPanel,
  })),
)
const RightDrawer = lazy(() =>
  import('./components/workbench/RightDrawer').then((module) => ({
    default: module.RightDrawer,
  })),
)
const SideBar = lazy(() =>
  import('./components/workbench/SideBar').then((module) => ({
    default: module.SideBar,
  })),
)
const SettingsWorkspace = lazy(() =>
  import('./components/workbench/SettingsWorkspace').then((module) => ({
    default: module.SettingsWorkspace,
  })),
)
const StructureWorkspace = lazy(() =>
  import('./components/workbench/StructureWorkspace').then((module) => ({
    default: module.StructureWorkspace,
  })),
)
const TestSuiteWorkspace = lazy(() =>
  import('./components/workbench/TestSuiteWorkspace').then((module) => ({
    default: module.TestSuiteWorkspace,
  })),
)

const EMPTY_STRING_ARRAY: string[] = []

export function App() {
  return (
    <ErrorBoundary>
      <AppStateProvider>
        <DesktopWorkspace />
      </AppStateProvider>
    </ErrorBoundary>
  )
}

function WorkbenchPaneFallback() {
  return (
    <div className="editor-empty-state" role="status">
      Loading...
    </div>
  )
}

function SidebarFallback() {
  return (
    <aside className="workbench-sidebar" aria-label="Loading Library">
      <div className="sidebar-empty" role="status">
        Loading...
      </div>
    </aside>
  )
}

function operationReviewReasons(plan: OperationPlan) {
  const reasons = [
    ...plan.warnings.filter((warning) => !mentionsConfirmationText(warning, plan.confirmationText)),
    plan.destructive ? 'This operation can make destructive changes.' : undefined,
    plan.estimatedScanImpact,
    plan.estimatedCost,
    plan.requiredPermissions.length
      ? `Required permissions: ${plan.requiredPermissions.join(', ')}`
      : undefined,
  ]

  return uniqueStrings(reasons.filter((reason): reason is string => Boolean(reason))).slice(0, 4)
}

function operationPlanWithWarning(response: OperationPlanResponse, warning: string) {
  return {
    ...response,
    plan: {
      ...response.plan,
      warnings: uniqueStrings([
        ...response.plan.warnings.filter(
          (item) => !mentionsConfirmationText(item, response.plan.confirmationText),
        ),
        warning,
      ]),
    },
  }
}

function operationExecutionPlanResponse(
  fallback: OperationPlanResponse,
  execution: Awaited<ReturnType<Actions['executeDatastoreOperation']>>,
) {
  if (!execution) {
    return operationPlanWithWarning(fallback, 'Operation execution did not return a response.')
  }

  const warnings = execution.warnings.filter(
    (warning) => !mentionsConfirmationText(warning, execution.plan.confirmationText),
  )
  const summary = execution.executed
    ? execution.messages.at(-1) ?? 'Operation executed successfully.'
    : warnings.at(-1) ?? execution.messages.at(-1) ?? 'Operation was not applied.'

  return {
    connectionId: execution.connectionId,
    environmentId: execution.environmentId,
    plan: {
      ...execution.plan,
      summary,
      warnings: uniqueStrings([
        ...execution.plan.warnings.filter(
          (warning) => !mentionsConfirmationText(warning, execution.plan.confirmationText),
        ),
        ...warnings,
      ]),
    },
  }
}

function isMongoManagementOperation(operationId: string) {
  return operationId === 'mongodb.database.create' ||
    operationId === 'mongodb.database.drop' ||
    operationId === 'mongodb.collection.create' ||
    operationId === 'mongodb.collection.drop' ||
    operationId === 'mongodb.collection.rename' ||
    operationId === 'mongodb.collection.modify' ||
    operationId === 'mongodb.collection.convert-to-capped' ||
    operationId === 'mongodb.collection.clone-as-capped' ||
    operationId === 'mongodb.collection.compact' ||
    operationId === 'mongodb.collection.validate'
}

function mongoManagementRefreshScopes(request: OperationPlanRequest) {
  const parameters = request.parameters ?? {}
  const database = stringParameter(parameters.database)
  const targetDatabase = stringParameter(parameters.targetDatabase)
  const scopes = new Set<string>()
  scopes.add('databases')
  scopes.add('system-databases')

  for (const name of [database, targetDatabase].filter(Boolean)) {
    scopes.add(`database:${name}`)
    scopes.add(`collections:${name}`)
    scopes.add(`time-series-collections:${name}`)
    scopes.add(`capped-collections:${name}`)
    scopes.add(`views:${name}`)
  }

  return [...scopes]
}

function stringParameter(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function mentionsConfirmationText(message: string, confirmationText?: string) {
  return Boolean(
    confirmationText &&
      (message.includes(`Type \`${confirmationText}\``) || message.includes(confirmationText)),
  )
}

function uniqueStrings(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index)
}

function GlobalShortcutHandler({
  actions,
  activeConnectionId,
  activeTab,
  activeTabIsEnvironment,
  activeTabIsApiServer,
  activeTabIsMcpServer,
  activeTabIsSecurityChecks,
  activeTabIsExplorer,
  activeTabIsMetrics,
  activeTabIsObjectView,
  activeTabIsSettings,
  activeTabIsTestSuite,
  activeTabIsWorkspaceSearch,
  bottomPanelVisibleRef,
  keyboardShortcuts,
  openQueryTab,
  requestCloseTab,
  requestSaveQuery,
  runCurrentTabQuery,
  snapshot,
}: {
  actions: Pick<Actions, 'reopenClosedTab' | 'updateUiState'>
  activeConnectionId?: string
  activeTab?: QueryTabState
  activeTabIsEnvironment: boolean
  activeTabIsApiServer: boolean
  activeTabIsMcpServer: boolean
  activeTabIsSecurityChecks: boolean
  activeTabIsExplorer: boolean
  activeTabIsMetrics: boolean
  activeTabIsObjectView: boolean
  activeTabIsSettings: boolean
  activeTabIsTestSuite: boolean
  activeTabIsWorkspaceSearch: boolean
  bottomPanelVisibleRef: MutableRefObject<boolean>
  keyboardShortcuts: Record<AppShortcutId, string>
  openQueryTab(connectionId: string | undefined): void
  requestCloseTab(tabId: string): void
  requestSaveQuery(tabId: string): void
  runCurrentTabQuery(mode?: ExecutionRequest['mode']): void
  snapshot: WorkspaceSnapshot
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (shortcutMatchesEvent(event, keyboardShortcuts.refresh)) {
        event.preventDefault()

        if (activeTab && !activeTabIsExplorer && !activeTabIsEnvironment && !activeTabIsSettings && !activeTabIsApiServer && !activeTabIsMcpServer && !activeTabIsWorkspaceSearch && !activeTabIsSecurityChecks) {
          runCurrentTabQuery()
        }

        return
      }

      if (!activeTab) {
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.saveQuery)) {
        event.preventDefault()
        if (!activeTabIsExplorer && !activeTabIsMetrics && !activeTabIsObjectView && !activeTabIsSettings && !activeTabIsApiServer && !activeTabIsMcpServer && !activeTabIsWorkspaceSearch && !activeTabIsSecurityChecks) {
          requestSaveQuery(activeTab.id)
        }
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.runQuery)) {
        event.preventDefault()
        if (!activeTabIsExplorer && !activeTabIsEnvironment && !activeTabIsSettings && !activeTabIsApiServer && !activeTabIsMcpServer && !activeTabIsWorkspaceSearch && !activeTabIsSecurityChecks) {
          runCurrentTabQuery()
        }
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.togglePanel)) {
        event.preventDefault()
        const bottomPanelVisible = !bottomPanelVisibleRef.current
        bottomPanelVisibleRef.current = bottomPanelVisible
        void actions.updateUiState({
          bottomPanelVisible,
        })
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.toggleSidebar)) {
        event.preventDefault()
        void actions.updateUiState({
          sidebarCollapsed: !snapshot.ui.sidebarCollapsed,
        })
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.newQuery)) {
        event.preventDefault()
        openQueryTab(activeConnectionId)
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.closeTab)) {
        event.preventDefault()
        requestCloseTab(activeTab.id)
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.reopenClosedTab)) {
        event.preventDefault()
        const closedTab = snapshot.closedTabs.at(-1)
        if (closedTab) {
          void actions.reopenClosedTab(closedTab.id)
        }
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.explainQuery)) {
        event.preventDefault()
        if (
          !activeTabIsExplorer &&
          !activeTabIsMetrics &&
          !activeTabIsObjectView &&
          !activeTabIsTestSuite &&
          !activeTabIsEnvironment &&
          !activeTabIsSettings &&
          !activeTabIsApiServer &&
          !activeTabIsMcpServer &&
          !activeTabIsWorkspaceSearch &&
          !activeTabIsSecurityChecks
        ) {
          runCurrentTabQuery('explain')
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    actions,
    activeConnectionId,
    activeTab,
    activeTabIsApiServer,
    activeTabIsMcpServer,
    activeTabIsSecurityChecks,
    activeTabIsEnvironment,
    activeTabIsExplorer,
    activeTabIsMetrics,
    activeTabIsObjectView,
    activeTabIsSettings,
    activeTabIsTestSuite,
    activeTabIsWorkspaceSearch,
    bottomPanelVisibleRef,
    keyboardShortcuts,
    openQueryTab,
    requestCloseTab,
    requestSaveQuery,
    runCurrentTabQuery,
    snapshot,
  ])

  return null
}

function DesktopWorkspace() {
  const {
    status,
    payload,
    diagnostics,
    exportBundle,
    explorerCache,
    explorerError,
    explorerInspection,
    explorerLoadingRequests,
    explorerStatus,
    structure,
    structureError,
    structureStatus,
    executionsByTab,
    lastExecution,
    lastExecutionRequest,
    connectionTests,
    connectionHealthByKey,
    startupErrorMessage,
    workbenchMessages,
    appUpdateCheckResult,
    appUpdateDownload,
    appUpdateError,
    appUpdateInstallStatus,
    appUpdateSettings,
    appUpdateStatus,
    workspaceSwitcherStatus,
    actions,
  } = useAppState()
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [importPayload, setImportPayload] = useState('')
  const [rendererPreference, setRendererPreference] = useState<{
    renderer?: string
    tabId?: string
  }>({})
  const [queryWindowMode, setQueryWindowMode] = useState<QueryViewMode>('raw')
  const [testWindowMode, setTestWindowMode] = useState<'both' | 'builder' | 'raw'>('both')
  const [settingsInitialSectionRequest, setSettingsInitialSectionRequest] = useState<{
    revision: number
    section: SettingsSection
  }>({ revision: 0, section: 'appearance' })
  const [guideStartRequestRevision, setGuideStartRequestRevision] = useState(0)
  const [guideFolderDialogRequestRevision, setGuideFolderDialogRequestRevision] = useState(0)
  const [guideFolderDialogCloseRequestRevision, setGuideFolderDialogCloseRequestRevision] = useState(0)
  const [connectionDraft, setConnectionDraft] = useState<ConnectionProfile | undefined>()
  const [connectionDraftParentId, setConnectionDraftParentId] = useState<string | undefined>()
  const [environmentDrafts, setEnvironmentDrafts] = useState<
    Record<string, EnvironmentProfile>
  >({})
  const [environmentSecretDrafts, setEnvironmentSecretDrafts] = useState<
    Record<string, Record<string, string>>
  >({})
  const initializedQueryModeByTabRef = useRef<Record<string, string>>({})
  const lastActiveQueryModeSyncKeyRef = useRef<string | undefined>(undefined)
  const oracleIntellisenseLoadRef = useRef<string | undefined>(undefined)
  const queryWindowModeByTabRef = useRef<Record<string, QueryViewMode>>({})
  const environmentDraftsRef = useRef<Record<string, EnvironmentProfile>>({})
  const environmentSecretDraftsRef = useRef<Record<string, Record<string, string>>>({})
  const builderStateDraftRef = useRef<Record<string, QueryBuilderState>>({})
  const [builderStateDrafts, setBuilderStateDrafts] = useState<
    Record<string, QueryBuilderState>
  >({})
  const queryTextDraftRef = useRef<Record<string, string>>({})
  const scriptTextDraftRef = useRef<Record<string, string>>({})
  const queryTextDraftSyncTimersRef = useRef<Record<string, number>>({})
  const scriptTextDraftSyncTimersRef = useRef<Record<string, number>>({})
  const [queryTextDrafts, setQueryTextDrafts] = useState<Record<string, string>>({})
  const [scriptTextDrafts, setScriptTextDrafts] = useState<Record<string, string>>({})
  const [editorResetRevisions, setEditorResetRevisions] = useState<Record<string, number>>({})
  const editorSelectionDraftRef = useRef<Record<string, string>>({})
  const [editorSelectionDrafts, setEditorSelectionDrafts] = useState<Record<string, string>>({})
  const [redisBrowserRefreshSignals, setRedisBrowserRefreshSignals] = useState<Record<string, number>>({})
  const [apiServerStatus, setApiServerStatus] = useState<DatastoreApiServerStatus>()
  const [mcpServerStatus, setMcpServerStatus] = useState<DatastoreMcpServerStatus>()
  const [pendingTabClose, setPendingTabClose] = useState<
    | {
        tab: QueryTabState
        remainingTabIds: string[]
      }
    | undefined
  >()
  const [pendingSaveTabId, setPendingSaveTabId] = useState<string>()
  const [pendingConnectionDelete, setPendingConnectionDelete] = useState<
    ConnectionProfile | undefined
  >()
  const [pendingLibraryNodeDelete, setPendingLibraryNodeDelete] = useState<
    LibraryNode | undefined
  >()
  const [pendingEnvironmentDelete, setPendingEnvironmentDelete] = useState<
    EnvironmentProfile | undefined
  >()
  const bottomPanelVisibleRef = useRef(false)
  const promptedGuardrailRef = useRef<string | undefined>(undefined)
  const { confirmReview, reviewConfirmationDialog } = useReviewConfirmation()
  useEffect(() => {
    if (!payload) {
      return
    }

    const theme = resolveThemeMode(payload.snapshot.preferences.theme)
    document.documentElement.dataset.theme = theme
  }, [payload])

  useEffect(() => {
    builderStateDraftRef.current = builderStateDrafts
  }, [builderStateDrafts])

  useEffect(() => {
    environmentDraftsRef.current = environmentDrafts
  }, [environmentDrafts])

  useEffect(() => {
    environmentSecretDraftsRef.current = environmentSecretDrafts
  }, [environmentSecretDrafts])

  useEffect(
    () => () => {
      for (const timer of Object.values(queryTextDraftSyncTimersRef.current)) {
        window.clearTimeout(timer)
      }
      for (const timer of Object.values(scriptTextDraftSyncTimersRef.current)) {
        window.clearTimeout(timer)
      }
    },
    [],
  )

  const snapshot = payload?.snapshot
  const activeConnection =
    snapshot?.connections.find((item) => item.id === snapshot.ui.activeConnectionId) ??
    snapshot?.connections[0]
  const activeTabFromSelection = snapshot?.tabs.find(
    (item) =>
      item.id === snapshot.ui.activeTabId &&
      (item.tabKind === 'environment' ||
        item.tabKind === 'api-server' ||
        item.tabKind === 'mcp-server' ||
        item.tabKind === 'workspace-search' ||
        item.tabKind === 'security-checks' ||
        item.tabKind === 'settings' ||
        !activeConnection ||
        item.connectionId === activeConnection.id),
  )
  const activeTab =
    activeTabFromSelection ??
    (activeConnection
      ? snapshot?.tabs.find((item) => item.connectionId === activeConnection.id)
      : undefined)
  const activeTabId = activeTab?.id
  const activeTabExecution =
    activeTabId ? activeTab?.activeExecution ?? executionsByTab[activeTabId] : undefined
  const activeExecutionStatus = activeTabExecution ? 'loading' : 'idle'
  const activeExecutionId = activeTabExecution?.executionId
  const activeDocumentEfficiencyMode = activeTab?.documentEfficiencyMode ?? false
  const activeTabIsExplorer = activeTab?.tabKind === 'explorer'
  const activeTabIsMetrics = activeTab?.tabKind === 'metrics'
  const activeTabIsObjectView = activeTab?.tabKind === 'object-view'
  const activeTabIsTestSuite = activeTab?.tabKind === 'test-suite'
  const activeTabIsEnvironment = activeTab?.tabKind === 'environment'
  const activeTabIsSettings = activeTab?.tabKind === 'settings'
  const activeTabIsApiServer = activeTab?.tabKind === 'api-server'
  const activeTabIsMcpServer = activeTab?.tabKind === 'mcp-server'
  const activeTabIsWorkspaceSearch = activeTab?.tabKind === 'workspace-search'
  const activeTabIsSecurityChecks = activeTab?.tabKind === 'security-checks'
  const activeEnvironment =
    snapshot?.environments.find((item) => item.id === snapshot.ui.activeEnvironmentId) ??
    snapshot?.environments[0]
  const apiServerPreferences = snapshot?.preferences.datastoreApiServer
  const apiServerPreferenceKey = useMemo(
    () =>
      apiServerPreferences
        ? JSON.stringify({
            enabled: apiServerPreferences.enabled,
            activeServerId: apiServerPreferences.activeServerId,
            servers: apiServerPreferences.servers,
            connectionId: apiServerPreferences.connectionId,
            environmentId: apiServerPreferences.environmentId,
            port: apiServerPreferences.port,
          })
        : '',
    [apiServerPreferences],
  )
  const refreshApiServerStatus = useCallback(async () => {
    if (!apiServerPreferences?.enabled) {
      return undefined
    }

    const nextStatus = await actions.getDatastoreApiServerStatus()
    if (nextStatus) {
      setApiServerStatus(nextStatus)
    }
    return nextStatus
  }, [actions, apiServerPreferences?.enabled])
  useEffect(() => {
    if (!apiServerPreferences?.enabled) {
      return undefined
    }

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        void refreshApiServerStatus()
      }
    })
    const timer = window.setInterval(() => {
      void refreshApiServerStatus()
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [apiServerPreferenceKey, apiServerPreferences?.enabled, refreshApiServerStatus])
  const effectiveApiServerStatus = apiServerPreferences?.enabled ? apiServerStatus : undefined
  const apiServerInstances = useMemo(
    () => effectiveApiServerStatus?.servers ?? apiServerInstancesFromPreferences(apiServerPreferences),
    [apiServerPreferences, effectiveApiServerStatus?.servers],
  )
  const activeApiServerTabServerId = activeTabIsApiServer ? apiServerIdFromTab(activeTab) : undefined
  const activeApiServerId =
    activeApiServerTabServerId ??
    effectiveApiServerStatus?.activeServerId ??
    apiServerPreferences?.activeServerId ??
    apiServerInstances[0]?.id
  const runningApiServerCount = apiServerInstances.filter((server) => server.running).length
  const apiServerStatusTargetId =
    apiServerInstances.find((server) => server.running)?.id ??
    activeApiServerId ??
    apiServerInstances[0]?.id
  const showApiServerStatusIndicator =
    Boolean(apiServerPreferences?.enabled) || runningApiServerCount > 0
  const securityChecksEnabled = Boolean(snapshot?.preferences.datastoreSecurityChecks?.enabled)
  const securityFindings = snapshot?.datastoreSecurityChecks?.findings
  const securityPostureChecks = snapshot?.datastoreSecurityChecks?.postureChecks
  const securityTargets = snapshot?.datastoreSecurityChecks?.targets
  const mutedSecurityFindingIds =
    snapshot?.preferences.datastoreSecurityChecks?.mutedFindingIds ?? EMPTY_STRING_ARRAY
  const securityStatusCounts = useMemo(() => {
    if (!securityChecksEnabled) {
      return undefined
    }

    const mutedFindingIds = new Set(mutedSecurityFindingIds)
    let criticalCount = 0
    let highCount = 0
    let postureIssueCount = 0
    const attentionTargetIds = new Set<string>()

    for (const finding of securityFindings ?? []) {
      if (mutedFindingIds.has(finding.id)) {
        continue
      }
      for (const targetId of finding.targetIds) {
        attentionTargetIds.add(targetId)
      }
      if (finding.severity === 'CRITICAL') {
        criticalCount += 1
      } else if (finding.severity === 'HIGH') {
        highCount += 1
      }
    }
    for (const check of securityPostureChecks ?? []) {
      if (
        mutedFindingIds.has(check.id) ||
        (check.status !== 'fail' && check.status !== 'warn' && check.status !== 'unknown')
      ) {
        continue
      }
      postureIssueCount += 1
      for (const targetId of check.targetIds) {
        attentionTargetIds.add(targetId)
      }
      if (check.severity === 'CRITICAL') {
        criticalCount += 1
      } else if (check.severity === 'HIGH') {
        highCount += 1
      }
    }
    for (const target of securityTargets ?? []) {
      if (
        ['versionUnavailable', 'mappingUnavailable', 'error'].includes(target.status) ||
        target.versionStatus === 'updateAvailable' ||
        target.versionStatus === 'unsupported'
      ) {
        attentionTargetIds.add(target.id)
      }
    }
    const attentionCount = attentionTargetIds.size

    return attentionCount > 0
      ? { attentionCount, criticalCount, highCount, postureIssueCount }
      : undefined
  }, [
    mutedSecurityFindingIds,
    securityChecksEnabled,
    securityFindings,
    securityPostureChecks,
    securityTargets,
  ])
  const getApiServerStatus = useCallback(
    async () => refreshApiServerStatus(),
    [refreshApiServerStatus],
  )
  const updateApiServerSettings = useCallback(
    async (request: Parameters<Actions['updateDatastoreApiServerSettings']>[0]) => {
      const updated = await actions.updateDatastoreApiServerSettings(request)
      if (updated) {
        await refreshApiServerStatus()
      }
      return updated
    },
    [actions, refreshApiServerStatus],
  )
  const startApiServer = useCallback(
    async (request: Parameters<Actions['startDatastoreApiServer']>[0]) => {
      const nextStatus = await actions.startDatastoreApiServer(request)
      if (nextStatus) {
        setApiServerStatus(nextStatus)
      }
      return nextStatus
    },
    [actions],
  )
  const stopApiServer = useCallback(
    async (request: Parameters<Actions['stopDatastoreApiServer']>[0] = {}) => {
      const nextStatus = await actions.stopDatastoreApiServer(request)
      if (nextStatus) {
        setApiServerStatus(nextStatus)
      }
      return nextStatus
    },
    [actions],
  )
  const mcpServerPreferences = snapshot?.preferences.datastoreMcpServer
  const mcpServerPreferenceKey = useMemo(
    () =>
      mcpServerPreferences
        ? JSON.stringify({
            enabled: mcpServerPreferences.enabled,
            activeServerId: mcpServerPreferences.activeServerId,
            servers: mcpServerPreferences.servers,
            port: mcpServerPreferences.port,
          })
        : '',
    [mcpServerPreferences],
  )
  const refreshMcpServerStatus = useCallback(async () => {
    if (!mcpServerPreferences?.enabled) {
      return undefined
    }

    const nextStatus = await actions.getDatastoreMcpServerStatus()
    if (nextStatus) {
      setMcpServerStatus(nextStatus)
    }
    return nextStatus
  }, [actions, mcpServerPreferences?.enabled])
  useEffect(() => {
    if (!mcpServerPreferences?.enabled) {
      return undefined
    }

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        void refreshMcpServerStatus()
      }
    })
    const timer = window.setInterval(() => {
      void refreshMcpServerStatus()
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [mcpServerPreferenceKey, mcpServerPreferences?.enabled, refreshMcpServerStatus])
  const effectiveMcpServerStatus = mcpServerPreferences?.enabled ? mcpServerStatus : undefined
  const mcpServerInstances = useMemo(
    () => effectiveMcpServerStatus?.servers ?? mcpServerInstancesFromPreferences(mcpServerPreferences),
    [mcpServerPreferences, effectiveMcpServerStatus?.servers],
  )
  const activeMcpServerTabServerId = activeTabIsMcpServer ? mcpServerIdFromTab(activeTab) : undefined
  const activeMcpServerId =
    activeMcpServerTabServerId ??
    effectiveMcpServerStatus?.activeServerId ??
    mcpServerPreferences?.activeServerId ??
    mcpServerInstances[0]?.id
  const mcpServerRunning = mcpServerInstances.some((server) => server.running)
  const mcpServerStatusTargetId =
    mcpServerInstances.find((server) => server.running)?.id ??
    activeMcpServerId ??
    mcpServerInstances[0]?.id
  const showMcpServerStatusIndicator =
    Boolean(mcpServerPreferences?.enabled) || mcpServerRunning
  const getMcpServerStatus = useCallback(
    async () => refreshMcpServerStatus(),
    [refreshMcpServerStatus],
  )
  const updateMcpServerSettings = useCallback(
    async (request: Parameters<Actions['updateDatastoreMcpServerSettings']>[0]) => {
      const updated = await actions.updateDatastoreMcpServerSettings(request)
      if (updated) {
        await refreshMcpServerStatus()
      }
      return updated
    },
    [actions, refreshMcpServerStatus],
  )
  const startMcpServer = useCallback(
    async (request: Parameters<Actions['startDatastoreMcpServer']>[0]) => {
      const nextStatus = await actions.startDatastoreMcpServer(request)
      if (nextStatus) {
        setMcpServerStatus(nextStatus)
      }
      return nextStatus
    },
    [actions],
  )
  const stopMcpServer = useCallback(
    async (request: Parameters<Actions['stopDatastoreMcpServer']>[0] = {}) => {
      const nextStatus = await actions.stopDatastoreMcpServer(request)
      if (nextStatus) {
        setMcpServerStatus(nextStatus)
      }
      return nextStatus
    },
    [actions],
  )
  const keyboardShortcuts = useMemo(
    () => resolveKeyboardShortcuts(snapshot?.preferences),
    [snapshot?.preferences],
  )
  const autoBackupEnabled = snapshot?.preferences.workspaceBackups?.enabled
  const autoBackupIntervalMinutes = snapshot?.preferences.workspaceBackups?.intervalMinutes
  const loadExplorer = actions.loadExplorer
  const activeSidebarPane = snapshot?.ui.activeSidebarPane
  useLayoutEffect(() => {
    bottomPanelVisibleRef.current = Boolean(snapshot?.ui.bottomPanelVisible)
  }, [snapshot?.ui.bottomPanelVisible])
  useEffect(() => {
    if (!autoBackupEnabled) {
      return
    }

    const intervalMs = Math.max(5, autoBackupIntervalMinutes ?? 30) * 60 * 1000
    const timer = window.setInterval(() => {
      void actions.createWorkspaceBackupNow({ automatic: true })
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [
    actions,
    autoBackupEnabled,
    autoBackupIntervalMinutes,
  ])
  const activeConnectionId = activeConnection?.id
  const activeEnvironmentId = activeEnvironment?.id
  const activeExplorerCacheEntry =
    activeConnectionId && activeEnvironmentId
      ? explorerCache?.[explorerCacheKey(activeConnectionId, activeEnvironmentId)]
      : undefined
  const activeExplorerResponse = activeExplorerCacheEntry?.response
  const runtimeCapabilities =
    activeConnection && snapshot
      ? {
          ...deriveCapabilities(snapshot, activeConnection),
          ...(activeExplorerResponse?.capabilities ?? {}),
        }
      : defaultCapabilities()
  const activeConnectionExplorerItems = activeExplorerResponse?.nodes
  const explorerSourceNodes = activeConnectionExplorerItems ?? snapshot?.explorerNodes ?? []
  const activeExplorerStatus =
    activeConnectionId &&
    activeEnvironmentId &&
    isExplorerRequestLoading(
      explorerLoadingRequests,
      activeConnectionId,
      activeEnvironmentId,
    )
      ? 'loading'
      : activeExplorerResponse
        ? 'ready'
        : activeConnectionId && activeEnvironmentId
          ? 'idle'
          : explorerStatus
  const getConnectionExplorerResponse = useCallback(
    (connectionId: string, environmentId?: string) => {
      const resolvedEnvironmentId = environmentId || activeEnvironmentId

      if (!resolvedEnvironmentId) {
        return undefined
      }

      return explorerCache?.[explorerCacheKey(connectionId, resolvedEnvironmentId)]?.response
    },
    [activeEnvironmentId, explorerCache],
  )
  const getConnectionExplorerItems = useCallback(
    (connectionId: string, environmentId?: string) =>
      getConnectionExplorerResponse(connectionId, environmentId)?.nodes,
    [getConnectionExplorerResponse],
  )
  const getConnectionExplorerStatus = useCallback(
    (connectionId: string, environmentId?: string) => {
      const resolvedEnvironmentId = environmentId || activeEnvironmentId

      if (!resolvedEnvironmentId) {
        return 'idle' as const
      }

      if (
        isExplorerRequestLoading(
          explorerLoadingRequests,
          connectionId,
          resolvedEnvironmentId,
        )
      ) {
        return 'loading' as const
      }

      return getConnectionExplorerResponse(connectionId, resolvedEnvironmentId)
        ? ('ready' as const)
        : ('idle' as const)
    },
    [activeEnvironmentId, explorerLoadingRequests, getConnectionExplorerResponse],
  )
  const getConnectionHealth = useCallback(
    (connectionId: string, environmentId?: string) => {
      const resolvedEnvironmentId = environmentId || activeEnvironmentId

      if (!resolvedEnvironmentId) {
        return undefined
      }

      return connectionHealthByKey[connectionHealthKey(connectionId, resolvedEnvironmentId)]
    },
    [activeEnvironmentId, connectionHealthByKey],
  )
  const activeConnectionHealth =
    activeConnectionId && activeEnvironmentId
      ? getConnectionHealth(activeConnectionId, activeEnvironmentId)
      : undefined
  const isConnectionExplorerScopeLoading = useCallback(
    (connectionId: string, scope?: string, environmentId?: string) =>
      isExplorerRequestLoading(
        explorerLoadingRequests,
        connectionId,
        environmentId || activeEnvironmentId,
        scope,
      ),
    [activeEnvironmentId, explorerLoadingRequests],
  )
  const activeBuilderState =
    activeTab &&
    !activeTabIsExplorer &&
    !activeTabIsMetrics &&
    !activeTabIsObjectView &&
    !activeTabIsTestSuite &&
    !activeTabIsEnvironment &&
    !activeTabIsSettings &&
    !activeTabIsApiServer &&
    !activeTabIsMcpServer &&
    !activeTabIsWorkspaceSearch &&
    !activeTabIsSecurityChecks &&
    activeConnection
      ? builderStateForTab(activeTab, activeConnection, builderStateDrafts)
      : undefined
  const activeBuilderKind = activeBuilderState?.kind
  const hasBuilderQuery = Boolean(activeBuilderState)
  const activeTabSupportsScripting = activeConnection?.engine === 'mongodb'
  const activeQueryWindowMode: QueryViewMode = hasBuilderQuery
    ? queryWindowMode === 'script' && !activeTabSupportsScripting
      ? 'builder'
      : queryWindowMode
    : queryWindowMode === 'script' && activeTabSupportsScripting
      ? 'script'
      : 'raw'
  const activeTabUsesRedisConsole = isRedisConsoleTab(activeTab)
  const activeRedisConsoleVisible =
    activeTabUsesRedisConsole &&
    activeQueryWindowMode === 'raw'
  const activeRedisKeyBrowserVisible =
    activeTabUsesRedisConsole &&
    activeQueryWindowMode === 'builder' &&
    isRedisKeyBrowserState(activeBuilderState)
  const activeTabQueryText =
    activeTab &&
    Object.prototype.hasOwnProperty.call(queryTextDrafts, activeTab.id) &&
    typeof queryTextDrafts[activeTab.id] === 'string'
      ? queryTextDrafts[activeTab.id]
      : activeTab?.queryText
  const activeTabScriptText =
    activeTab &&
    Object.prototype.hasOwnProperty.call(scriptTextDrafts, activeTab.id) &&
    typeof scriptTextDrafts[activeTab.id] === 'string'
      ? scriptTextDrafts[activeTab.id]
      : activeTab?.scriptText
  const activeRedisConsoleCommand =
    activeTabUsesRedisConsole && activeTab
      ? redisConsoleCommandFromQueryText(activeTabQueryText ?? activeTab.queryText, activeBuilderState)
      : undefined
  const activeEditorQueryText =
    activeRedisConsoleCommand ??
    (activeTab && activeQueryWindowMode === 'script'
      ? activeTabScriptText ?? (activeConnection ? defaultScriptTextForConnection(activeConnection) : '')
      : undefined) ??
    (activeTab &&
    activeBuilderState &&
    activeQueryWindowMode === 'builder'
      ? buildQueryTextForBuilderState(activeBuilderState, activeConnection, activeTab)
      : activeTabQueryText)
  const activeEditorResetKey =
    activeTabId && activeQueryWindowMode !== 'builder'
      ? `${activeTabId}:${activeQueryWindowMode}:${editorResetRevisions[activeTabId] ?? 0}`
      : undefined
  const activeSelectedText =
    activeTabId && activeQueryWindowMode !== 'builder'
      ? editorSelectionDrafts[activeTabId]?.trim()
      : ''
  const activeMongoQueryScope = mongoQueryScopeForTab({
    builderState: activeBuilderState,
    connection: activeConnection,
    queryText: activeEditorQueryText,
    scriptText: activeTabScriptText,
    tab: activeTab,
  })
  const intellisenseCatalog = useQueryIntellisenseCatalog({
    connection: activeConnection,
    environment: activeEnvironment,
    tab: activeTab,
    explorerNodes: explorerSourceNodes,
    structure,
    resultPayloads: activeTab?.result?.payloads,
  })
  const completionProviders = useMemo(
    () => [
      ...completionProvidersForConnection(activeConnection, runtimeCapabilities.editorLanguage),
      ENVIRONMENT_VARIABLE_COMPLETION_PROVIDER,
    ],
    [activeConnection, runtimeCapabilities.editorLanguage],
  )
  const completionContext = useMemo(() => {
    if (
      !activeConnection ||
      !activeEnvironment ||
      !activeTab ||
      activeTabIsExplorer ||
      activeTabIsMetrics ||
      activeTabIsObjectView ||
      activeTabIsTestSuite ||
      activeTabIsEnvironment ||
      activeTabIsSettings ||
      activeTabIsApiServer ||
      activeTabIsMcpServer ||
      activeTabIsWorkspaceSearch ||
      activeTabIsSecurityChecks
    ) {
      return undefined
    }

    return {
      connection: activeConnection,
      environment: activeEnvironment,
      tab: activeTab,
      language: runtimeCapabilities.editorLanguage,
      queryText: activeEditorQueryText ?? activeTab.queryText,
      catalog: intellisenseCatalog,
    }
  }, [
    activeConnection,
    activeEditorQueryText,
    activeEnvironment,
    activeTab,
    activeTabIsExplorer,
    activeTabIsMetrics,
    activeTabIsObjectView,
    activeTabIsTestSuite,
    activeTabIsEnvironment,
    activeTabIsApiServer,
    activeTabIsMcpServer,
    activeTabIsSecurityChecks,
    activeTabIsSettings,
    activeTabIsWorkspaceSearch,
    intellisenseCatalog,
    runtimeCapabilities.editorLanguage,
  ])

  const resolveBuilderQueryText = useCallback((tab: QueryTabState): string | undefined => {
    const builderState =
      activeConnection
        ? builderStateForTab(tab, activeConnection, builderStateDraftRef.current)
        : undefined

    if (!builderState) {
      return undefined
    }

    if (activeQueryWindowMode !== 'builder') {
      return undefined
    }

    return buildQueryTextForBuilderState(builderState, activeConnection, tab)
  }, [activeConnection, activeQueryWindowMode])
  const resolveQueryText = useCallback((tab: QueryTabState): string => {
    const hasDraftText =
      Object.prototype.hasOwnProperty.call(queryTextDraftRef.current, tab.id) &&
      typeof queryTextDraftRef.current[tab.id] === 'string'

    return hasDraftText ? (queryTextDraftRef.current[tab.id] ?? tab.queryText) : tab.queryText
  }, [])
  const rememberEditorSelection = useCallback((tabId: string, selectedText: string) => {
    editorSelectionDraftRef.current[tabId] = selectedText
    setEditorSelectionDrafts((current) =>
      current[tabId] === selectedText
        ? current
        : {
            ...current,
            [tabId]: selectedText,
          },
    )
  }, [])
  const rememberActiveEditorSelection = useCallback((selectedText: string) => {
    if (activeTabId) {
      rememberEditorSelection(activeTabId, selectedText)
    }
  }, [activeTabId, rememberEditorSelection])
  const mirrorQueryTextDraft = useCallback((tabId: string, queryText: string) => {
    setQueryTextDrafts((current) =>
      current[tabId] === queryText
        ? current
        : {
            ...current,
            [tabId]: queryText,
          },
    )
  }, [])

  const mirrorScriptTextDraft = useCallback((tabId: string, scriptText: string) => {
    setScriptTextDrafts((current) =>
      current[tabId] === scriptText
        ? current
        : {
            ...current,
            [tabId]: scriptText,
          },
    )
  }, [])

  const rememberQueryTextDraft = useCallback((tabId: string, queryText: string) => {
    queryTextDraftRef.current[tabId] = queryText
  }, [])

  const rememberScriptTextDraft = useCallback((tabId: string, scriptText: string) => {
    scriptTextDraftRef.current[tabId] = scriptText
  }, [])

  const bumpEditorResetRevision = useCallback((tabId: string) => {
    setEditorResetRevisions((current) => ({
      ...current,
      [tabId]: (current[tabId] ?? 0) + 1,
    }))
  }, [])

  const scheduleQueryTextDraftSync = useCallback((tabId: string, queryText: string) => {
    rememberQueryTextDraft(tabId, queryText)
    const existingTimer = queryTextDraftSyncTimersRef.current[tabId]

    if (existingTimer) {
      window.clearTimeout(existingTimer)
    }

    queryTextDraftSyncTimersRef.current[tabId] = window.setTimeout(() => {
      delete queryTextDraftSyncTimersRef.current[tabId]
      mirrorQueryTextDraft(tabId, queryText)
    }, 350)
  }, [mirrorQueryTextDraft, rememberQueryTextDraft])

  const scheduleScriptTextDraftSync = useCallback((tabId: string, scriptText: string) => {
    rememberScriptTextDraft(tabId, scriptText)
    const existingTimer = scriptTextDraftSyncTimersRef.current[tabId]

    if (existingTimer) {
      window.clearTimeout(existingTimer)
    }

    scriptTextDraftSyncTimersRef.current[tabId] = window.setTimeout(() => {
      delete scriptTextDraftSyncTimersRef.current[tabId]
      mirrorScriptTextDraft(tabId, scriptText)
    }, 350)
  }, [mirrorScriptTextDraft, rememberScriptTextDraft])

  const commitQueryTextDraft = useCallback((
    tabId: string,
    queryText: string,
    queryViewMode?: QueryViewMode,
  ) => {
    const existingTimer = queryTextDraftSyncTimersRef.current[tabId]

    if (existingTimer) {
      window.clearTimeout(existingTimer)
      delete queryTextDraftSyncTimersRef.current[tabId]
    }

    rememberQueryTextDraft(tabId, queryText)
    mirrorQueryTextDraft(tabId, queryText)
    bumpEditorResetRevision(tabId)
    void actions.updateQuery(tabId, queryText, queryViewMode)
  }, [actions, bumpEditorResetRevision, mirrorQueryTextDraft, rememberQueryTextDraft])

  useEffect(() => {
    if (!activeTabId) {
      return
    }

    const queryDraft = queryTextDraftRef.current[activeTabId]
    if (queryDraft !== undefined) {
      mirrorQueryTextDraft(activeTabId, queryDraft)
    }

    const scriptDraft = scriptTextDraftRef.current[activeTabId]
    if (scriptDraft !== undefined) {
      mirrorScriptTextDraft(activeTabId, scriptDraft)
    }
  }, [activeTabId, mirrorQueryTextDraft, mirrorScriptTextDraft])

  const replaceActiveRawQueryText = useCallback((queryText: string) => {
    if (
      !activeTab ||
      activeTabIsExplorer ||
      activeTabIsMetrics ||
      activeTabIsObjectView ||
      activeTabIsTestSuite ||
      activeTabIsEnvironment ||
      activeTabIsSettings ||
      activeTabIsApiServer ||
      activeTabIsMcpServer ||
      activeTabIsWorkspaceSearch ||
      activeTabIsSecurityChecks
    ) {
      return
    }

    commitQueryTextDraft(activeTab.id, queryText)
  }, [
    activeTab,
    activeTabIsEnvironment,
    activeTabIsExplorer,
    activeTabIsMetrics,
    activeTabIsObjectView,
    activeTabIsApiServer,
    activeTabIsMcpServer,
    activeTabIsSecurityChecks,
    activeTabIsSettings,
    activeTabIsTestSuite,
    activeTabIsWorkspaceSearch,
    commitQueryTextDraft,
  ])
  const requestIntellisenseRefresh = useCallback(() => {
    if (
      !activeConnectionId ||
      !activeEnvironmentId ||
      !connectionUsesManagedOracleRuntime(activeConnection)
    ) {
      return
    }

    void actions.loadStructureMap({
      connectionId: activeConnectionId,
      environmentId: activeEnvironmentId,
      limit: 160,
    })
  }, [actions, activeConnection, activeConnectionId, activeEnvironmentId])

  const rememberRedisConsoleCommand = useCallback((
    tabId: string,
    builderState: QueryBuilderState | undefined,
    command: string,
  ) => {
    if (!isRedisKeyBrowserState(builderState)) {
      return
    }

    const normalizedCommand = command.trim()
    if (!normalizedCommand) {
      return
    }

    const nextBuilderState = {
      ...builderState,
      consoleHistory: [
        normalizedCommand,
        ...(builderState.consoleHistory ?? []).filter((item) => item !== normalizedCommand),
      ].slice(0, 50),
    }

    builderStateDraftRef.current[tabId] = nextBuilderState
    setBuilderStateDrafts((current) => ({
      ...current,
      [tabId]: nextBuilderState,
    }))
  }, [])

  const setRedisConsolePipelineMode = useCallback((
    tabId: string,
    builderState: QueryBuilderState | undefined,
    pipelineMode: boolean,
  ) => {
    if (!isRedisKeyBrowserState(builderState)) {
      return
    }

    const nextBuilderState = {
      ...builderState,
      pipelineMode,
    }

    builderStateDraftRef.current[tabId] = nextBuilderState
    setBuilderStateDrafts((current) => ({
      ...current,
      [tabId]: nextBuilderState,
    }))
  }, [])

  const runCurrentTabQuery = useCallback((mode?: ExecutionRequest['mode'], guardrailId?: string) => {
    if (!activeTab || activeTab.tabKind === 'explorer') {
      return
    }

    if (activeTab.tabKind === 'metrics') {
      void actions.refreshMetricsTab(activeTab.id)
      return
    }

    if (activeTab.tabKind === 'test-suite') {
      void actions.executeTestSuite({ tabId: activeTab.id })
      return
    }

    const selectedText =
      activeQueryWindowMode !== 'builder'
        ? editorSelectionDraftRef.current[activeTab.id]?.trim()
          ? editorSelectionDraftRef.current[activeTab.id]
          : undefined
        : undefined
    const executionMode = selectedText && !mode ? 'selection' : mode

    if (activeQueryWindowMode === 'script') {
      const scriptText =
        scriptTextDraftRef.current[activeTab.id] ??
        activeTab.scriptText ??
        (activeConnection ? defaultScriptTextForConnection(activeConnection) : '') ??
        ''
      void actions.executeQuery(
        activeTab.id,
        executionMode,
        guardrailId,
        resolveQueryText(activeTab),
        'script',
        scriptText,
        false,
        selectedText,
      )
      return
    }

    const generatedQueryText = resolveBuilderQueryText(activeTab)
    const builderState =
      activeConnection
        ? builderStateForTab(activeTab, activeConnection, builderStateDraftRef.current)
        : undefined

    if (isRedisKeyBrowserState(builderState)) {
      if (activeQueryWindowMode === 'builder') {
        setRedisBrowserRefreshSignals((current) => ({
          ...current,
          [activeTab.id]: (current[activeTab.id] ?? 0) + 1,
        }))
        return
      }

      const redisCommand = redisConsoleCommandFromQueryText(
        resolveQueryText(activeTab),
        builderState,
      )
      commitQueryTextDraft(activeTab.id, redisCommand, 'raw')
      rememberRedisConsoleCommand(activeTab.id, builderState, redisCommand)
      void actions.executeQuery(
        activeTab.id,
        executionMode,
        guardrailId,
        redisCommand,
        'raw',
        undefined,
        false,
        selectedText,
      )
      return
    }

    const documentEfficiencyMode =
      activeConnection?.engine === 'mongodb' && activeDocumentEfficiencyMode

    if (!generatedQueryText || !builderState) {
      void actions.executeQuery(
        activeTab.id,
        executionMode,
        guardrailId,
        resolveQueryText(activeTab),
        'raw',
        undefined,
        documentEfficiencyMode,
        selectedText,
      )
      return
    }

    void actions.executeQuery(
      activeTab.id,
      executionMode,
      guardrailId,
      generatedQueryText,
      'builder',
      undefined,
      documentEfficiencyMode,
      undefined,
    )
  }, [
    actions,
    activeConnection,
    activeDocumentEfficiencyMode,
    activeQueryWindowMode,
    activeTab,
    commitQueryTextDraft,
    rememberRedisConsoleCommand,
    resolveBuilderQueryText,
    resolveQueryText,
  ])

  const confirmExecutionGuardrail = useCallback(async (
    guardrailId: string,
    mode: ExecutionRequest['mode'] = 'full',
    reasons: string[] = [],
    requiredConfirmationText?: string,
  ) => {
    const confirmed = await confirmReview({
      title: 'Run this guarded query?',
      action: requiredConfirmationText
        ? `Confirm this query run for ${requiredConfirmationText}.`
        : 'Confirm this query run.',
      reasons: uniqueStrings(reasons).slice(0, 4),
      confirmLabel: 'Run',
    })

    if (confirmed) {
      runCurrentTabQuery(mode, guardrailId)
    }
  }, [confirmReview, runCurrentTabQuery])

  useEffect(() => {
    const executionId = lastExecution?.executionId
    const guardrail = lastExecution?.guardrail
    if (!executionId || guardrail?.status !== 'confirm' || !guardrail.id) {
      return
    }

    const token = `${executionId}:${guardrail.id}`
    if (promptedGuardrailRef.current === token) {
      return
    }

    promptedGuardrailRef.current = token
    void confirmExecutionGuardrail(
      guardrail.id,
      lastExecutionRequest?.mode ?? 'full',
      guardrail.reasons,
      guardrail.requiredConfirmationText,
    )
  }, [
    confirmExecutionGuardrail,
    lastExecution?.executionId,
    lastExecution?.guardrail,
    lastExecutionRequest?.mode,
  ])

  const planDatastoreOperationWithConfirmation = useCallback(
    async (request: OperationPlanRequest) => {
      const response = await actions.planDatastoreOperation(request)
      const confirmationText = response?.plan.confirmationText

      if (!response || !confirmationText) {
        return response
      }

      const confirmed = await confirmReview({
        title: 'Run this datastore operation?',
        action: response.plan.summary,
        reasons: operationReviewReasons(response.plan),
        confirmLabel: 'Run',
      })

      if (!confirmed) {
        return undefined
      }

      const execution = await actions.executeDatastoreOperation({
        ...request,
        confirmationText,
      })
      if (execution?.executed && isMongoManagementOperation(request.operationId)) {
        for (const scope of mongoManagementRefreshScopes(request)) {
          void actions.loadExplorer({
            connectionId: request.connectionId,
            environmentId: request.environmentId,
            limit: 100,
            scope,
          })
        }
      }

      return operationExecutionPlanResponse(response, execution)
    },
    [actions, confirmReview],
  )

  const persistBuilderState = (tabId: string, builderState: QueryBuilderState) => {
    if (!snapshot) {
      return
    }

    const targetTab = snapshot.tabs.find((item) => item.id === tabId)

    if (!targetTab) {
      return
    }

    const liveQueryText = buildQueryTextForBuilderState(
      builderState,
      activeConnection,
      targetTab,
    )
    const nextBuilderState =
      liveQueryText
        ? {
            ...builderState,
            lastAppliedQueryText: liveQueryText,
          }
        : builderState

    builderStateDraftRef.current[tabId] = nextBuilderState
    if (liveQueryText !== undefined) {
      rememberQueryTextDraft(tabId, liveQueryText)
      mirrorQueryTextDraft(tabId, liveQueryText)
    }
    setBuilderStateDrafts((current) => ({
      ...current,
      [tabId]: nextBuilderState,
    }))
    const currentBuilderState = targetTab.builderState

    if (
      currentBuilderState &&
      JSON.stringify(currentBuilderState) === JSON.stringify(nextBuilderState) &&
      liveQueryText === targetTab.queryText
    ) {
      return
    }

    void actions.updateQueryBuilderState({
      tabId,
      builderState: nextBuilderState,
      queryText: liveQueryText,
      queryViewMode: 'builder',
    })
  }

  const flushQueryTabDrafts = useCallback(
    async (tabId: string) => {
      const tab = snapshot?.tabs.find((item) => item.id === tabId)

      if (
        !tab ||
        tab.tabKind === 'explorer' ||
        tab.tabKind === 'metrics' ||
        tab.tabKind === 'object-view' ||
        tab.tabKind === 'environment' ||
        tab.tabKind === 'settings' ||
        tab.tabKind === 'api-server' ||
        tab.tabKind === 'mcp-server' ||
        tab.tabKind === 'workspace-search' ||
        tab.tabKind === 'security-checks'
      ) {
        return
      }

      const connection = snapshot?.connections.find((item) => item.id === tab.connectionId)
      const builderState = builderStateDraftRef.current[tabId]
      const draftQueryText = queryTextDraftRef.current[tabId]
      const draftScriptText = scriptTextDraftRef.current[tabId]
      const queryTimer = queryTextDraftSyncTimersRef.current[tabId]
      const scriptTimer = scriptTextDraftSyncTimersRef.current[tabId]

      if (queryTimer) {
        window.clearTimeout(queryTimer)
        delete queryTextDraftSyncTimersRef.current[tabId]
      }

      if (scriptTimer) {
        window.clearTimeout(scriptTimer)
        delete scriptTextDraftSyncTimersRef.current[tabId]
      }

      if (draftScriptText !== undefined) {
        await actions.updateQuery(tabId, draftScriptText, 'script')
      }

      if (builderState) {
        const generatedQueryText =
          draftQueryText ?? buildQueryTextForBuilderState(builderState, connection, tab)

        await actions.updateQueryBuilderState({
          tabId,
          builderState,
          queryText: generatedQueryText,
          queryViewMode: 'builder',
        })
        return
      }

      if (draftQueryText !== undefined && draftQueryText !== tab.queryText) {
        await actions.updateQuery(tabId, draftQueryText)
      }
    },
    [actions, snapshot?.connections, snapshot?.tabs],
  )

  const saveEnvironmentTabDraft = useCallback(
    async (tabId: string) => {
      const tab = snapshot?.tabs.find((item) => item.id === tabId)

      if (!tab || tab.tabKind !== 'environment') {
        return
      }

      const savedEnvironment = snapshot?.environments.find(
        (item) => item.id === tab.environmentId,
      )
      const draft = environmentDraftsRef.current[tabId] ?? savedEnvironment

      if (!draft) {
        return
      }

      const secretDrafts = environmentSecretDraftsRef.current[tabId] ?? {}
      const saved = await actions.saveEnvironment(draft, secretDrafts)

      if (!saved) {
        return
      }

      setEnvironmentDrafts((current) => {
        const next = { ...current }
        delete next[tabId]
        return next
      })
      setEnvironmentSecretDrafts((current) => {
        const next = { ...current }
        delete next[tabId]
        return next
      })

      const nextTitle = environmentTabTitle(draft.label)
      if (tab.title !== nextTitle) {
        await actions.renameTab(tabId, nextTitle)
      }
    },
    [actions, snapshot?.environments, snapshot?.tabs],
  )

  const requestSaveQuery = useCallback(
    (tabId: string) => {
      void (async () => {
        const tab = snapshot?.tabs.find((item) => item.id === tabId)

        if (!tab) {
          return
        }

        if (tab.tabKind === 'explorer') {
          return
        }

        if (tab.tabKind === 'metrics' || tab.tabKind === 'object-view') {
          return
        }

        if (tab.tabKind === 'environment') {
          await saveEnvironmentTabDraft(tabId)
          return
        }

        await flushQueryTabDrafts(tabId)

        if (tab.saveTarget) {
          await actions.saveCurrentQuery(tabId)
          return
        }

        setPendingSaveTabId(tabId)
      })()
    },
    [actions, flushQueryTabDrafts, saveEnvironmentTabDraft, snapshot?.tabs],
  )

  useEffect(() => {
    if (activeTabId && activeTabIsTestSuite) {
      const modeKey = 'test-suite'

      if (initializedQueryModeByTabRef.current[activeTabId] !== modeKey) {
        initializedQueryModeByTabRef.current[activeTabId] = modeKey
        setTestWindowMode('both')
      }
    }
  }, [activeTabId, activeTabIsTestSuite])

  useEffect(() => {
    if (
      !activeTabId ||
      !activeTab ||
      activeTabIsExplorer ||
      activeTabIsMetrics ||
      activeTabIsObjectView ||
      activeTabIsTestSuite ||
      activeTabIsEnvironment ||
      activeTabIsSettings ||
      activeTabIsApiServer ||
      activeTabIsMcpServer ||
      activeTabIsWorkspaceSearch ||
      activeTabIsSecurityChecks
    ) {
      return
    }

    const modeKey = `${activeTabId}:${activeBuilderKind ?? 'raw'}:${activeTab.queryViewMode ?? 'default'}`

    if (lastActiveQueryModeSyncKeyRef.current === modeKey) {
      return
    }

    lastActiveQueryModeSyncKeyRef.current = modeKey
    const nextMode = normalizeQueryWindowMode(
      queryWindowModeByTabRef.current[activeTabId] ?? activeTab.queryViewMode,
      activeBuilderKind,
      activeConnection,
    )
    queryWindowModeByTabRef.current[activeTabId] = nextMode
    setQueryWindowMode(nextMode)
  }, [
    activeBuilderKind,
    activeConnection,
    activeTab,
    activeTabId,
    activeTabIsExplorer,
    activeTabIsMetrics,
    activeTabIsObjectView,
    activeTabIsApiServer,
    activeTabIsMcpServer,
    activeTabIsSecurityChecks,
    activeTabIsEnvironment,
    activeTabIsTestSuite,
    activeTabIsSettings,
    activeTabIsWorkspaceSearch,
  ])

  useEffect(() => {
    const preventBrowserContextMenu = (event: MouseEvent) => {
      event.preventDefault()
    }

    document.addEventListener('contextmenu', preventBrowserContextMenu)
    return () => document.removeEventListener('contextmenu', preventBrowserContextMenu)
  }, [])

  useEffect(() => {
    if (
      !activeConnection ||
      activeConnection.engine !== 'oracle' ||
      !connectionUsesManagedOracleRuntime(activeConnection) ||
      !activeConnectionId ||
      !activeEnvironmentId ||
      !activeTab ||
      activeTabIsExplorer ||
      activeTabIsMetrics ||
      activeTabIsObjectView ||
      activeTabIsTestSuite ||
      activeTabIsEnvironment ||
      activeTabIsSettings ||
      activeTabIsApiServer ||
      activeTabIsMcpServer ||
      activeTabIsWorkspaceSearch ||
      activeTabIsSecurityChecks
    ) {
      return
    }

    const requestKey = `${activeConnectionId}:${activeEnvironmentId}`
    const structureIsCurrent =
      structure?.connectionId === activeConnectionId &&
      structure.environmentId === activeEnvironmentId

    if (
      structureIsCurrent ||
      structureStatus === 'loading' ||
      oracleIntellisenseLoadRef.current === requestKey
    ) {
      return
    }

    oracleIntellisenseLoadRef.current = requestKey
    void actions.loadStructureMap({
      connectionId: activeConnectionId,
      environmentId: activeEnvironmentId,
      limit: 160,
    })
  }, [
    actions,
    activeConnection,
    activeConnectionId,
    activeEnvironmentId,
    activeTab,
    activeTabIsApiServer,
    activeTabIsEnvironment,
    activeTabIsExplorer,
    activeTabIsMcpServer,
    activeTabIsMetrics,
    activeTabIsObjectView,
    activeTabIsSecurityChecks,
    activeTabIsSettings,
    activeTabIsTestSuite,
    activeTabIsWorkspaceSearch,
    structure,
    structureStatus,
  ])

  useEffect(() => {
    if (
      !activeConnectionId ||
      !activeEnvironmentId ||
      (activeSidebarPane !== 'explorer' && activeSidebarPane !== 'library') ||
      isExplorerRequestLoading(
        explorerLoadingRequests,
        activeConnectionId,
        activeEnvironmentId,
      ) ||
      hasExplorerScope(activeExplorerCacheEntry)
    ) {
      return
    }

    void loadExplorer({
      connectionId: activeConnectionId,
      environmentId: activeEnvironmentId,
      limit: 50,
    })
  }, [
    activeConnectionId,
    activeEnvironmentId,
    activeExplorerCacheEntry,
    activeSidebarPane,
    explorerLoadingRequests,
    loadExplorer,
  ])

  useEffect(() => {
    if (
      !activeConnectionId ||
      !activeEnvironmentId ||
      !activeTabIsExplorer ||
      !connectionUsesManagedOracleRuntime(activeConnection)
    ) {
      return
    }

    void actions.loadStructureMap({
      connectionId: activeConnectionId,
      environmentId: activeEnvironmentId,
      limit: 120,
    })
  }, [
    actions,
    activeConnection,
    activeConnectionId,
    activeEnvironmentId,
    activeTabIsExplorer,
  ])

  if (status === 'booting' || !payload || !snapshot) {
    return (
      <BootSurface
        title="Loading DataPad++ workspace..."
        copy="Connections, environments, tabs, and workbench layout are being restored."
      />
    )
  }

  if (status === 'error') {
    return (
      <BootSurface
        title="Unable to load workspace."
        copy={startupErrorMessage ?? 'Unexpected desktop startup failure.'}
      />
    )
  }

  const resolvedTheme = resolveThemeMode(snapshot.preferences.theme)
  const explorerFilter = snapshot.ui.explorerFilter
  const explorerItems = activeConnection ? explorerSourceNodes.filter((node) => {
    const matchesFamily =
      node.family === 'shared' || node.family === activeConnection.family
    const filter = explorerFilter.toLowerCase()
    const searchable = `${node.label} ${node.kind} ${node.detail} ${(node.path ?? []).join(' ')}`.toLowerCase()
    return matchesFamily && searchable.includes(filter)
  }) : []
  const queryBuilderOptions = queryBuilderObjectOptions(activeConnection, explorerItems)
  const pendingSaveTab = pendingSaveTabId
    ? snapshot.tabs.find((tab) => tab.id === pendingSaveTabId)
    : undefined
  const drawerConnection =
    snapshot.ui.rightDrawer === 'connection' && connectionDraft
      ? connectionDraft
      : activeConnection
  const drawerConnectionHealth =
    drawerConnection && activeEnvironment
      ? getConnectionHealth(drawerConnection.id, activeEnvironment.id)
      : undefined
  const connectionTest = drawerConnection
    ? connectionHealthToConnectionTest(
        drawerConnectionHealth?.source === 'manual-test'
          ? drawerConnectionHealth
          : undefined,
        drawerConnection.engine,
      ) ??
      connectionTests[drawerConnection.id]
    : undefined
  const activeRenderer =
    activeTab &&
    rendererPreference.tabId === activeTab.id &&
    activeTab.result?.rendererModes.some((mode) => mode === rendererPreference.renderer)
      ? rendererPreference.renderer
      : activeTab?.result?.defaultRenderer
  const activePayload = selectPayload(activeTab?.result?.payloads ?? [], activeRenderer)
  const savedEnvironmentForActiveTab =
    activeTabIsEnvironment && activeTab
      ? snapshot.environments.find((item) => item.id === activeTab.environmentId)
      : undefined
  const activeEnvironmentDraft =
    activeTabIsEnvironment && activeTab
      ? (environmentDrafts[activeTab.id] ?? savedEnvironmentForActiveTab)
      : undefined
  const environmentTabHasChanges = (tab: QueryTabState) => {
    if (tab.tabKind !== 'environment') {
      return Boolean(tab.dirty)
    }

    const savedEnvironment = snapshot.environments.find(
      (item) => item.id === tab.environmentId,
    )
    const draft = environmentDraftsRef.current[tab.id] ?? savedEnvironment
    const hasSecretDrafts = Object.values(environmentSecretDraftsRef.current[tab.id] ?? {})
      .some((value) => value.trim().length > 0)
    return (
      comparableEnvironment(draft) !== comparableEnvironment(savedEnvironment) ||
      hasSecretDrafts
    )
  }
  const tabHasMirroredTextDraftChanges = (tab: QueryTabState) => {
    const queryDraft = queryTextDrafts[tab.id]
    const scriptDraft = scriptTextDrafts[tab.id]

    return (
      (queryDraft !== undefined && queryDraft !== tab.queryText) ||
      (scriptDraft !== undefined && scriptDraft !== (tab.scriptText ?? ''))
    )
  }
  const tabHasLiveTextDraftChanges = (tab: QueryTabState) => {
    const queryDraft = queryTextDraftRef.current[tab.id]
    const scriptDraft = scriptTextDraftRef.current[tab.id]

    return (
      (queryDraft !== undefined && queryDraft !== tab.queryText) ||
      (scriptDraft !== undefined && scriptDraft !== (tab.scriptText ?? ''))
    )
  }
  const displayTabs = snapshot.tabs.map((tab) => {
    if (tab.tabKind !== 'environment') {
      return tabHasMirroredTextDraftChanges(tab)
        ? {
            ...tab,
            dirty: true,
          }
        : tab
    }

    const savedEnvironment = snapshot.environments.find(
      (item) => item.id === tab.environmentId,
    )
    const draft = environmentDrafts[tab.id] ?? savedEnvironment
    const title = environmentTabTitle(draft?.label ?? tab.title)
    const hasSecretDrafts = Object.values(environmentSecretDrafts[tab.id] ?? {})
      .some((value) => value.trim().length > 0)
    const dirty =
      comparableEnvironment(draft) !== comparableEnvironment(savedEnvironment) ||
      hasSecretDrafts

    return {
      ...tab,
      dirty,
      title,
    }
  })
  const canCancelExecution = Boolean(runtimeCapabilities.canCancel && activeExecutionId)
  const showingExplorerWorkspace = activeTabIsExplorer
  const showingMetricsWorkspace = activeTabIsMetrics
  const showingObjectViewWorkspace = activeTabIsObjectView
  const showingApiServerWorkspace = activeTabIsApiServer
  const showingMcpServerWorkspace = activeTabIsMcpServer
  const showingWorkspaceSearchWorkspace = activeTabIsWorkspaceSearch
  const showingSecurityChecksWorkspace = activeTabIsSecurityChecks
  const availableAppUpdate = appUpdateCheckResult?.status === 'available'
    ? appUpdateCheckResult.candidate
    : undefined
  const hasWorkbenchMessages = workbenchMessages.length > 0
  const hasActivePanelContext = Boolean(activeTab && activeConnection && activeEnvironment)
  const hasActiveQueryContext = Boolean(
    hasActivePanelContext &&
      !activeTabIsExplorer &&
      !activeTabIsMetrics &&
      !activeTabIsObjectView &&
      !activeTabIsTestSuite &&
      !activeTabIsEnvironment &&
      !activeTabIsSettings &&
      !activeTabIsApiServer &&
      !activeTabIsMcpServer &&
      !activeTabIsWorkspaceSearch &&
      !activeTabIsSecurityChecks,
  )
  const isMessagePanelRequested = snapshot.ui.activeBottomPanelTab === 'messages'
  const isExplorerDetailsRequested =
    activeTabIsExplorer && snapshot.ui.activeBottomPanelTab === 'details'
  const shouldShowBottomPanel =
    snapshot.ui.bottomPanelVisible &&
    (hasWorkbenchMessages ||
      isMessagePanelRequested ||
      (hasActivePanelContext && isExplorerDetailsRequested) ||
      (!showingExplorerWorkspace &&
        !showingMetricsWorkspace &&
        !showingObjectViewWorkspace &&
        !showingApiServerWorkspace &&
        !showingMcpServerWorkspace &&
        !showingWorkspaceSearchWorkspace &&
        !showingSecurityChecksWorkspace &&
        hasActiveQueryContext))
  const resultsDock = snapshot.ui.resultsDock ?? 'bottom'
  const resultsDockRight = resultsDock === 'right'

  const requestCloseTabQueue = (tabIds: string[]) => {
    const [tabId, ...remainingTabIds] = tabIds

    if (!tabId) {
      return
    }

    const tab = snapshot.tabs.find((item) => item.id === tabId)

    if (!tab) {
      if (displayTabs.some((item) => item.id === tabId)) {
        void actions.closeTab(tabId).then(() => requestCloseTabQueue(remainingTabIds))
      } else {
        requestCloseTabQueue(remainingTabIds)
      }
      return
    }

    if (
      tab.tabKind !== 'explorer' &&
      tab.tabKind !== 'metrics' &&
      tab.tabKind !== 'object-view' &&
      (tab.tabKind === 'environment'
        ? environmentTabHasChanges(tab)
        : Boolean((tab.saveTarget || tab.savedQueryId) && (tab.dirty || tabHasLiveTextDraftChanges(tab))))
    ) {
      setPendingTabClose({
        tab: displayTabs.find((item) => item.id === tab.id) ?? tab,
        remainingTabIds,
      })
      return
    }

    void actions.closeTab(tab.id).then(() => requestCloseTabQueue(remainingTabIds))
  }

  const requestCloseTab = (tabId: string) => {
    requestCloseTabQueue([tabId])
  }

  const requestCloseTabs = (tabIds: string[]) => {
    requestCloseTabQueue(tabIds)
  }

  const continuePendingTabClose = (remainingTabIds: string[]) => {
    if (remainingTabIds.length > 0) {
      requestCloseTabQueue(remainingTabIds)
    }
  }

  const createLibraryFolder = (parentId: string | undefined, name: string) => {
    const folderName = name.trim()
    if (folderName) {
      void actions.createLibraryFolder({ parentId, name: folderName })
    }
  }

  const renameLibraryNode = (nodeId: string, name: string) => {
    void actions.renameLibraryNode({ nodeId, name })
  }

  const requestDeleteLibraryNode = (nodeId: string) => {
    const node = snapshot.libraryNodes.find((item) => item.id === nodeId)

    if (node) {
      setPendingLibraryNodeDelete(node)
    }
  }

  const moveLibraryNode = (nodeId: string, parentId?: string) => {
    void actions.moveLibraryNode({ nodeId, parentId })
  }

  const setLibraryNodeEnvironment = (nodeId: string, environmentId?: string) => {
    void actions.setLibraryNodeEnvironment({ nodeId, environmentId })
  }

  const openConnectionDrawer = () => {
    setConnectionDraft(undefined)
    setConnectionDraftParentId(undefined)
    if (snapshot?.ui.activeConnectionId) {
      void actions.updateUiState({
        activeActivity: 'library',
        activeSidebarPane: 'library',
        sidebarCollapsed: false,
        rightDrawer: 'connection',
      })
    }
  }

  const openConnectionDrawerFor = (connectionId: string) => {
    setConnectionDraft(undefined)
    setConnectionDraftParentId(undefined)
    if (connectionId === snapshot?.ui.activeConnectionId) {
      openConnectionDrawer()
      return
    }

    void (async () => {
      await actions.selectConnection(connectionId)
      await actions.updateUiState({
        activeActivity: 'library',
        activeSidebarPane: 'library',
        sidebarCollapsed: false,
        rightDrawer: 'connection',
      })
    })()
  }

  const requestDeleteConnection = (connectionId: string) => {
    const connection = snapshot.connections.find((item) => item.id === connectionId)

    if (connection) {
      setPendingConnectionDelete(connection)
    }
  }

  const openDiagnosticsDrawer = (section?: SettingsSection) => {
    setConnectionDraft(undefined)
    setSettingsInitialSectionRequest((current) => ({
      revision: current.revision + 1,
      section: typeof section === 'string' ? section : 'appearance',
    }))
    void actions.createSettingsTab()
  }

  const openLibraryForGuide = () => {
    void actions.updateUiState({
      activeActivity: 'library',
      activeSidebarPane: 'library',
      sidebarCollapsed: false,
    })
  }

  const requestGuideFolderDialog = () => {
    openLibraryForGuide()
    setGuideFolderDialogRequestRevision((current) => current + 1)
  }

  const closeGuideFolderDialog = () => {
    setGuideFolderDialogCloseRequestRevision((current) => current + 1)
  }

  const startFirstInstallGuide = () => {
    setGuideStartRequestRevision((current) => current + 1)
    void actions.setFirstInstallGuideStatus('started', 'welcome')
  }

  const closeDrawer = () => {
    if (snapshot.ui.rightDrawer === 'diagnostics') {
      setExportPassphrase('')
      setImportPayload('')
    }
    setConnectionDraft(undefined)
    setConnectionDraftParentId(undefined)
    void actions.updateUiState({
      activeActivity: snapshot.ui.activeActivity === 'settings' ? 'library' : snapshot.ui.activeActivity,
      rightDrawer: 'none',
    })
  }

  const saveConnectionProfile = async (
    profile: ConnectionProfile,
    secret: string | undefined,
  ) => {
    let nextProfile = profile

    if (
      connectionDraft?.id === profile.id &&
      profile.environmentIds.length === 0 &&
      snapshot.environments.length === 0
    ) {
      const environment = createEnvironmentProfile()
      const environmentSaved = await actions.saveEnvironment(environment)

      if (!environmentSaved) {
        return false
      }

      nextProfile = {
        ...profile,
        environmentIds: [environment.id],
        updatedAt: new Date().toISOString(),
      }
    }

    const saved = await actions.saveConnection(nextProfile, secret)
    if (!saved) {
      return false
    }

    if (connectionDraftParentId !== undefined) {
      await actions.moveLibraryNode({
        nodeId: connectionLibraryNodeId(nextProfile.id),
        parentId: connectionDraftParentId,
      })
    }

    if (connectionDraft?.id === profile.id) {
      setConnectionDraft(undefined)
      setConnectionDraftParentId(undefined)
    }

    return true
  }

  const cloneEnvironmentProfile = (environment: EnvironmentProfile) => {
    const clone = createEnvironmentProfile({
      color: environment.color,
      exportable: environment.exportable,
      inheritsFrom: environment.inheritsFrom,
      label: `Copy of ${environment.label}`,
      requiresConfirmation: environment.requiresConfirmation,
      risk: environment.risk,
      safeMode: environment.safeMode,
      sensitiveKeys: [...environment.sensitiveKeys],
      variables: { ...environment.variables },
      variableDefinitions: environment.variableDefinitions?.map((definition) => ({
        ...definition,
        secretRef: definition.secretRef ? { ...definition.secretRef } : undefined,
        value: definition.kind === 'secret' ? undefined : definition.value,
      })),
    })

    void (async () => {
      const saved = await actions.saveEnvironment(clone)

      if (!saved) {
        return
      }

      await actions.createEnvironmentTab(clone.id)
    })()
  }

  const requestDeleteEnvironmentProfile = (environmentId: string) => {
    const environment = snapshot.environments.find((item) => item.id === environmentId)

    if (environment && snapshot.environments.length > 1) {
      setPendingEnvironmentDelete(environment)
    }
  }

  const deleteEnvironmentProfile = (environmentId: string) => {
    void (async () => {
      setEnvironmentDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, draft]) => draft.id !== environmentId),
        ),
      )
      await actions.deleteEnvironment(environmentId)
    })()
  }

  const openNewConnectionDraft = (parentId?: string) => {
    const environmentId =
      snapshot.ui.activeEnvironmentId ||
      activeEnvironment?.id ||
      snapshot.environments[0]?.id ||
      ''
    const draft = createConnectionProfile(environmentId || 'env-local')

    setConnectionDraft(
      environmentId
        ? draft
        : {
            ...draft,
            environmentIds: [],
          },
    )
    setConnectionDraftParentId(parentId)
    void actions.updateUiState({
      activeActivity: 'library',
      activeSidebarPane: 'library',
      sidebarCollapsed: false,
      rightDrawer: 'connection',
    })
  }

  const inspectExplorerNode = (nodeId: string) => {
    if (!activeConnection || !activeEnvironment) {
      return
    }

    void (async () => {
      await actions.inspectExplorer({
        connectionId: activeConnection.id,
        environmentId: activeEnvironment.id,
        nodeId,
      })
      await actions.updateUiState({
        activeBottomPanelTab: 'details',
        bottomPanelVisible: true,
        rightDrawer: 'none',
      })
    })()
  }

  const handleExplorerSelection = (node: NonNullable<typeof explorerItems>[number]) => {
    if (!activeConnection || !activeEnvironment) {
      return
    }

    if (node.expandable || node.scope) {
      void actions.loadExplorer({
        connectionId: activeConnection.id,
        environmentId: activeEnvironment.id,
        scope: node.scope,
        limit: 50,
      })
    }
  }

  const openConnectionExplorer = (connectionId: string) => {
    setConnectionDraft(undefined)
    void (async () => {
      await actions.createExplorerTab(connectionId)
      await actions.updateUiState({
        activeActivity: 'library',
        activeSidebarPane: 'library',
        explorerView: 'structure',
        sidebarCollapsed: false,
        rightDrawer: 'none',
      })
    })()
  }

  const openConnectionMetrics = (connectionId: string) => {
    const connection = snapshot.connections.find((item) => item.id === connectionId)
    const environmentId =
      snapshot.ui.activeEnvironmentId || connection?.environmentIds[0] || activeEnvironment?.id

    setConnectionDraft(undefined)
    void (async () => {
      await actions.createMetricsTab(connectionId, environmentId)
      await actions.updateUiState({
        activeActivity: 'library',
        activeSidebarPane: 'library',
        sidebarCollapsed: false,
        rightDrawer: 'none',
      })
    })()
  }

  const openObjectView = (connectionId: string, node: ExplorerNode) => {
    setConnectionDraft(undefined)
    void (async () => {
      await actions.createObjectViewTab({
        connectionId,
        nodeId: node.id,
        label: node.label,
        kind: node.kind,
        path: node.path,
      })
      await actions.updateUiState({
        activeActivity: 'library',
        activeSidebarPane: 'library',
        sidebarCollapsed: false,
        rightDrawer: 'none',
      })
    })()
  }

  const createApiServerFromNode = (connectionId: string, node: ExplorerNode) => {
    const environmentId =
      activeEnvironment?.id ??
      snapshot.connections.find((connection) => connection.id === connectionId)?.environmentIds[0]
    const resource = apiServerResourceFromExplorerNode(node)
    const name = resource ? `${resource.label} API` : `${node.label} API`

    if (!environmentId) {
      void actions.createApiServerTab()
      return
    }

    void (async () => {
      const created = await actions.createDatastoreApiServer({
        connectionId,
        environmentId,
        name,
        description: resource ? `CRUD API for ${resource.label}.` : undefined,
        protocol: 'rest',
        resources: resource ? [resource] : [],
      })
      let serverId: string | undefined
      if (created) {
        const nextStatus = await refreshApiServerStatus()
        serverId = nextStatus?.activeServerId ?? nextStatus?.serverId
      }
      await actions.createApiServerTab(serverId)
    })()
  }

  const createApiServerFromSidebar = () => {
    const connectionId = activeConnection?.id ?? snapshot.connections[0]?.id
    const environmentId =
      activeEnvironment?.id ??
      (connectionId
        ? snapshot.connections.find((connection) => connection.id === connectionId)?.environmentIds[0]
        : undefined) ??
      snapshot.environments[0]?.id

    void (async () => {
      const created = await actions.createDatastoreApiServer({
        connectionId,
        environmentId,
        protocol: 'rest',
        resources: [],
      })
      let serverId: string | undefined
      if (created) {
        const nextStatus = await refreshApiServerStatus()
        serverId = nextStatus?.activeServerId ?? nextStatus?.serverId
      }
      await actions.createApiServerTab(serverId)
    })()
  }

  const addNodeToApiServer = (connectionId: string, node: ExplorerNode) => {
    const environmentId =
      activeEnvironment?.id ??
      snapshot.connections.find((connection) => connection.id === connectionId)?.environmentIds[0]
    const resource = apiServerResourceFromExplorerNode(node)
    const matchingServer = apiServerInstances.find(
      (server) => server.connectionId === connectionId && server.environmentId === environmentId,
    )
    const targetServerId = matchingServer?.id ?? apiServerPreferences?.activeServerId ?? apiServerInstances[0]?.id

    if (!resource || !targetServerId) {
      if (resource) {
        createApiServerFromNode(connectionId, node)
      } else {
        void actions.createApiServerTab(targetServerId)
      }
      return
    }

    void (async () => {
      const added = await actions.addDatastoreApiServerResources({
        serverId: targetServerId,
        resources: [resource],
      })
      if (added) {
        await refreshApiServerStatus()
      }
      await actions.createApiServerTab(targetServerId)
    })()
  }

  const openActiveMongoAddDocumentView = () => {
    if (!activeConnection || activeConnection.engine !== 'mongodb') {
      return
    }

    const collection = activeMongoQueryScope?.collection
    if (!collection) {
      return
    }

    const database = activeMongoQueryScope.database ?? activeConnection.database ?? ''
    openObjectView(activeConnection.id, {
      id: `insert-document:${database}:${collection}`,
      family: activeConnection.family,
      label: 'Add Document',
      kind: 'insert-document',
      detail: '',
      path: [database, 'Collections', collection].filter(
        (segment): segment is string => Boolean(segment),
      ),
      expandable: false,
    })
  }

  const loadConnectionExplorerScope = (
    connectionId: string,
    scope?: string,
    environmentId?: string,
  ) => {
    const resolvedEnvironmentId = environmentId || activeEnvironmentId

    if (!resolvedEnvironmentId) {
      return
    }

    void (async () => {
      await actions.loadExplorer({
        connectionId,
        environmentId: resolvedEnvironmentId,
        limit: 100,
        scope,
      })
    })()
  }

  const openQueryTab = (connectionId: string | undefined) => {
    if (!connectionId) {
      return
    }

    setConnectionDraft(undefined)
    void (async () => {
      await actions.createTab(connectionId)
      await actions.updateUiState({
        rightDrawer: 'none',
      })
    })()
  }

  const openScopedQuery = (connectionId: string, target: ScopedQueryTarget) => {
    const environmentId =
      snapshot.ui.activeEnvironmentId ||
      snapshot.connections.find((connection) => connection.id === connectionId)?.environmentIds[0]

    setConnectionDraft(undefined)
    void (async () => {
      await actions.createScopedTab({
        connectionId,
        environmentId,
        target,
      })
      await actions.updateUiState({
        rightDrawer: 'none',
      })
    })()
  }

  const openTestSuite = (connectionId?: string, templateId?: string) => {
    const targetConnectionId = connectionId ?? activeConnection?.id

    if (!targetConnectionId) {
      return
    }

    setConnectionDraft(undefined)
    void (async () => {
      await actions.createTestSuiteTab({
        connectionId: targetConnectionId,
        templateId,
      })
      await actions.updateUiState({
        activeActivity: 'library',
        activeSidebarPane: 'library',
        bottomPanelVisible: true,
        rightDrawer: 'none',
        sidebarCollapsed: false,
      })
    })()
  }

  const startApiServerFromSidebar = (serverId: string) => {
    const server = apiServerInstances.find((item) => item.id === serverId)
    if (!server?.connectionId || !server.environmentId) {
      void actions.createApiServerTab(serverId)
      return
    }

    void actions.startDatastoreApiServer({
      serverId,
      connectionId: server.connectionId,
      environmentId: server.environmentId,
      port: server.port,
    }).then((nextStatus) => {
      if (nextStatus) {
        setApiServerStatus(nextStatus)
      }
    })
  }

  const stopApiServerFromSidebar = (serverId: string) => {
    void actions.stopDatastoreApiServer({ serverId }).then((nextStatus) => {
      if (nextStatus) {
        setApiServerStatus(nextStatus)
      }
    })
  }

  const deleteApiServerFromSidebar = (serverId: string) => {
    void actions.deleteDatastoreApiServer({ serverId }).then((deleted) => {
      if (deleted) {
        void refreshApiServerStatus()
      }
    })
  }

  return (
    <div className="ads-shell">
      <GlobalShortcutHandler
        actions={actions}
        activeConnectionId={activeConnection?.id}
        activeTab={activeTab}
        activeTabIsApiServer={activeTabIsApiServer}
        activeTabIsMcpServer={activeTabIsMcpServer}
        activeTabIsSecurityChecks={activeTabIsSecurityChecks}
        activeTabIsEnvironment={activeTabIsEnvironment}
        activeTabIsExplorer={activeTabIsExplorer}
        activeTabIsMetrics={activeTabIsMetrics}
        activeTabIsObjectView={activeTabIsObjectView}
        activeTabIsSettings={activeTabIsSettings}
        activeTabIsTestSuite={activeTabIsTestSuite}
        activeTabIsWorkspaceSearch={activeTabIsWorkspaceSearch}
        bottomPanelVisibleRef={bottomPanelVisibleRef}
        keyboardShortcuts={keyboardShortcuts}
        openQueryTab={openQueryTab}
        requestCloseTab={requestCloseTab}
        requestSaveQuery={requestSaveQuery}
        runCurrentTabQuery={runCurrentTabQuery}
        snapshot={snapshot}
      />
      {reviewConfirmationDialog}
      {pendingTabClose ? (
        <CloseSavedTabDialog
          tab={pendingTabClose.tab}
          onCancel={() => setPendingTabClose(undefined)}
          onDiscard={() => {
            const tabId = pendingTabClose.tab.id
            const remainingTabIds = pendingTabClose.remainingTabIds
            setPendingTabClose(undefined)
            setEnvironmentDrafts((current) => {
              if (!current[tabId]) {
                return current
              }
              const next = { ...current }
              delete next[tabId]
              return next
            })
            setEnvironmentSecretDrafts((current) => {
              const next = { ...current }
              delete next[tabId]
              return next
            })
            void actions.closeTab(tabId).then(() => continuePendingTabClose(remainingTabIds))
          }}
          onSaveAndClose={() => {
            const tabId = pendingTabClose.tab.id
            const remainingTabIds = pendingTabClose.remainingTabIds
            const isEnvironmentTab = pendingTabClose.tab.tabKind === 'environment'
            setPendingTabClose(undefined)
            void (isEnvironmentTab
              ? saveEnvironmentTabDraft(tabId).then(() => actions.closeTab(tabId))
              : flushQueryTabDrafts(tabId).then(() => actions.saveAndCloseTab(tabId)))
              .then(() => continuePendingTabClose(remainingTabIds))
          }}
        />
      ) : null}

      {pendingSaveTab ? (
        <SaveQueryDialog
          tab={pendingSaveTab}
          libraryNodes={snapshot.libraryNodes}
          onCancel={() => setPendingSaveTabId(undefined)}
          onSaveLocal={() => {
            const tabId = pendingSaveTab.id
            setPendingSaveTabId(undefined)
            void flushQueryTabDrafts(tabId).then(() => actions.saveQueryTabToLocalFile({ tabId }))
          }}
          onSaveToLibrary={(request) => {
            const tabId = pendingSaveTab.id
            setPendingSaveTabId(undefined)
            void flushQueryTabDrafts(tabId).then(() =>
              actions.saveQueryTabToLibrary({
                tabId,
                itemId: request.itemId,
                folderId: request.folderId,
                name: request.name,
                kind: inferLibraryItemKindForTab(pendingSaveTab),
                tags: [],
              }),
            )
          }}
        />
      ) : null}

      {pendingConnectionDelete ? (
        <DeleteConnectionDialog
          connection={pendingConnectionDelete}
          onCancel={() => setPendingConnectionDelete(undefined)}
          onConfirm={() => {
            const connectionId = pendingConnectionDelete.id
            setPendingConnectionDelete(undefined)
            void actions.deleteConnection(connectionId)
          }}
        />
      ) : null}

      {pendingLibraryNodeDelete ? (
        <DeleteLibraryNodeDialog
          node={pendingLibraryNodeDelete}
          descendantCount={libraryDescendantCount(
            snapshot.libraryNodes,
            pendingLibraryNodeDelete.id,
          )}
          onCancel={() => setPendingLibraryNodeDelete(undefined)}
          onConfirm={() => {
            const nodeId = pendingLibraryNodeDelete.id
            setPendingLibraryNodeDelete(undefined)
            void actions.deleteLibraryNode({ nodeId })
          }}
        />
      ) : null}

      {pendingEnvironmentDelete ? (
        <DeleteEnvironmentDialog
          environment={pendingEnvironmentDelete}
          onCancel={() => setPendingEnvironmentDelete(undefined)}
          onConfirm={() => {
            const environmentId = pendingEnvironmentDelete.id
            setPendingEnvironmentDelete(undefined)
            deleteEnvironmentProfile(environmentId)
          }}
        />
      ) : null}

      <div
        className={`ads-workbench${snapshot.ui.sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}
        data-tour-id="workbench"
        style={
          {
            '--sidebar-width': `${snapshot.ui.sidebarWidth}px`,
            '--drawer-width': `${snapshot.ui.rightDrawerWidth}px`,
            '--results-side-width': `${snapshot.ui.resultsSideWidth ?? 420}px`,
          } as CSSProperties
        }
      >
        {!snapshot.ui.sidebarCollapsed ? (
          <Suspense fallback={<SidebarFallback />}>
            <SideBar
              ui={snapshot.ui}
              width={snapshot.ui.sidebarWidth}
              connections={snapshot.connections}
              adapterManifests={snapshot.adapterManifests}
              environments={snapshot.environments}
              libraryNodes={snapshot.libraryNodes}
              explorerItems={explorerItems}
              explorerFolderOrders={snapshot.preferences.explorerFolderOrders}
              getConnectionExplorerItems={getConnectionExplorerItems}
              getConnectionExplorerStatus={getConnectionExplorerStatus}
              getConnectionHealth={getConnectionHealth}
              explorerSummary={activeExplorerResponse?.summary ?? explorerError}
              explorerStatus={activeExplorerStatus}
              apiServerEnabled={Boolean(snapshot.preferences.datastoreApiServer?.enabled)}
              activeApiServer={activeTabIsApiServer}
              activeApiServerId={activeApiServerId}
              apiServers={apiServerInstances}
              workspaceSearchEnabled={Boolean(snapshot.preferences.workspaceSearch?.enabled)}
              activeWorkspaceSearch={activeTabIsWorkspaceSearch}
              workspaceSwitcherStatus={workspaceSwitcherStatus}
              createFolderDialogRequestRevision={guideFolderDialogRequestRevision}
              closeFolderDialogRequestRevision={guideFolderDialogCloseRequestRevision}
              isExplorerScopeLoading={isConnectionExplorerScopeLoading}
              activeConnectionId={activeConnection?.id ?? ''}
              activeEnvironmentId={activeEnvironment?.id ?? ''}
              onSelectConnection={(connectionId) => void actions.selectConnection(connectionId)}
              onSelectEnvironment={(environmentId) =>
                void actions.createEnvironmentTab(environmentId)
              }
              onCreateConnection={openNewConnectionDraft}
              onCreateEnvironment={() => void actions.createEnvironment()}
              onCloneEnvironment={(environmentId) => {
                const environment = snapshot.environments.find((item) => item.id === environmentId)
                if (environment) {
                  cloneEnvironmentProfile(environment)
                }
              }}
              onEditEnvironment={(environmentId) =>
                void actions.createEnvironmentTab(environmentId)
              }
              onDeleteEnvironment={requestDeleteEnvironmentProfile}
              onConnectionGroupModeChange={(connectionGroupMode) =>
                void actions.updateUiState({ connectionGroupMode })
              }
              onSidebarSectionExpandedChange={(sectionId, expanded) =>
                void actions.updateUiState({
                  sidebarSectionStates: {
                    ...(snapshot.ui.sidebarSectionStates ?? {}),
                    [sectionId]: expanded,
                  },
                })
              }
              onDuplicateConnection={(connectionId) =>
                void actions.duplicateConnection(connectionId)
              }
              onDeleteConnection={requestDeleteConnection}
              onOpenConnectionExplorer={openConnectionExplorer}
              onOpenConnectionMetrics={openConnectionMetrics}
              onOpenConnectionDrawer={openConnectionDrawerFor}
              onTestConnection={(connectionId, environmentId) => {
                const connection = snapshot.connections.find((item) => item.id === connectionId)
                if (connection) {
                  void actions.testConnection(
                    connection,
                    environmentId ?? activeEnvironment?.id ?? '',
                    undefined,
                  )
                }
              }}
              onLoadExplorerScope={loadConnectionExplorerScope}
              onOpenObjectView={openObjectView}
              onCreateApiServerFromNode={
                snapshot.preferences.datastoreApiServer?.enabled ? createApiServerFromNode : undefined
              }
              onAddNodeToApiServer={
                snapshot.preferences.datastoreApiServer?.enabled ? addNodeToApiServer : undefined
              }
              onOpenScopedQuery={openScopedQuery}
              onCreateTab={(connectionId) => openQueryTab(connectionId ?? activeConnection?.id)}
              onCreateApiServer={
                snapshot.preferences.datastoreApiServer?.enabled ? createApiServerFromSidebar : undefined
              }
              onOpenApiServer={(serverId) => void actions.createApiServerTab(serverId)}
              onOpenWorkspaceSearch={() => void actions.createWorkspaceSearchTab()}
              onStartApiServer={startApiServerFromSidebar}
              onStopApiServer={stopApiServerFromSidebar}
              onDeleteApiServer={deleteApiServerFromSidebar}
              onCreateTestSuite={(connectionId) => openTestSuite(connectionId)}
              onCreateWorkspace={(name) => void actions.createWorkspace({ name })}
              onOpenTestSuiteTemplate={(connectionId, templateId) =>
                openTestSuite(connectionId, templateId)
              }
              onCreateLibraryFolder={createLibraryFolder}
              onDeleteLibraryNode={requestDeleteLibraryNode}
              onMoveLibraryNode={moveLibraryNode}
              onOpenLibraryItem={(nodeId) => void actions.openLibraryItem(nodeId)}
              onRenameLibraryNode={renameLibraryNode}
              onRenameWorkspace={(workspaceId, name) =>
                void actions.renameWorkspace({ workspaceId, name })
              }
              onSetLibraryNodeEnvironment={setLibraryNodeEnvironment}
              onSetExplorerFolderOrder={(orderKey, orderedNodeKeys) =>
                void actions.setExplorerFolderOrder({ orderKey, orderedNodeKeys })
              }
              onSwitchWorkspace={(workspaceId) =>
                void actions.switchWorkspace({ workspaceId })
              }
              onExplorerFilterChange={(value) =>
                void actions.updateUiState({ explorerFilter: value })
              }
              onRefreshExplorer={() =>
                activeConnection && activeEnvironment
                  ? void actions.loadExplorer({
                      connectionId: activeConnection.id,
                      environmentId: activeEnvironment.id,
                      limit: 50,
                    })
                  : undefined
              }
              onSelectExplorerNode={handleExplorerSelection}
              onInspectExplorerNode={(node) => inspectExplorerNode(node.id)}
              onResize={(width) =>
                void actions.updateUiState({
                  sidebarWidth: width,
                })
              }
              onCollapseSidebar={() =>
                void actions.updateUiState({
                  sidebarCollapsed: true,
                })
              }
            />
          </Suspense>
        ) : null}

        {snapshot.ui.sidebarCollapsed ? (
          <div className="collapsed-library-rail" aria-label="Collapsed Library">
            <button
              type="button"
              className="show-library-button"
              aria-label="Show Library"
              title="Show Library"
              onClick={() =>
                void actions.updateUiState({
                  sidebarCollapsed: false,
                  activeActivity: 'library',
                  activeSidebarPane: 'library',
                })
              }
            >
              <SavedWorkIcon className="panel-inline-icon" />
            </button>
          </div>
        ) : null}

        <div className={`workbench-center${resultsDockRight && shouldShowBottomPanel ? ' has-right-results' : ''}`}>
          <main
            className="editor-workspace"
            data-tour-id={activeTabIsSettings ? 'settings-workspace' : undefined}
          >
            <>
                <EditorTabs
                  tabs={displayTabs}
                  activeTabId={activeTab?.id ?? ''}
                  connections={snapshot.connections}
                  environments={snapshot.environments}
                  onSelectTab={(tabId) => void actions.selectTab(tabId)}
                  onCloseTab={requestCloseTab}
                  onCloseTabs={requestCloseTabs}
                  onRenameTab={(tabId, title) => void actions.renameTab(tabId, title)}
                  onSaveTab={requestSaveQuery}
                  onReorderTabs={(orderedTabIds) =>
                    void actions.reorderTabs(orderedTabIds)
                  }
                />

              <Suspense fallback={<WorkbenchPaneFallback />}>
                {activeTabIsSettings && activeTab ? (
                  <SettingsWorkspace
                    key={`settings-workspace-${settingsInitialSectionRequest.revision}`}
                    diagnostics={diagnostics}
                    health={payload.health}
                    initialSection={settingsInitialSectionRequest.section}
                    preferences={snapshot.preferences}
                    workspaceSwitcherStatus={workspaceSwitcherStatus}
                    updateCheckResult={appUpdateCheckResult}
                    updateDownload={appUpdateDownload}
                    updateError={appUpdateError}
                    updateInstallStatus={appUpdateInstallStatus}
                    updateSettings={appUpdateSettings}
                    updateStatus={appUpdateStatus}
                    onClearLogFile={actions.clearAppLogFile}
                    onCheckForUpdates={() => void actions.checkAppUpdate()}
                    onCreateBackup={async (automatic = false) => {
                      return actions.createWorkspaceBackupNow({ automatic })
                    }}
                    onDeleteBackup={(backupId) =>
                      actions.deleteWorkspaceBackup({ backupId })
                    }
                    onDeleteLogFile={actions.deleteAppLogFile}
                    onExportWorkspaceFile={async (passphrase, includeSecrets) => {
                      const response = await actions.exportWorkspaceFile({
                        passphrase,
                        includeSecrets,
                      })
                      return response?.path
                    }}
                    onImportWorkspaceFile={(passphrase) =>
                      actions.importWorkspaceFile({ passphrase })
                    }
                    onInstallUpdate={() => void actions.installAppUpdate()}
                    onListBackups={actions.listWorkspaceBackups}
                    onListLogFiles={actions.listAppLogFiles}
                    onReadLogFile={actions.readAppLogFile}
                    onRestoreBackup={(backupId, passphrase) =>
                      actions.restoreWorkspaceBackup({ backupId, passphrase })
                    }
                    onSetKeyboardShortcut={actions.setKeyboardShortcut}
                    onSetSafeMode={(enabled) => void actions.setSafeModeEnabled(enabled)}
                    onSetTheme={(theme) => void actions.setTheme(theme)}
                    onSetUpdatePrereleases={(enabled) => void actions.setAppUpdateSettings(enabled)}
                    onOpenApiServer={() => void actions.createApiServerTab()}
                    onOpenMcpServer={() => void actions.createMcpServerTab()}
                    onOpenWorkspaceSearch={() => void actions.createWorkspaceSearchTab()}
                    onOpenSecurityChecks={() => void actions.createSecurityChecksTab()}
                    onUpdateApiServerSettings={actions.updateDatastoreApiServerSettings}
                    onUpdateMcpServerSettings={actions.updateDatastoreMcpServerSettings}
                    onUpdateBackupSettings={actions.updateWorkspaceBackupSettings}
                    onUpdateWorkspaceSwitcherSettings={actions.setWorkspaceSwitcherEnabled}
                    onUpdateWorkspaceSearchSettings={actions.updateWorkspaceSearchSettings}
                    onUpdateSecurityCheckSettings={actions.updateDatastoreSecurityCheckSettings}
                  />
                ) : activeTabIsApiServer && activeTab ? (
                  <ApiServerWorkspace
                    key={activeTab.id}
                    serverId={activeApiServerId}
                    connections={snapshot.connections}
                    environments={snapshot.environments}
                    preferences={snapshot.preferences}
                    onOpenExperimentalSettings={() => openDiagnosticsDrawer('experimental')}
                    onGetStatus={getApiServerStatus}
                    onGetMetrics={actions.getDatastoreApiServerMetrics}
                    onGetLogs={actions.getDatastoreApiServerLogs}
                    onDeleteServer={actions.deleteDatastoreApiServer}
                    onUpdateServer={actions.updateDatastoreApiServer}
                    onDiscoverResources={actions.discoverDatastoreApiServerResources}
                    onAddResources={actions.addDatastoreApiServerResources}
                    onRemoveResource={actions.removeDatastoreApiServerResource}
                    onDiscoverQuerySources={actions.discoverDatastoreApiServerQuerySources}
                    onAddCustomEndpoint={actions.addDatastoreApiServerCustomEndpoint}
                    onUpdateCustomEndpoint={actions.updateDatastoreApiServerCustomEndpoint}
                    onRemoveCustomEndpoint={actions.removeDatastoreApiServerCustomEndpoint}
                    onExportProject={actions.exportDatastoreApiServerProjectFile}
                    onUpdateSettings={updateApiServerSettings}
                    onStart={startApiServer}
                    onStop={stopApiServer}
                  />
                ) : activeTabIsMcpServer && activeTab ? (
                  <McpServerWorkspace
                    key={activeTab.id}
                    serverId={activeMcpServerId}
                    connections={snapshot.connections}
                    environments={snapshot.environments}
                    preferences={snapshot.preferences}
                    onOpenExperimentalSettings={() => openDiagnosticsDrawer('experimental')}
                    onGetStatus={getMcpServerStatus}
                    onGetMetrics={actions.getDatastoreMcpServerMetrics}
                    onGetLogs={actions.getDatastoreMcpServerLogs}
                    onCreateServer={actions.createDatastoreMcpServer}
                    onDeleteServer={actions.deleteDatastoreMcpServer}
                    onUpdateServer={actions.updateDatastoreMcpServer}
                    onUpdateSettings={updateMcpServerSettings}
                    onStart={startMcpServer}
                    onStop={stopMcpServer}
                    onCreateToken={actions.createDatastoreMcpServerToken}
                    onDeleteToken={actions.deleteDatastoreMcpServerToken}
                    onPreviewClientSetup={actions.previewDatastoreMcpClientSetup}
                    onApplyClientSetup={actions.applyDatastoreMcpClientSetup}
                  />
                ) : activeTabIsWorkspaceSearch && activeTab ? (
                  <WorkspaceSearchWorkspace
                    key={activeTab.id}
                    snapshot={snapshot}
                    enabled={Boolean(snapshot.preferences.workspaceSearch?.enabled)}
                    onOpenExperimentalSettings={() => openDiagnosticsDrawer('experimental')}
                    onOpenConnection={(connectionId) => {
                      void actions.selectConnection(connectionId)
                      openConnectionDrawerFor(connectionId)
                    }}
                    onOpenLibraryItem={(nodeId) => void actions.openLibraryItem(nodeId)}
                    onSelectTab={(tabId) => void actions.selectTab(tabId)}
                    onReopenClosedTab={(closedTabId) => void actions.reopenClosedTab(closedTabId)}
                  />
                ) : activeTabIsSecurityChecks && activeTab ? (
                  <SecurityChecksWorkspace
                    key={activeTab.id}
                    snapshot={snapshot}
                    enabled={Boolean(snapshot.preferences.datastoreSecurityChecks?.enabled)}
                    onOpenExperimentalSettings={() => openDiagnosticsDrawer('experimental')}
                    onMutedFindingIdsChange={(mutedFindingIds) =>
                      actions.updateDatastoreSecurityCheckSettings({
                        enabled: Boolean(snapshot.preferences.datastoreSecurityChecks?.enabled),
                        refreshIntervalDays:
                          snapshot.preferences.datastoreSecurityChecks?.refreshIntervalDays ?? 7,
                        mutedFindingIds,
                      })
                    }
                    onRefresh={actions.refreshDatastoreSecurityChecks}
                  />
                ) : activeTabIsEnvironment && activeTab ? (
                  <EnvironmentWorkspace
                    key={activeTab.id}
                    activeEnvironment={activeEnvironmentDraft}
                    environments={snapshot.environments}
                    onCreateEnvironment={() => void actions.createEnvironment()}
                    onCloneEnvironment={cloneEnvironmentProfile}
                    onEnvironmentChange={(environment) =>
                      setEnvironmentDrafts((current) => ({
                        ...current,
                        [activeTab.id]: environment,
                      }))
                    }
                    secretDrafts={environmentSecretDrafts[activeTab.id] ?? {}}
                    onSecretDraftsChange={(secretDrafts) =>
                      setEnvironmentSecretDrafts((current) => ({
                        ...current,
                        [activeTab.id]: secretDrafts,
                      }))
                    }
                    onSaveEnvironment={() => void saveEnvironmentTabDraft(activeTab.id)}
                  />
                ) : activeTabIsExplorer ? (
                  <StructureWorkspace
                    activeConnection={activeConnection}
                    activeEnvironment={activeEnvironment}
                    status={structureStatus}
                    structure={structure}
                    error={structureError}
                    onRefresh={(options) =>
                      activeConnection && activeEnvironment
                        ? void actions.loadStructureMap({
                            connectionId: activeConnection.id,
                            environmentId: activeEnvironment.id,
                            limit: 120,
                            ...options,
                          })
                        : undefined
                    }
                    onInspectNode={(node) => {
                      inspectExplorerNode(node.id)
                    }}
                    onOpenQuery={(node, queryText) => {
                      if (!activeConnection) {
                        return
                      }

                      openScopedQuery(activeConnection.id, {
                        kind: node.isView ? 'view' : 'table',
                        label: node.objectName,
                        path: [node.schema, node.objectName],
                        scope: node.qualifiedName,
                        queryTemplate: queryText,
                      })
                    }}
                    onOpenObjectView={(node) => {
                      if (!activeConnection) {
                        return
                      }

                      openObjectView(activeConnection.id, node)
                    }}
                  />
                ) : activeTabIsMetrics && activeConnection && activeEnvironment && activeTab ? (
                  <MetricsWorkspace
                    connection={activeConnection}
                    environment={activeEnvironment}
                    tab={activeTab}
                    onRefresh={(tabId) => actions.refreshMetricsTab(tabId)}
                  />
                ) : activeTabIsObjectView && activeConnection && activeEnvironment && activeTab ? (
                  <ObjectViewWorkspace
                    connection={activeConnection}
                    environment={activeEnvironment}
                    tab={activeTab}
                    onRefresh={(tabId) => actions.refreshObjectViewTab(tabId)}
                    onOpenQuery={(target) => openScopedQuery(activeConnection.id, target)}
                    onOpenObjectView={openObjectView}
                    onPlanOperation={planDatastoreOperationWithConfirmation}
                    onExecuteDataEdit={actions.executeDataEdit}
                  />
                ) : activeTabIsTestSuite && activeConnection && activeEnvironment && activeTab ? (
                  <TestSuiteWorkspace
                    tab={activeTab}
                    connection={activeConnection}
                    resolvedTheme={resolvedTheme}
                    testWindowMode={testWindowMode}
                    executionStatus={activeExecutionStatus}
                    onModeChange={setTestWindowMode}
                    onRunSuite={() =>
                      void actions.executeTestSuite({
                        tabId: activeTab.id,
                      })
                    }
                    onCancelRun={() =>
                      activeTab.testRun?.id
                        ? void actions.cancelTestRun({
                            tabId: activeTab.id,
                            runId: activeTab.testRun.id,
                          })
                        : undefined
                    }
                    onUpdateSuite={(suite) =>
                      void actions.updateTestSuiteTab({
                        tabId: activeTab.id,
                        suite,
                      })
                    }
                    onUpdateRaw={(rawText) =>
                      void actions.updateTestSuiteTab({
                        tabId: activeTab.id,
                        rawText,
                      })
                    }
                  />
                ) : activeConnection && activeEnvironment && activeTab ? (
                  <>
                    <EditorToolbar
                      executionStatus={activeExecutionStatus}
                      capabilities={runtimeCapabilities}
                      canCancelExecution={canCancelExecution}
                      bottomPanelVisible={snapshot.ui.bottomPanelVisible}
                      onExecute={() => runCurrentTabQuery()}
                      onExplain={() => runCurrentTabQuery('explain')}
                      onCancel={() =>
                        activeExecutionId
                          ? void actions.cancelExecution(activeExecutionId, activeTab.id)
                          : undefined
                      }
                      onOpenConnectionDrawer={openConnectionDrawer}
                      canAddDocument={Boolean(
                        activeConnection.engine === 'mongodb' &&
                        activeMongoQueryScope?.collection,
                      )}
                      onAddDocument={openActiveMongoAddDocumentView}
                      canToggleDocumentEfficiency={Boolean(
                        activeConnection.engine === 'mongodb' &&
                        activeTab.tabKind !== 'explorer' &&
                        activeTab.tabKind !== 'metrics' &&
                        activeTab.tabKind !== 'object-view' &&
                        activeQueryWindowMode !== 'script',
                      )}
                      documentEfficiencyMode={activeDocumentEfficiencyMode}
                      onToggleDocumentEfficiency={() => {
                        void actions.updateQuery(
                          activeTab.id,
                          resolveQueryText(activeTab),
                          undefined,
                          !activeDocumentEfficiencyMode,
                        )
                      }}
                      canToggleBuilderView={hasBuilderQuery}
                      builderKind={activeBuilderKind}
                      queryWindowMode={activeQueryWindowMode}
                      onToggleQueryWindowMode={(mode) => {
                        setQueryWindowMode(mode)
                        if (activeTab) {
                          queryWindowModeByTabRef.current[activeTab.id] = mode
                          const queryTimer = queryTextDraftSyncTimersRef.current[activeTab.id]
                          const scriptTimer = scriptTextDraftSyncTimersRef.current[activeTab.id]

                          if (queryTimer) {
                            window.clearTimeout(queryTimer)
                            delete queryTextDraftSyncTimersRef.current[activeTab.id]
                          }

                          if (scriptTimer) {
                            window.clearTimeout(scriptTimer)
                            delete scriptTextDraftSyncTimersRef.current[activeTab.id]
                          }

                          const modeText =
                            mode === 'script'
                              ? scriptTextDraftRef.current[activeTab.id] ??
                                activeTab.scriptText ??
                                (activeConnection
                                  ? defaultScriptTextForConnection(activeConnection)
                                  : '') ??
                                ''
                              : resolveQueryText(activeTab)
                          if (mode === 'script') {
                            rememberScriptTextDraft(activeTab.id, modeText)
                            mirrorScriptTextDraft(activeTab.id, modeText)
                          } else {
                            rememberQueryTextDraft(activeTab.id, modeText)
                            mirrorQueryTextDraft(activeTab.id, modeText)
                          }
                          void actions.updateQuery(activeTab.id, modeText, mode)
                        }
                      }}
                      executeLabel={
                        activeSelectedText
                          ? 'Run Selection'
                          : activeRedisKeyBrowserVisible
                            ? 'Refresh'
                          : activeTabUsesRedisConsole
                            ? 'Run Command'
                            : undefined
                      }
                      executeAriaLabel={
                        activeSelectedText
                          ? 'Run selected text'
                          : activeRedisKeyBrowserVisible
                            ? 'Refresh Redis keys'
                          : activeTabUsesRedisConsole
                            ? 'Run Redis command'
                            : undefined
                      }
                      executeTitle={
                        activeSelectedText
                          ? 'Run only the selected text. Shortcut: Ctrl+Enter.'
                          : activeRedisKeyBrowserVisible
                            ? 'Refresh the Redis key browser. Shortcut: Ctrl+Enter.'
                          : activeTabUsesRedisConsole
                          ? activeRedisConsoleVisible
                            ? 'Run the current Redis command. Shortcut: Ctrl+Enter.'
                            : 'Switch to Redis Console to run a command.'
                          : undefined
                      }
                      executeDisabled={
                        activeTabUsesRedisConsole &&
                        !activeRedisConsoleVisible &&
                        !activeRedisKeyBrowserVisible
                      }
                      onToggleBottomPanel={() =>
                        void actions.updateUiState({
                          bottomPanelVisible: !snapshot.ui.bottomPanelVisible,
                        })
                      }
                    />

                    <div className="editor-surface">
                      <div className="editor-surface-meta">
                        <span className="editor-surface-context">
                          {activeConnection.name} / {activeEnvironment.label}
                        </span>
                        <ConnectionHealthChip
                          health={activeConnectionHealth}
                          environmentLabel={activeEnvironment.label}
                        />
                        {activeMongoQueryScope ? (
                          <div className="editor-query-scope" aria-label="MongoDB query scope">
                            <span className="editor-query-scope-item">
                              <span className="editor-query-scope-label">Database</span>
                              <strong>{activeMongoQueryScope.database ?? 'Not selected'}</strong>
                            </span>
                            <span className="editor-query-scope-item">
                              <span className="editor-query-scope-label">Collection</span>
                              <strong>{activeMongoQueryScope.collection ?? 'Not selected'}</strong>
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <div
                        className={`editor-query-layout query-layout--${activeQueryWindowMode}`}
                        role="presentation"
                      >
                        {hasBuilderQuery && activeQueryWindowMode === 'builder' ? (
                          <QueryBuilderPanel
                            connection={activeConnection}
                            tab={activeTab}
                            builderState={activeBuilderState}
                            collectionOptions={queryBuilderOptions}
                            tableOptions={queryBuilderOptions}
                            onBuilderStateChange={persistBuilderState}
                            onExecuteDataEdit={actions.executeDataEdit}
                            onScanRedisKeys={actions.scanRedisKeys}
                            onInspectRedisKey={actions.inspectRedisKey}
                            redisRefreshSignal={redisBrowserRefreshSignals[activeTab.id] ?? 0}
                          />
                        ) : null}
                        {activeQueryWindowMode !== 'builder' ? (
                          activeRedisConsoleVisible ? (
                            <RedisConsoleEditor
                              value={activeEditorQueryText ?? 'PING'}
                              engineLabel={activeConnection.engine === 'valkey' ? 'Valkey' : 'Redis'}
                              history={
                                isRedisKeyBrowserState(activeBuilderState)
                                  ? activeBuilderState.consoleHistory ?? []
                                  : []
                              }
                              pipelineMode={
                                isRedisKeyBrowserState(activeBuilderState)
                                  ? Boolean(activeBuilderState.pipelineMode)
                                  : false
                              }
                              theme={resolvedTheme}
                              resetKey={activeEditorResetKey}
                              completionContext={completionContext}
                              completionProviders={completionProviders}
                              onRequestCompletionRefresh={requestIntellisenseRefresh}
                              onRun={() => runCurrentTabQuery()}
                              onSelectionChange={rememberActiveEditorSelection}
                              onPipelineModeChange={(enabled) => {
                                setRedisConsolePipelineMode(
                                  activeTab.id,
                                  activeBuilderState,
                                  enabled,
                                )
                              }}
                              onChange={(value) => {
                                scheduleQueryTextDraftSync(activeTab.id, value)
                              }}
                            />
                          ) : activeQueryWindowMode === 'script' ? (
                            <DesktopCodeEditor
                              value={activeEditorQueryText ?? ''}
                              language="javascript"
                              theme={resolvedTheme}
                              resetKey={activeEditorResetKey}
                              ariaLabel="MongoDB script editor"
                              completionContext={completionContext}
                              completionProviders={completionProviders}
                              onRequestCompletionRefresh={requestIntellisenseRefresh}
                              onSelectionChange={rememberActiveEditorSelection}
                              onChange={(value) => {
                                const nextScriptText = value ?? ''
                                scheduleScriptTextDraftSync(activeTab.id, nextScriptText)
                              }}
                            />
                          ) : (
                            <DesktopCodeEditor
                              value={activeEditorQueryText ?? activeTab.queryText}
                              language={runtimeCapabilities.editorLanguage}
                              theme={resolvedTheme}
                              resetKey={activeEditorResetKey}
                              completionContext={completionContext}
                              completionProviders={completionProviders}
                              onRequestCompletionRefresh={requestIntellisenseRefresh}
                              onSelectionChange={rememberActiveEditorSelection}
                              onChange={(value) => {
                                const nextQueryText = value ?? ''
                                scheduleQueryTextDraftSync(activeTab.id, nextQueryText)
                              }}
                              onDropField={(fieldPath) => {
                                const nextQueryText = appendFieldToQueryText(
                                  activeTabQueryText ?? activeTab.queryText,
                                  fieldPath,
                                )
                                commitQueryTextDraft(activeTab.id, nextQueryText, 'raw')
                              }}
                            />
                          )
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : (
                  <WelcomeSurface
                    onCreateConnection={openNewConnectionDraft}
                    onImportWorkspace={openDiagnosticsDrawer}
                    onOpenDiagnostics={openDiagnosticsDrawer}
                    onStartTutorial={startFirstInstallGuide}
                  />
                )}
              </Suspense>
              </>
          </main>

          {shouldShowBottomPanel ? (
            <Suspense fallback={null}>
              <BottomPanel
                activeTab={activeTab}
                activeConnection={activeConnection}
                activeEnvironment={activeEnvironment}
                activePanelTab={snapshot.ui.activeBottomPanelTab}
                dock={resultsDock}
                height={snapshot.ui.bottomPanelHeight}
                sideWidth={snapshot.ui.resultsSideWidth ?? 420}
                activePayload={activePayload}
                activeRenderer={activeRenderer}
                diagnostics={diagnostics}
                explorerInspection={explorerInspection}
                lastExecution={lastExecution}
                lastExecutionRequest={lastExecutionRequest}
                capabilities={runtimeCapabilities}
                workbenchMessages={workbenchMessages}
                onSelectPanelTab={(tab) =>
                  void actions.updateUiState({
                    activeBottomPanelTab: tab,
                    bottomPanelVisible: true,
                  })
                }
                onSelectRenderer={(renderer) =>
                  activeTab
                    ? setRendererPreference({ renderer, tabId: activeTab.id })
                    : undefined
                }
                onLoadNextPage={() =>
                  activeTab
                    ? void actions.fetchResultPage(activeTab.id, activeRenderer)
                    : undefined
                }
                onResultRendered={actions.markExecutionDisplayed}
                onExportResultFile={actions.exportResultFile}
                onFetchDocumentNodeChildren={actions.fetchDocumentNodeChildren}
                onResize={(nextSize) =>
                  void actions.updateUiState(
                    resultsDockRight
                      ? { resultsSideWidth: nextSize }
                      : { bottomPanelHeight: nextSize },
                  )
                }
                onToggleDock={() =>
                  void actions.updateUiState({
                    resultsDock: resultsDockRight ? 'bottom' : 'right',
                  })
                }
                onClose={() =>
                  void actions.updateUiState({
                    bottomPanelVisible: false,
                  })
                }
                onConfirmExecution={(guardrailId, mode) =>
                  activeTab
                    ? void confirmExecutionGuardrail(
                        guardrailId,
                        mode,
                        lastExecution?.guardrail.reasons,
                        lastExecution?.guardrail.requiredConfirmationText,
                      )
                    : undefined
                }
                onApplyInspectionTemplate={(queryTemplate) =>
                  queryTemplate ? replaceActiveRawQueryText(queryTemplate) : undefined
                }
                onRestoreHistory={replaceActiveRawQueryText}
                onExecuteDataEdit={actions.executeDataEdit}
                onPlanOperation={planDatastoreOperationWithConfirmation}
                onDismissWorkbenchMessage={actions.dismissWorkbenchMessage}
                onClearWorkbenchMessages={actions.clearWorkbenchMessages}
                onOpenSecuritySettings={() => openDiagnosticsDrawer('security')}
                onEditConnection={() => {
                  if (activeConnection) {
                    openConnectionDrawerFor(activeConnection.id)
                  }
                }}
              />
            </Suspense>
          ) : null}
        </div>

        {snapshot.ui.rightDrawer !== 'none' ? (
          <Suspense fallback={null}>
            <RightDrawer
              key={[
                snapshot.ui.rightDrawer,
                drawerConnection?.id ?? 'none',
              ].join('-')}
              view={snapshot.ui.rightDrawer}
              width={snapshot.ui.rightDrawerWidth}
              health={payload.health}
              theme={snapshot.preferences.theme}
              activeConnection={drawerConnection}
              environments={snapshot.environments}
              connectionTest={connectionTest}
              diagnostics={diagnostics}
              explorerInspection={explorerInspection}
              exportBundle={exportBundle}
              capabilities={runtimeCapabilities}
              exportPassphrase={exportPassphrase}
              importPayload={importPayload}
              onExportPassphraseChange={setExportPassphrase}
              onImportPayloadChange={setImportPayload}
              onClose={closeDrawer}
              onSaveConnection={saveConnectionProfile}
              onTestConnection={(profile, environmentId, secret) =>
                actions.testConnection(
                  profile,
                  environmentId || '',
                  secret,
                )
              }
              onRefreshDiagnostics={() => void actions.refreshDiagnostics()}
              onExportWorkspace={(includeSecrets) =>
                void actions.exportWorkspace(exportPassphrase, includeSecrets)
              }
              onImportWorkspace={(encryptedPayload) =>
                void actions.importWorkspace(exportPassphrase, encryptedPayload)
              }
              onApplyTemplate={(queryTemplate) =>
                queryTemplate && activeTab
                  ? replaceActiveRawQueryText(queryTemplate)
                  : undefined
              }
              onToggleTheme={() =>
                void actions.setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
              }
              onPickLocalDatabaseFile={actions.pickLocalDatabaseFile}
              onCreateLocalDatabase={actions.createLocalDatabase}
              onResize={(width) =>
                void actions.updateUiState({
                  rightDrawerWidth: width,
                })
              }
            />
          </Suspense>
        ) : null}
      </div>

      <FirstInstallGuide
        snapshot={snapshot}
        connectionDraftOpen={Boolean(connectionDraft)}
        startRequestRevision={guideStartRequestRevision}
        onStart={startFirstInstallGuide}
        onSkip={() => void actions.setFirstInstallGuideStatus('skipped')}
        onComplete={() => void actions.setFirstInstallGuideStatus('completed')}
        onStepChange={(stepId) => void actions.setFirstInstallGuideStatus('started', stepId)}
        onOpenLibrary={openLibraryForGuide}
        onRequestCreateFolder={requestGuideFolderDialog}
        onCloseCreateFolder={closeGuideFolderDialog}
        onOpenConnection={openNewConnectionDraft}
        onOpenConnectionPanel={openConnectionDrawerFor}
        onCloseConnectionPanel={closeDrawer}
        onOpenExplorer={openConnectionExplorer}
        onOpenQuery={openQueryTab}
        onOpenSettings={() => openDiagnosticsDrawer('security')}
        onShowResults={() =>
          void actions.updateUiState({
            activeBottomPanelTab: 'results',
            bottomPanelVisible: true,
          })
        }
        onSelectTab={(tabId) => void actions.selectTab(tabId)}
        onCloseTab={(tabId) => void actions.closeTab(tabId)}
        onRestoreUiState={(patch) => void actions.updateUiState(patch)}
      />

      <StatusBar
        activeConnection={activeConnection}
        activeEnvironment={activeEnvironment}
        activeTab={activeTab}
        apiServerIndicator={{
          visible: showApiServerStatusIndicator,
          runningCount: runningApiServerCount,
          onOpen: () => void actions.createApiServerTab(apiServerStatusTargetId),
        }}
        availableUpdateVersion={availableAppUpdate?.version}
        bottomPanelVisible={snapshot.ui.bottomPanelVisible}
        mcpServerIndicator={{
          visible: showMcpServerStatusIndicator,
          running: mcpServerRunning,
          onOpen: () => void actions.createMcpServerTab(mcpServerStatusTargetId),
        }}
        messageCount={workbenchMessages.length}
        securityChecksIndicator={
          securityStatusCounts
            ? {
                ...securityStatusCounts,
                onOpen: () => void actions.createSecurityChecksTab(),
              }
            : undefined
        }
        updateInstallStatus={appUpdateInstallStatus}
        updateStatus={appUpdateStatus}
        onInstallUpdate={() => void actions.installAppUpdate()}
        onToggleBottomPanel={() =>
          void actions.updateUiState({
            bottomPanelVisible: !snapshot.ui.bottomPanelVisible,
          })
        }
        onOpenMessages={actions.openWorkbenchMessages}
        onOpenDiagnostics={openDiagnosticsDrawer}
      />
    </div>
  )
}

function buildQueryTextForBuilderState(
  builderState: QueryBuilderState,
  connection: ConnectionProfile | undefined,
  tab?: QueryTabState,
) {
  if (isMongoFindBuilderState(builderState)) {
    return buildMongoFindQueryText(builderState, {
      database: mongoQueryScopeForTab({ builderState, connection, tab })?.database,
    })
  }

  if (isMongoAggregationBuilderState(builderState)) {
    return buildMongoAggregationQueryText(builderState, {
      database: mongoQueryScopeForTab({ builderState, connection, tab })?.database,
    })
  }

  if (connection && isSqlSelectBuilderState(builderState)) {
    return buildSqlSelectQueryText(builderState, connection.engine)
  }

  if (isDynamoDbKeyConditionBuilderState(builderState)) {
    return buildDynamoDbKeyConditionQueryText(builderState)
  }

  if (isCqlPartitionBuilderState(builderState)) {
    return buildCqlPartitionQueryText(builderState)
  }

  if (isSearchDslBuilderState(builderState)) {
    return buildSearchDslQueryText(builderState)
  }

  if (isRedisKeyBrowserState(builderState)) {
    return undefined
  }

  return undefined
}

function apiServerInstancesFromPreferences(
  preferences: WorkspaceSnapshot['preferences']['datastoreApiServer'] | undefined,
): DatastoreApiServerInstanceStatus[] {
  const hasLegacyServer = !preferences?.servers?.length && Boolean(preferences) && (
    typeof preferences?.connectionId === 'string' ||
    typeof preferences?.environmentId === 'string' ||
    Boolean(preferences?.autoStart) ||
    (typeof preferences?.port === 'number' && preferences.port !== 17640) ||
    (typeof preferences?.activeServerId === 'string' &&
      preferences.activeServerId !== 'api-server-default')
  )
  const servers = preferences?.servers?.length
    ? preferences.servers
    : hasLegacyServer
      ? [{
        id: preferences?.activeServerId || 'api-server-default',
        name: 'Local API Server',
        host: '127.0.0.1' as const,
        port: preferences?.port ?? 17640,
        autoStart: preferences?.autoStart ?? false,
        connectionId: preferences?.connectionId,
        environmentId: preferences?.environmentId,
        protocol: 'rest' as const,
        basePath: '',
        resources: [],
        customEndpoints: [],
      }]
      : []
  const enabled = Boolean(preferences?.enabled)

  return servers.map((server, index) => {
    const port = clampApiServerPort(server.port)
    return {
      id: server.id || `api-server-${index + 1}`,
      name: server.name?.trim() || (port === 17640 ? 'Local API Server' : `Local API Server ${port}`),
      description: server.description,
      running: false,
      host: '127.0.0.1',
      port,
      protocol: server.protocol ?? 'rest',
      basePath: server.basePath ?? '',
      baseUrl: enabled ? `http://127.0.0.1:${port}` : undefined,
      connectionId: server.connectionId,
      environmentId: server.environmentId,
      message: enabled
        ? 'Experimental datastore API server is stopped.'
        : 'Experimental datastore API server is disabled.',
      warnings: enabled ? ['Localhost only.'] : [],
      resources: server.resources ?? [],
      customEndpoints: server.customEndpoints ?? [],
    }
  })
}

function apiServerIdFromTab(tab: QueryTabState | undefined) {
  return tab?.scopedTarget?.kind === 'api-server' ? tab.scopedTarget.scope : undefined
}

function mcpServerInstancesFromPreferences(
  preferences: WorkspaceSnapshot['preferences']['datastoreMcpServer'] | undefined,
): DatastoreMcpServerInstanceStatus[] {
  const hasLegacyServer = !preferences?.servers?.length && Boolean(preferences) && (
    Boolean(preferences?.autoStart) ||
    (typeof preferences?.port === 'number' && preferences.port !== 17641) ||
    (typeof preferences?.activeServerId === 'string' &&
      preferences.activeServerId !== 'mcp-server-default')
  )
  const servers = preferences?.servers?.length
    ? preferences.servers
    : hasLegacyServer
      ? [{
        id: preferences?.activeServerId || 'mcp-server-default',
        name: 'Local MCP Server',
        host: '127.0.0.1' as const,
        port: preferences?.port ?? 17641,
        autoStart: preferences?.autoStart ?? false,
        allowedOrigins: [],
        connectionIds: [],
        environmentIds: [],
        tokens: [],
      }]
      : []
  const enabled = Boolean(preferences?.enabled)

  return servers.map((server, index) => {
    const port = clampMcpServerPort(server.port)
    return {
      id: server.id || `mcp-server-${index + 1}`,
      name: server.name?.trim() || (port === 17641 ? 'Local MCP Server' : `Local MCP Server ${port}`),
      description: server.description,
      running: false,
      host: '127.0.0.1',
      port,
      endpoint: enabled ? `http://127.0.0.1:${port}/mcp` : undefined,
      message: enabled
        ? 'Experimental MCP server is stopped.'
        : 'Experimental MCP server is disabled.',
      warnings: enabled ? ['Localhost only. Bearer token required.'] : [],
      allowedOrigins: server.allowedOrigins ?? [],
      connectionIds: server.connectionIds ?? [],
      environmentIds: server.environmentIds ?? [],
      tokenCount: (server.tokens ?? []).filter((token) => token.enabled).length,
    }
  })
}

function mcpServerIdFromTab(tab: QueryTabState | undefined) {
  return tab?.scopedTarget?.kind === 'mcp-server' ? tab.scopedTarget.scope : undefined
}

function clampMcpServerPort(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 17641
  }
  return Math.min(65535, Math.max(1024, Math.floor(value as number)))
}

function clampApiServerPort(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 17640
  }
  return Math.min(65535, Math.max(1024, Math.floor(value as number)))
}

function apiServerResourceFromExplorerNode(
  node: ExplorerNode,
): DatastoreApiServerResourceConfig | undefined {
  const kind = apiServerResourceKind(node.kind)
  if (!kind) {
    return undefined
  }

  return {
    id: `api-resource:${kind}:${node.id}`,
    kind,
    label: node.label,
    nodeId: node.id,
    path: Array.isArray(node.path) ? node.path : [],
    scope: node.scope,
    endpointSlug: apiServerSlug(node.label),
    enabled: true,
    detail: node.detail || undefined,
    metadata: {
      sourceKind: node.kind,
    },
  }
}

function apiServerResourceKind(
  kind: string,
): DatastoreApiServerResourceConfig['kind'] | undefined {
  const normalized = kind.trim().toLowerCase()
  if (normalized === 'table' || normalized.endsWith('-table')) {
    return 'table'
  }
  if (normalized === 'collection' || normalized.endsWith('-collection')) {
    return 'collection'
  }
  if (normalized === 'key' || normalized.endsWith('-key')) {
    return 'key'
  }
  if (normalized === 'item' || normalized.endsWith('-item')) {
    return 'item'
  }
  if (normalized === 'index' || normalized.endsWith('-index')) {
    return 'index'
  }
  return undefined
}

function apiServerSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'resource'
}

function inferLibraryItemKindForTab(tab: QueryTabState): LibraryItemKind {
  if (tab.tabKind === 'test-suite' || tab.testSuite) {
    return 'test-suite'
  }

  if (tab.queryViewMode === 'script') {
    return 'script'
  }

  if (/\.(ps1|sh|bash|bat|cmd|js|ts|py)$/i.test(tab.title)) {
    return 'script'
  }

  return 'query'
}

function environmentTabTitle(label: string) {
  return `Environment - ${label.trim() || 'Untitled'}`
}

function libraryDescendantCount(nodes: LibraryNode[], nodeId: string) {
  const descendants = new Set<string>()
  let changed = true

  while (changed) {
    changed = false
    nodes.forEach((node) => {
      if (
        node.parentId &&
        (node.parentId === nodeId || descendants.has(node.parentId)) &&
        !descendants.has(node.id)
      ) {
        descendants.add(node.id)
        changed = true
      }
    })
  }

  return descendants.size
}

export default App
