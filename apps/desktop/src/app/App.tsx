import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExecutionRequest,
  ExplorerNode,
  LibraryItemKind,
  LibraryNode,
  QueryBuilderState,
  QueryTabState,
  QueryViewMode,
  ScopedQueryTarget,
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
import { comparableEnvironment } from './components/workbench/EnvironmentWorkspace.helpers'
import { RedisConsoleEditor } from './components/workbench/RedisConsoleEditor'
import { StatusBar } from './components/workbench/StatusBar'
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
import {
  explorerCacheKey,
  hasExplorerScope,
  isExplorerRequestLoading,
} from './state/app-state-reducer-helpers'
import { connectionLibraryNodeId } from '../services/runtime/library-connection-helpers'
import { createConnectionProfile, createEnvironmentProfile } from './state/app-state-factories'
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
    executionStatus,
    lastExecution,
    lastExecutionRequest,
    connectionTests,
    startupErrorMessage,
    workbenchMessages,
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
  const [connectionDraft, setConnectionDraft] = useState<ConnectionProfile | undefined>()
  const [connectionDraftParentId, setConnectionDraftParentId] = useState<string | undefined>()
  const [environmentDrafts, setEnvironmentDrafts] = useState<
    Record<string, EnvironmentProfile>
  >({})
  const [environmentSecretDrafts, setEnvironmentSecretDrafts] = useState<
    Record<string, Record<string, string>>
  >({})
  const initializedQueryModeByTabRef = useRef<Record<string, string>>({})
  const environmentDraftsRef = useRef<Record<string, EnvironmentProfile>>({})
  const environmentSecretDraftsRef = useRef<Record<string, Record<string, string>>>({})
  const builderStateDraftRef = useRef<Record<string, QueryBuilderState>>({})
  const [builderStateDrafts, setBuilderStateDrafts] = useState<
    Record<string, QueryBuilderState>
  >({})
  const queryTextDraftRef = useRef<Record<string, string>>({})
  const scriptTextDraftRef = useRef<Record<string, string>>({})
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

  const snapshot = payload?.snapshot
  const activeConnection =
    snapshot?.connections.find((item) => item.id === snapshot.ui.activeConnectionId) ??
    snapshot?.connections[0]
  const activeTabFromSelection = snapshot?.tabs.find(
    (item) =>
      item.id === snapshot.ui.activeTabId &&
      (item.tabKind === 'environment' ||
        !activeConnection ||
        item.connectionId === activeConnection.id),
  )
  const activeTab =
    activeTabFromSelection ??
    (activeConnection
      ? snapshot?.tabs.find((item) => item.connectionId === activeConnection.id)
      : undefined)
  const activeTabId = activeTab?.id
  const activeTabIsExplorer = activeTab?.tabKind === 'explorer'
  const activeTabIsMetrics = activeTab?.tabKind === 'metrics'
  const activeTabIsObjectView = activeTab?.tabKind === 'object-view'
  const activeTabIsTestSuite = activeTab?.tabKind === 'test-suite'
  const activeTabIsEnvironment = activeTab?.tabKind === 'environment'
  const activeEnvironment =
    snapshot?.environments.find((item) => item.id === snapshot.ui.activeEnvironmentId) ??
    snapshot?.environments[0]
  const loadExplorer = actions.loadExplorer
  const activeSidebarPane = snapshot?.ui.activeSidebarPane
  useLayoutEffect(() => {
    bottomPanelVisibleRef.current = Boolean(snapshot?.ui.bottomPanelVisible)
  }, [snapshot?.ui.bottomPanelVisible])
  const activeConnectionId = activeConnection?.id
  const activeEnvironmentId = activeEnvironment?.id
  const activeExplorerCacheEntry =
    activeConnectionId && activeEnvironmentId
      ? explorerCache?.[explorerCacheKey(activeConnectionId, activeEnvironmentId)]
      : undefined
  const activeExplorerResponse = activeExplorerCacheEntry?.response
  const runtimeCapabilities =
    activeConnection && activeExplorerResponse?.capabilities
      ? activeExplorerResponse.capabilities
      : activeConnection && snapshot
        ? deriveCapabilities(snapshot, activeConnection)
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
  const activeRedisConsoleCommand =
    activeTabUsesRedisConsole && activeTab
      ? redisConsoleCommandFromQueryText(activeTab.queryText, activeBuilderState)
      : undefined
  const activeEditorQueryText =
    activeRedisConsoleCommand ??
    (activeTab && activeQueryWindowMode === 'script'
      ? activeTab.scriptText ?? (activeConnection ? defaultScriptTextForConnection(activeConnection) : '')
      : undefined) ??
    (activeTab &&
    activeBuilderState &&
    activeQueryWindowMode === 'builder'
      ? buildQueryTextForBuilderState(activeBuilderState, activeConnection)
      : activeTab?.queryText)
  const activeMongoQueryScope = mongoQueryScopeForTab({
    builderState: activeBuilderState,
    connection: activeConnection,
    queryText: activeEditorQueryText,
    scriptText: activeTab?.scriptText,
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
      activeTabIsEnvironment
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

    return buildQueryTextForBuilderState(builderState, activeConnection)
  }, [activeConnection, activeQueryWindowMode])
  const resolveQueryText = useCallback((tab: QueryTabState): string => {
    const hasDraftText =
      Object.prototype.hasOwnProperty.call(queryTextDraftRef.current, tab.id) &&
      typeof queryTextDraftRef.current[tab.id] === 'string'

    return hasDraftText ? (queryTextDraftRef.current[tab.id] ?? tab.queryText) : tab.queryText
  }, [])
  const requestIntellisenseRefresh = useCallback(() => {
    if (!activeConnectionId || !activeEnvironmentId) {
      return
    }

    void actions.loadStructureMap({
      connectionId: activeConnectionId,
      environmentId: activeEnvironmentId,
      limit: 160,
    })
  }, [actions, activeConnectionId, activeEnvironmentId])

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

    if (activeQueryWindowMode === 'script') {
      const scriptText =
        scriptTextDraftRef.current[activeTab.id] ??
        activeTab.scriptText ??
        (activeConnection ? defaultScriptTextForConnection(activeConnection) : '') ??
        ''
      void actions.executeQuery(
        activeTab.id,
        mode,
        guardrailId,
        resolveQueryText(activeTab),
        'script',
        scriptText,
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
        return
      }

      const redisCommand = redisConsoleCommandFromQueryText(
        resolveQueryText(activeTab),
        builderState,
      )
      queryTextDraftRef.current[activeTab.id] = redisCommand
      void actions.executeQuery(activeTab.id, mode, guardrailId, redisCommand, 'raw')
      return
    }

    if (!generatedQueryText || !builderState) {
      void actions.executeQuery(activeTab.id, mode, guardrailId, resolveQueryText(activeTab), 'raw')
      return
    }

    void actions.executeQuery(activeTab.id, mode, guardrailId, generatedQueryText, 'builder')
  }, [
    actions,
    activeConnection,
    activeQueryWindowMode,
    activeTab,
    resolveBuilderQueryText,
    resolveQueryText,
  ])

  const persistBuilderState = (tabId: string, builderState: QueryBuilderState) => {
    if (!snapshot) {
      return
    }

    const targetTab = snapshot.tabs.find((item) => item.id === tabId)

    if (!targetTab) {
      return
    }

    const liveQueryText = buildQueryTextForBuilderState(builderState, activeConnection)
    const nextBuilderState =
      liveQueryText
        ? {
            ...builderState,
            lastAppliedQueryText: liveQueryText,
          }
        : builderState

    builderStateDraftRef.current[tabId] = nextBuilderState
    if (liveQueryText !== undefined) {
      queryTextDraftRef.current[tabId] = liveQueryText
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
        tab.tabKind === 'environment'
      ) {
        return
      }

      const connection = snapshot?.connections.find((item) => item.id === tab.connectionId)
      const builderState = builderStateDraftRef.current[tabId]
      const draftQueryText = queryTextDraftRef.current[tabId]
      const draftScriptText = scriptTextDraftRef.current[tabId]

      if (draftScriptText !== undefined) {
        await actions.updateQuery(tabId, draftScriptText, 'script')
      }

      if (builderState) {
        const generatedQueryText =
          draftQueryText ?? buildQueryTextForBuilderState(builderState, connection)

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
      await actions.saveEnvironment(draft, secretDrafts)
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
    if (!activeTabId || !activeTab || activeTabIsTestSuite || activeTabIsEnvironment) {
      return
    }

    const modeKey = `${activeBuilderKind ?? 'raw'}:${activeTab.queryViewMode ?? 'default'}`

    if (initializedQueryModeByTabRef.current[activeTabId] === modeKey) {
      return
    }

    initializedQueryModeByTabRef.current[activeTabId] = modeKey
    setQueryWindowMode(
      normalizeQueryWindowMode(
        activeTab.queryViewMode,
        activeBuilderKind,
        activeConnection,
      ),
    )
  }, [
    activeBuilderKind,
    activeConnection,
    activeTab,
    activeTabId,
    activeTabIsEnvironment,
    activeTabIsTestSuite,
  ])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()

      if (event.key === 'F5') {
        event.preventDefault()

        if (activeTab && !activeTabIsExplorer && !activeTabIsEnvironment) {
          runCurrentTabQuery()
        }

        return
      }

      const hasPrimaryModifier = event.metaKey || event.ctrlKey

      if (!hasPrimaryModifier || event.altKey) {
        return
      }

      if (!snapshot || !activeTab) {
        return
      }

      if (key === 's') {
        event.preventDefault()
        if (!activeTabIsExplorer && !activeTabIsMetrics && !activeTabIsObjectView) {
          requestSaveQuery(activeTab.id)
        }
        return
      }

      if (key === 'enter') {
        event.preventDefault()
        if (!activeTabIsExplorer && !activeTabIsEnvironment) {
          runCurrentTabQuery()
        }
        return
      }

      if (key === 'j') {
        event.preventDefault()
        const bottomPanelVisible = !bottomPanelVisibleRef.current
        bottomPanelVisibleRef.current = bottomPanelVisible
        void actions.updateUiState({
          bottomPanelVisible,
        })
        return
      }

      if (key === 'e' && event.shiftKey) {
        event.preventDefault()
        if (
          !activeTabIsExplorer &&
          !activeTabIsMetrics &&
          !activeTabIsObjectView &&
          !activeTabIsTestSuite &&
          !activeTabIsEnvironment
        ) {
          runCurrentTabQuery('explain')
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    actions,
    activeTab,
    activeTabIsExplorer,
    activeTabIsEnvironment,
    activeTabIsMetrics,
    activeTabIsObjectView,
    activeTabIsTestSuite,
    requestSaveQuery,
    runCurrentTabQuery,
    snapshot,
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
      !activeTabIsExplorer
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
  const connectionTest = drawerConnection ? connectionTests[drawerConnection.id] : undefined
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
  const displayTabs = snapshot.tabs.map((tab) => {
    if (tab.tabKind !== 'environment') {
      return tab
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
  const canCancelExecution = Boolean(
    runtimeCapabilities.canCancel && lastExecution?.executionId,
  )
  const showingExplorerWorkspace = activeTabIsExplorer
  const showingMetricsWorkspace = activeTabIsMetrics
  const showingObjectViewWorkspace = activeTabIsObjectView
  const hasWorkbenchMessages = workbenchMessages.length > 0
  const hasActivePanelContext = Boolean(activeTab && activeConnection && activeEnvironment)
  const hasActiveQueryContext = Boolean(
    hasActivePanelContext &&
      !activeTabIsExplorer &&
      !activeTabIsMetrics &&
      !activeTabIsObjectView &&
      !activeTabIsTestSuite &&
      !activeTabIsEnvironment,
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
      requestCloseTabQueue(remainingTabIds)
      return
    }

    if (
      tab.tabKind !== 'explorer' &&
      tab.tabKind !== 'metrics' &&
      tab.tabKind !== 'object-view' &&
      (tab.tabKind === 'environment'
        ? environmentTabHasChanges(tab)
        : Boolean((tab.saveTarget || tab.savedQueryId) && tab.dirty))
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

  const createLibraryFolder = (parentId?: string) => {
    const name = window.prompt('New Library folder name')

    if (name?.trim()) {
      void actions.createLibraryFolder({ parentId, name: name.trim() })
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

  const openDiagnosticsDrawer = () => {
    setConnectionDraft(undefined)
    void actions.updateUiState({
      activeActivity: 'library',
      activeSidebarPane: 'library',
      rightDrawer: 'diagnostics',
      sidebarCollapsed: false,
    })
  }

  const closeDrawer = () => {
    setConnectionDraft(undefined)
    setConnectionDraftParentId(undefined)
    void actions.updateUiState({
      activeActivity: snapshot.ui.activeActivity === 'settings' ? 'library' : snapshot.ui.activeActivity,
      rightDrawer: 'none',
    })
  }

  const saveConnectionProfile = (
    profile: ConnectionProfile,
    secret: string | undefined,
  ) => {
    void (async () => {
      let nextProfile = profile

      if (connectionDraft?.id === profile.id && profile.environmentIds.length === 0) {
        const environment = createEnvironmentProfile()
        await actions.saveEnvironment(environment)
        nextProfile = {
          ...profile,
          environmentIds: [environment.id],
          updatedAt: new Date().toISOString(),
        }
      }

      const saved = await actions.saveConnection(nextProfile, secret)
      if (!saved) {
        return
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
    })()
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
      await actions.saveEnvironment(clone)
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

  return (
    <div className="ads-shell">
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
              closedTabs={snapshot.closedTabs}
              explorerItems={explorerItems}
              getConnectionExplorerItems={getConnectionExplorerItems}
              getConnectionExplorerStatus={getConnectionExplorerStatus}
              explorerSummary={activeExplorerResponse?.summary ?? explorerError}
              explorerStatus={activeExplorerStatus}
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
              onTestConnection={(connectionId) => {
                const connection = snapshot.connections.find((item) => item.id === connectionId)
                if (connection) {
                  void actions.testConnection(connection, activeEnvironment?.id ?? '', undefined)
                }
              }}
              onLoadExplorerScope={loadConnectionExplorerScope}
              onOpenObjectView={openObjectView}
              onOpenScopedQuery={openScopedQuery}
              onCreateTab={(connectionId) => openQueryTab(connectionId ?? activeConnection?.id)}
              onCreateTestSuite={(connectionId) => openTestSuite(connectionId)}
              onOpenTestSuiteTemplate={(connectionId, templateId) =>
                openTestSuite(connectionId, templateId)
              }
              onCreateLibraryFolder={createLibraryFolder}
              onDeleteLibraryNode={requestDeleteLibraryNode}
              onMoveLibraryNode={moveLibraryNode}
              onOpenLibraryItem={(nodeId) => void actions.openLibraryItem(nodeId)}
              onRenameLibraryNode={renameLibraryNode}
              onSetLibraryNodeEnvironment={setLibraryNodeEnvironment}
              onReopenClosedTab={(closedTabId) => void actions.reopenClosedTab(closedTabId)}
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
          <main className="editor-workspace">
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
                {activeTabIsEnvironment && activeTab ? (
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
                    onRefresh={() =>
                      activeConnection && activeEnvironment
                        ? void actions.loadStructureMap({
                            connectionId: activeConnection.id,
                            environmentId: activeEnvironment.id,
                            limit: 120,
                          })
                        : undefined
                    }
                    onInspectNode={(node) => {
                      inspectExplorerNode(node.id)
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
                    onPlanOperation={actions.planDatastoreOperation}
                    onExecuteDataEdit={actions.executeDataEdit}
                  />
                ) : activeTabIsTestSuite && activeConnection && activeEnvironment && activeTab ? (
                  <TestSuiteWorkspace
                    tab={activeTab}
                    connection={activeConnection}
                    resolvedTheme={resolvedTheme}
                    testWindowMode={testWindowMode}
                    executionStatus={executionStatus}
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
                      executionStatus={executionStatus}
                      capabilities={runtimeCapabilities}
                      canCancelExecution={canCancelExecution}
                      bottomPanelVisible={snapshot.ui.bottomPanelVisible}
                      resultsDock={resultsDock}
                      onExecute={() => runCurrentTabQuery()}
                      onExplain={() => runCurrentTabQuery('explain')}
                      onCancel={() =>
                        lastExecution?.executionId
                          ? void actions.cancelExecution(lastExecution.executionId, activeTab.id)
                          : undefined
                      }
                      onOpenConnectionDrawer={openConnectionDrawer}
                      canToggleBuilderView={hasBuilderQuery}
                      builderKind={activeBuilderKind}
                      queryWindowMode={activeQueryWindowMode}
                      onToggleQueryWindowMode={(mode) => {
                        setQueryWindowMode(mode)
                        if (activeTab) {
                          const modeText =
                            mode === 'script'
                              ? scriptTextDraftRef.current[activeTab.id] ??
                                activeTab.scriptText ??
                                (activeConnection
                                  ? defaultScriptTextForConnection(activeConnection)
                                  : '') ??
                                ''
                              : resolveQueryText(activeTab)
                          void actions.updateQuery(activeTab.id, modeText, mode)
                        }
                      }}
                      executeLabel={activeTabUsesRedisConsole ? 'Run Command' : undefined}
                      executeAriaLabel={
                        activeTabUsesRedisConsole ? 'Run Redis command' : undefined
                      }
                      executeTitle={
                        activeTabUsesRedisConsole
                          ? activeRedisConsoleVisible
                            ? 'Run the current Redis command. Shortcut: Ctrl+Enter.'
                            : 'Switch to Redis Console to run a command. Use the browser toolbar to scan keys.'
                          : undefined
                      }
                      executeDisabled={activeTabUsesRedisConsole && !activeRedisConsoleVisible}
                      onToggleBottomPanel={() =>
                        void actions.updateUiState({
                          bottomPanelVisible: !snapshot.ui.bottomPanelVisible,
                        })
                      }
                      onToggleResultsDock={() =>
                        void actions.updateUiState({
                          bottomPanelVisible: true,
                          resultsDock: resultsDockRight ? 'bottom' : 'right',
                        })
                      }
                    />

                    <div className="editor-surface">
                      <div className="editor-surface-meta">
                        <span className="editor-surface-context">
                          {activeConnection.name} / {activeEnvironment.label}
                        </span>
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
                          />
                        ) : null}
                        {activeQueryWindowMode !== 'builder' ? (
                          activeRedisConsoleVisible ? (
                            <RedisConsoleEditor
                              value={activeEditorQueryText ?? 'PING'}
                              engineLabel={activeConnection.engine === 'valkey' ? 'Valkey' : 'Redis'}
                              theme={resolvedTheme}
                              completionContext={completionContext}
                              completionProviders={completionProviders}
                              onRequestCompletionRefresh={requestIntellisenseRefresh}
                              onRun={() => runCurrentTabQuery()}
                              onChange={(value) => {
                                queryTextDraftRef.current[activeTab.id] = value
                                void actions.updateQuery(activeTab.id, value)
                              }}
                            />
                          ) : activeQueryWindowMode === 'script' ? (
                            <DesktopCodeEditor
                              value={activeEditorQueryText ?? ''}
                              language="javascript"
                              theme={resolvedTheme}
                              ariaLabel="MongoDB script editor"
                              completionContext={completionContext}
                              completionProviders={completionProviders}
                              onRequestCompletionRefresh={requestIntellisenseRefresh}
                              onChange={(value) => {
                                const nextScriptText = value ?? ''
                                scriptTextDraftRef.current[activeTab.id] = nextScriptText
                                void actions.updateQuery(activeTab.id, nextScriptText, 'script')
                              }}
                            />
                          ) : (
                            <DesktopCodeEditor
                              value={activeEditorQueryText ?? activeTab.queryText}
                              language={runtimeCapabilities.editorLanguage}
                              theme={resolvedTheme}
                              completionContext={completionContext}
                              completionProviders={completionProviders}
                              onRequestCompletionRefresh={requestIntellisenseRefresh}
                              onChange={(value) => {
                                const nextQueryText = value ?? ''
                                queryTextDraftRef.current[activeTab.id] = nextQueryText
                                void actions.updateQuery(activeTab.id, nextQueryText, 'raw')
                              }}
                              onDropField={(fieldPath) => {
                                const nextQueryText = appendFieldToQueryText(
                                  activeTab.queryText,
                                  fieldPath,
                                )
                                queryTextDraftRef.current[activeTab.id] = nextQueryText
                                void actions.updateQuery(activeTab.id, nextQueryText)
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
                onResize={(nextSize) =>
                  void actions.updateUiState(
                    resultsDockRight
                      ? { resultsSideWidth: nextSize }
                      : { bottomPanelHeight: nextSize },
                  )
                }
                onClose={() =>
                  void actions.updateUiState({
                    bottomPanelVisible: false,
                  })
                }
                onConfirmExecution={(guardrailId, mode) =>
                  activeTab
                    ? runCurrentTabQuery(mode, guardrailId)
                    : undefined
                }
                onApplyInspectionTemplate={(queryTemplate) =>
                  queryTemplate &&
                  activeTab &&
                  !activeTabIsExplorer &&
                  !activeTabIsMetrics &&
                  !activeTabIsObjectView
                    ? void actions.updateQuery(activeTab.id, queryTemplate)
                    : undefined
                }
                onRestoreHistory={(queryText) =>
                  activeTab ? void actions.updateQuery(activeTab.id, queryText) : undefined
                }
                onExecuteDataEdit={actions.executeDataEdit}
                onDismissWorkbenchMessage={actions.dismissWorkbenchMessage}
                onClearWorkbenchMessages={actions.clearWorkbenchMessages}
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
                drawerConnection?.updatedAt ?? 'none',
                activeEnvironment?.id ?? 'none',
                activeEnvironment?.updatedAt ?? 'none',
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
                void actions.testConnection(
                  profile,
                  environmentId || activeEnvironment?.id || '',
                  secret,
                )
              }
              onRefreshDiagnostics={() => void actions.refreshDiagnostics()}
              onExportWorkspace={() => void actions.exportWorkspace(exportPassphrase)}
              onImportWorkspace={(encryptedPayload) =>
                void actions.importWorkspace(exportPassphrase, encryptedPayload)
              }
              onApplyTemplate={(queryTemplate) =>
                queryTemplate && activeTab
                  ? void actions.updateQuery(activeTab.id, queryTemplate)
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

      <StatusBar
        health={payload.health}
        theme={snapshot.preferences.theme}
        activeConnection={activeConnection}
        activeEnvironment={activeEnvironment}
        activeTab={activeTab}
        bottomPanelVisible={snapshot.ui.bottomPanelVisible}
        messageCount={workbenchMessages.length}
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
) {
  if (isMongoFindBuilderState(builderState)) {
    return buildMongoFindQueryText(builderState)
  }

  if (isMongoAggregationBuilderState(builderState)) {
    return buildMongoAggregationQueryText(builderState)
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

function defaultQueryWindowModeForBuilderKind(
  builderKind: QueryBuilderState['kind'],
): QueryViewMode {
  return builderKind ? 'builder' : 'raw'
}

function normalizeQueryWindowMode(
  queryViewMode: QueryViewMode | 'both' | undefined,
  builderKind: QueryBuilderState['kind'] | undefined,
  connection: ConnectionProfile | undefined,
): QueryViewMode {
  if (queryViewMode === 'script' && connection?.engine === 'mongodb') {
    return 'script'
  }

  if (queryViewMode === 'raw') {
    return 'raw'
  }

  if (queryViewMode === 'builder' || queryViewMode === 'both') {
    return builderKind ? 'builder' : 'raw'
  }

  return builderKind ? defaultQueryWindowModeForBuilderKind(builderKind) : 'raw'
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
