import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExecutionRequest,
  LibraryItemKind,
  QueryBuilderState,
  QueryTabState,
  ScopedQueryTarget,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ActivityBar } from './components/workbench/ActivityBar'
import {
  CloseSavedTabDialog,
  DeleteConnectionDialog,
  SaveQueryDialog,
} from './components/workbench/AppDialogs'
import { BootSurface, WelcomeSurface } from './components/workbench/BootSurfaces'
import { BottomPanel } from './components/workbench/BottomPanel'
import { DesktopCodeEditor } from './components/workbench/DesktopCodeEditor'
import { EditorTabs } from './components/workbench/EditorTabs'
import { EditorToolbar } from './components/workbench/EditorToolbar'
import { EnvironmentWorkspace } from './components/workbench/EnvironmentWorkspace'
import { MetricsWorkspace } from './components/workbench/MetricsWorkspace'
import { RightDrawer } from './components/workbench/RightDrawer'
import { RedisConsoleEditor } from './components/workbench/RedisConsoleEditor'
import { SideBar } from './components/workbench/SideBar'
import { StatusBar } from './components/workbench/StatusBar'
import { StructureWorkspace } from './components/workbench/StructureWorkspace'
import { TestSuiteWorkspace } from './components/workbench/TestSuiteWorkspace'
import { QueryBuilderPanel } from './components/workbench/query-builder/QueryBuilderPanel'
import {
  buildCqlPartitionQueryText,
  isCqlPartitionBuilderState,
  parseCqlPartitionQueryText,
} from './components/workbench/query-builder/cql-partition'
import {
  buildDynamoDbKeyConditionQueryText,
  isDynamoDbKeyConditionBuilderState,
  parseDynamoDbKeyConditionQueryText,
} from './components/workbench/query-builder/dynamodb-key-condition'
import {
  buildMongoFindQueryText,
  isMongoFindBuilderState,
  parseMongoFindQueryText,
} from './components/workbench/query-builder/mongo-find'
import {
  buildSqlSelectQueryText,
  isSqlSelectBuilderState,
  parseSqlSelectQueryText,
} from './components/workbench/query-builder/sql-select'
import {
  buildSearchDslQueryText,
  isSearchDslBuilderState,
  parseSearchDslQueryText,
} from './components/workbench/query-builder/search-dsl'
import {
  isRedisKeyBrowserState,
  parseRedisKeyBrowserQueryText,
} from './components/workbench/query-builder/redis-key-browser'
import {
  isRedisConsoleTab,
  redisConsoleCommandFromQueryText,
} from './components/workbench/query-builder/redis-console'
import { completionProvidersForConnection } from './components/workbench/intellisense/providers'
import { useQueryIntellisenseCatalog } from './components/workbench/intellisense/useQueryIntellisenseCatalog'
import { AppStateProvider, useAppState } from './state/app-state'
import { createConnectionProfile, createEnvironmentProfile } from './state/app-state-factories'
import {
  appendFieldToQueryText,
  builderStateForTab,
  defaultCapabilities,
  deriveCapabilities,
  queryBuilderObjectOptions,
  resolveThemeMode,
  selectPayload,
} from './workspace-helpers'

export function App() {
  return (
    <ErrorBoundary>
      <AppStateProvider>
        <DesktopWorkspace />
      </AppStateProvider>
    </ErrorBoundary>
  )
}

function DesktopWorkspace() {
  const {
    status,
    payload,
    diagnostics,
    exportBundle,
    explorer,
    explorerError,
    explorerInspection,
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
  const [exportPassphrase, setExportPassphrase] = useState('datapadplusplus-desktop')
  const [importPayload, setImportPayload] = useState('')
  const [rendererPreference, setRendererPreference] = useState<{
    renderer?: string
    tabId?: string
  }>({})
  const [queryWindowMode, setQueryWindowMode] = useState<'both' | 'builder' | 'raw'>(
    'raw',
  )
  const [connectionDraft, setConnectionDraft] = useState<ConnectionProfile | undefined>()
  const initializedQueryModeByTabRef = useRef<Record<string, string>>({})
  const builderStateDraftRef = useRef<Record<string, QueryBuilderState>>({})
  const [builderStateDrafts, setBuilderStateDrafts] = useState<
    Record<string, QueryBuilderState>
  >({})
  const queryTextDraftRef = useRef<Record<string, string>>({})
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
  const bottomPanelVisibleRef = useRef(false)
  const sidebarCollapsedRef = useRef(false)
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

  const snapshot = payload?.snapshot
  const activeConnection =
    snapshot?.connections.find((item) => item.id === snapshot.ui.activeConnectionId) ??
    snapshot?.connections[0]
  const activeTabFromSelection = snapshot?.tabs.find(
    (item) =>
      item.id === snapshot.ui.activeTabId &&
      (!activeConnection || item.connectionId === activeConnection.id),
  )
  const activeTab =
    activeTabFromSelection ??
    (activeConnection
      ? snapshot?.tabs.find((item) => item.connectionId === activeConnection.id)
      : undefined)
  const activeTabId = activeTab?.id
  const activeTabIsExplorer = activeTab?.tabKind === 'explorer'
  const activeTabIsMetrics = activeTab?.tabKind === 'metrics'
  const activeTabIsTestSuite = activeTab?.tabKind === 'test-suite'
  const activeEnvironment =
    snapshot?.environments.find((item) => item.id === snapshot.ui.activeEnvironmentId) ??
    snapshot?.environments[0]
  const loadExplorer = actions.loadExplorer
  const activeSidebarPane = snapshot?.ui.activeSidebarPane
  const sidebarCollapsed = snapshot?.ui.sidebarCollapsed
  useLayoutEffect(() => {
    bottomPanelVisibleRef.current = Boolean(snapshot?.ui.bottomPanelVisible)
    sidebarCollapsedRef.current = Boolean(sidebarCollapsed)
  }, [sidebarCollapsed, snapshot?.ui.bottomPanelVisible])
  const activeConnectionId = activeConnection?.id
  const activeEnvironmentId = activeEnvironment?.id
  const runtimeCapabilities =
    activeConnection && explorer?.capabilities
      ? explorer.capabilities
      : activeConnection && snapshot
        ? deriveCapabilities(snapshot, activeConnection)
        : defaultCapabilities()
  const hasActiveExplorerResponse = Boolean(
    activeConnection &&
      explorer?.connectionId === activeConnection.id &&
      explorer.environmentId === activeEnvironmentId,
  )
  const activeConnectionExplorerItems = hasActiveExplorerResponse ? explorer?.nodes ?? [] : []
  const explorerSourceNodes = hasActiveExplorerResponse
    ? activeConnectionExplorerItems
    : snapshot?.explorerNodes ?? []
  const activeBuilderState =
    activeTab &&
    !activeTabIsExplorer &&
    !activeTabIsMetrics &&
    !activeTabIsTestSuite &&
    activeConnection
      ? builderStateForTab(activeTab, activeConnection, builderStateDrafts)
      : undefined
  const activeBuilderKind = activeBuilderState?.kind
  const hasBuilderQuery = Boolean(activeBuilderState)
  const activeQueryWindowMode: 'both' | 'builder' | 'raw' = hasBuilderQuery
    ? queryWindowMode
    : 'raw'
  const activeTabUsesRedisConsole = isRedisConsoleTab(activeTab)
  const activeRedisConsoleVisible =
    activeTabUsesRedisConsole &&
    (!isRedisKeyBrowserState(activeBuilderState) || activeQueryWindowMode !== 'builder')
  const activeRedisConsoleCommand =
    activeTabUsesRedisConsole && activeTab
      ? redisConsoleCommandFromQueryText(activeTab.queryText, activeBuilderState)
      : undefined
  const activeEditorQueryText =
    activeRedisConsoleCommand ??
    (activeTab &&
    activeBuilderState &&
    activeQueryWindowMode !== 'raw'
      ? buildQueryTextForBuilderState(activeBuilderState, activeConnection)
      : activeTab?.queryText)
  const intellisenseCatalog = useQueryIntellisenseCatalog({
    connection: activeConnection,
    environment: activeEnvironment,
    tab: activeTab,
    explorerNodes: explorerSourceNodes,
    structure,
    resultPayloads: activeTab?.result?.payloads,
  })
  const completionProviders = useMemo(
    () => completionProvidersForConnection(activeConnection, runtimeCapabilities.editorLanguage),
    [activeConnection, runtimeCapabilities.editorLanguage],
  )
  const completionContext = useMemo(() => {
    if (
      !activeConnection ||
      !activeEnvironment ||
      !activeTab ||
      activeTabIsExplorer ||
      activeTabIsMetrics ||
      activeTabIsTestSuite
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
    activeTabIsTestSuite,
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

    if (activeQueryWindowMode === 'raw') {
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
      void actions.executeQuery(activeTab.id, mode, guardrailId, redisCommand)
      return
    }

    if (!generatedQueryText || !builderState) {
      void actions.executeQuery(activeTab.id, mode, guardrailId, resolveQueryText(activeTab))
      return
    }

    void actions.updateQueryBuilderState({
      tabId: activeTab.id,
      builderState: {
        ...builderState,
        lastAppliedQueryText: generatedQueryText,
      },
      queryText: generatedQueryText,
    })
    void actions.executeQuery(activeTab.id, mode, guardrailId, generatedQueryText)
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
    })
  }

  const requestSaveQuery = useCallback(
    (tabId: string) => {
      const tab = snapshot?.tabs.find((item) => item.id === tabId)

      if (!tab) {
        return
      }

      if (tab.tabKind === 'explorer') {
        return
      }

      if (tab.tabKind === 'metrics') {
        return
      }

      if (tab.saveTarget) {
        void actions.saveCurrentQuery(tabId)
        return
      }

      setPendingSaveTabId(tabId)
    },
    [actions, snapshot?.tabs],
  )

  useEffect(() => {
    if (activeTabId && activeTabIsTestSuite) {
      const modeKey = 'test-suite'

      if (initializedQueryModeByTabRef.current[activeTabId] !== modeKey) {
        initializedQueryModeByTabRef.current[activeTabId] = modeKey
        setQueryWindowMode('both')
      }
    }
  }, [activeTabId, activeTabIsTestSuite])

  useEffect(() => {
    if (!activeTabId || !activeBuilderKind) {
      return
    }

    if (initializedQueryModeByTabRef.current[activeTabId] === activeBuilderKind) {
      return
    }

    initializedQueryModeByTabRef.current[activeTabId] = activeBuilderKind
    setQueryWindowMode(defaultQueryWindowModeForBuilderKind(activeBuilderKind))
  }, [activeBuilderKind, activeTabId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()

      if (event.key === 'F5') {
        event.preventDefault()

        if (activeTab && !activeTabIsExplorer) {
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
        if (!activeTabIsExplorer && !activeTabIsMetrics) {
          requestSaveQuery(activeTab.id)
        }
        return
      }

      if (key === 'enter') {
        event.preventDefault()
        if (!activeTabIsExplorer) {
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

      if (key === 'b') {
        event.preventDefault()
        const sidebarCollapsed = !sidebarCollapsedRef.current
        sidebarCollapsedRef.current = sidebarCollapsed
        void actions.updateUiState({
          sidebarCollapsed,
        })
        return
      }

      if (key === 'e' && event.shiftKey) {
        event.preventDefault()
        if (!activeTabIsExplorer && !activeTabIsMetrics && !activeTabIsTestSuite) {
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
    activeTabIsMetrics,
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
      (activeSidebarPane !== 'explorer' && activeSidebarPane !== 'connections') ||
      sidebarCollapsed ||
      explorerStatus === 'loading' ||
      (explorer?.connectionId === activeConnectionId &&
        explorer.environmentId === activeEnvironmentId &&
        (explorer.nodes.length > 0 || explorer.scope === undefined))
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
    activeSidebarPane,
    explorer,
    explorerStatus,
    loadExplorer,
    sidebarCollapsed,
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
  const canCancelExecution = Boolean(
    runtimeCapabilities.canCancel && lastExecution?.executionId,
  )
  const showingEnvironmentWorkspace = snapshot.ui.activeActivity === 'environments'
  const showingExplorerWorkspace = activeTabIsExplorer
  const showingMetricsWorkspace = activeTabIsMetrics
  const hasWorkbenchMessages = workbenchMessages.length > 0
  const hasActivePanelContext = Boolean(activeTab && activeConnection && activeEnvironment)
  const hasActiveQueryContext = Boolean(
    hasActivePanelContext && !activeTabIsExplorer && !activeTabIsMetrics,
  )
  const isMessagePanelRequested = snapshot.ui.activeBottomPanelTab === 'messages'
  const isExplorerDetailsRequested =
    activeTabIsExplorer && snapshot.ui.activeBottomPanelTab === 'details'
  const shouldShowBottomPanel =
    snapshot.ui.bottomPanelVisible &&
    (hasWorkbenchMessages ||
      isMessagePanelRequested ||
      (hasActivePanelContext && isExplorerDetailsRequested) ||
      (!showingEnvironmentWorkspace &&
        !showingExplorerWorkspace &&
        !showingMetricsWorkspace &&
        hasActiveQueryContext))

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
      (tab.saveTarget || tab.savedQueryId) &&
      tab.dirty
    ) {
      setPendingTabClose({ tab, remainingTabIds })
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

  const deleteLibraryNode = (nodeId: string) => {
    void actions.deleteLibraryNode({ nodeId })
  }

  const moveLibraryNode = (nodeId: string, parentId?: string) => {
    void actions.moveLibraryNode({ nodeId, parentId })
  }

  const setLibraryNodeEnvironment = (nodeId: string, environmentId?: string) => {
    void actions.setLibraryNodeEnvironment({ nodeId, environmentId })
  }

  const setActivity = (activity: WorkspaceSnapshot['ui']['activeActivity']) => {
    if (activity === 'settings') {
      void actions.updateUiState({
        activeActivity: 'settings',
        sidebarCollapsed: false,
        rightDrawer: 'diagnostics',
      })
      return
    }

    void actions.updateUiState({
      activeActivity: activity,
      activeSidebarPane: activity,
      sidebarCollapsed: false,
      rightDrawer: snapshot.ui.rightDrawer === 'diagnostics' ? 'none' : snapshot.ui.rightDrawer,
    })
  }

  const openConnectionDrawer = () => {
    setConnectionDraft(undefined)
    if (snapshot?.ui.activeConnectionId) {
      void actions.updateUiState({
        activeActivity: 'connections',
        activeSidebarPane: 'connections',
        sidebarCollapsed: false,
        rightDrawer: 'connection',
      })
    }
  }

  const openConnectionDrawerFor = (connectionId: string) => {
    setConnectionDraft(undefined)
    if (connectionId === snapshot?.ui.activeConnectionId) {
      openConnectionDrawer()
      return
    }

    void (async () => {
      await actions.selectConnection(connectionId)
      await actions.updateUiState({
        activeActivity: 'connections',
        activeSidebarPane: 'connections',
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
      activeActivity: 'settings',
      rightDrawer: 'diagnostics',
      sidebarCollapsed: false,
    })
  }

  const closeDrawer = () => {
    setConnectionDraft(undefined)
    void actions.updateUiState({
      activeActivity:
        snapshot.ui.activeActivity === 'settings'
          ? snapshot.ui.activeSidebarPane
          : snapshot.ui.activeActivity,
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

      await actions.saveConnection(nextProfile, secret)

      if (connectionDraft?.id === profile.id) {
        setConnectionDraft(undefined)
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
    })

    void (async () => {
      await actions.saveEnvironment(clone)
      await actions.updateUiState({
        activeActivity: 'environments',
        activeEnvironmentId: clone.id,
        activeSidebarPane: 'environments',
        sidebarCollapsed: false,
      })
    })()
  }

  const openNewConnectionDraft = () => {
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
    void actions.updateUiState({
      activeActivity: 'connections',
      activeSidebarPane: 'connections',
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
        activeActivity: 'connections',
        activeSidebarPane: 'connections',
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
        activeActivity: 'connections',
        activeSidebarPane: 'connections',
        sidebarCollapsed: false,
        rightDrawer: 'none',
      })
    })()
  }

  const loadConnectionExplorerScope = (connectionId: string, scope?: string) => {
    if (!activeEnvironmentId) {
      return
    }

    void (async () => {
      if (connectionId !== activeConnectionId) {
        await actions.selectConnection(connectionId)
      }

      await actions.loadExplorer({
        connectionId,
        environmentId: activeEnvironmentId,
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
        activeActivity: 'tests',
        activeSidebarPane: 'tests',
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
            void actions.closeTab(tabId).then(() => continuePendingTabClose(remainingTabIds))
          }}
          onSaveAndClose={() => {
            const tabId = pendingTabClose.tab.id
            const remainingTabIds = pendingTabClose.remainingTabIds
            setPendingTabClose(undefined)
            void actions
              .saveAndCloseTab(tabId)
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
            void actions.saveQueryTabToLocalFile({ tabId })
          }}
          onSaveToLibrary={(request) => {
            const tabId = pendingSaveTab.id
            setPendingSaveTabId(undefined)
            void actions.saveQueryTabToLibrary({
              tabId,
              itemId: request.itemId,
              folderId: request.folderId,
              name: request.name,
              kind: inferLibraryItemKindForTab(pendingSaveTab),
              tags: [],
            })
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

      <div
        className={`ads-workbench${
          snapshot.ui.sidebarCollapsed ? ' is-sidebar-collapsed' : ''
        }`}
        style={
          {
            '--sidebar-width': `${snapshot.ui.sidebarWidth}px`,
            '--drawer-width': `${snapshot.ui.rightDrawerWidth}px`,
          } as CSSProperties
        }
      >
        <ActivityBar
          activeActivity={snapshot.ui.activeActivity}
          sidebarCollapsed={snapshot.ui.sidebarCollapsed}
          theme={snapshot.preferences.theme}
          onToggleSidebar={() =>
            void actions.updateUiState({
              sidebarCollapsed: !snapshot.ui.sidebarCollapsed,
            })
          }
          onSelectActivity={setActivity}
          onToggleTheme={() =>
            void actions.setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
          }
        />

        {!snapshot.ui.sidebarCollapsed ? (
          <SideBar
            ui={snapshot.ui}
            width={snapshot.ui.sidebarWidth}
            connections={snapshot.connections}
            adapterManifests={snapshot.adapterManifests}
            environments={snapshot.environments}
            libraryNodes={snapshot.libraryNodes}
            closedTabs={snapshot.closedTabs}
            explorerItems={explorerItems}
            connectionExplorerItems={activeConnectionExplorerItems}
            explorerSummary={explorer?.summary ?? explorerError}
            explorerStatus={explorerStatus}
            activeConnectionId={activeConnection?.id ?? ''}
            activeEnvironmentId={activeEnvironment?.id ?? ''}
            onSelectConnection={(connectionId) => void actions.selectConnection(connectionId)}
            onSelectEnvironment={(environmentId) =>
              void actions.updateUiState({
                activeEnvironmentId: environmentId,
                activeActivity: 'environments',
                activeSidebarPane: 'environments',
                sidebarCollapsed: false,
              })
            }
            onCreateConnection={openNewConnectionDraft}
            onCreateEnvironment={() => void actions.createEnvironment()}
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
            onLoadExplorerScope={loadConnectionExplorerScope}
            onOpenScopedQuery={openScopedQuery}
            onCreateTab={(connectionId) => openQueryTab(connectionId ?? activeConnection?.id)}
            onCreateTestSuite={(connectionId) => openTestSuite(connectionId)}
            onOpenTestSuiteTemplate={(connectionId, templateId) =>
              openTestSuite(connectionId, templateId)
            }
            onSaveCurrentQuery={() => (activeTab ? requestSaveQuery(activeTab.id) : undefined)}
            onCreateLibraryFolder={createLibraryFolder}
            onDeleteLibraryNode={deleteLibraryNode}
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
          />
        ) : null}

        <div className="workbench-center">
          <main className="editor-workspace">
            {showingEnvironmentWorkspace ? (
              <EnvironmentWorkspace
                key={`${activeEnvironment?.id ?? 'none'}-${activeEnvironment?.updatedAt ?? ''}`}
                activeEnvironment={activeEnvironment}
                environments={snapshot.environments}
                onCreateEnvironment={() => void actions.createEnvironment()}
                onCloneEnvironment={cloneEnvironmentProfile}
                onSaveEnvironment={(environment) => void actions.saveEnvironment(environment)}
              />
            ) : (
              <>
                <EditorTabs
                  tabs={snapshot.tabs}
                  activeTabId={activeTab?.id ?? ''}
                  connections={snapshot.connections}
                  environments={snapshot.environments}
                  canCreateTab={Boolean(activeConnection)}
                  onSelectTab={(tabId) => void actions.selectTab(tabId)}
                  onCloseTab={requestCloseTab}
                  onCloseTabs={requestCloseTabs}
                  onCreateTab={() => openQueryTab(activeConnection?.id)}
                  onRenameTab={(tabId, title) => void actions.renameTab(tabId, title)}
                  onSaveTab={requestSaveQuery}
                  onReorderTabs={(orderedTabIds) =>
                    void actions.reorderTabs(orderedTabIds)
                  }
                />

                {activeTabIsExplorer ? (
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
                ) : activeTabIsTestSuite && activeConnection && activeEnvironment && activeTab ? (
                  <TestSuiteWorkspace
                    tab={activeTab}
                    connection={activeConnection}
                    resolvedTheme={resolvedTheme}
                    testWindowMode={queryWindowMode}
                    executionStatus={executionStatus}
                    onModeChange={setQueryWindowMode}
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
                      queryWindowMode={queryWindowMode}
                      onToggleQueryWindowMode={setQueryWindowMode}
                      executeLabel={activeTabUsesRedisConsole ? 'Run Command' : undefined}
                      executeAriaLabel={
                        activeTabUsesRedisConsole ? 'Run Redis command' : undefined
                      }
                      executeTitle={
                        activeTabUsesRedisConsole
                          ? activeRedisConsoleVisible
                            ? 'Run the current Redis command. Shortcut: Ctrl+Enter.'
                            : 'Switch to Redis Console or Key Browser + Console to run a command. Use the browser toolbar to scan keys.'
                          : undefined
                      }
                      executeDisabled={activeTabUsesRedisConsole && !activeRedisConsoleVisible}
                      onToggleBottomPanel={() =>
                        void actions.updateUiState({
                          bottomPanelVisible: !snapshot.ui.bottomPanelVisible,
                        })
                      }
                    />

                    <div className="editor-surface">
                      <div className="editor-surface-meta">
                        <span>
                          {activeConnection.name} / {activeEnvironment.label}
                        </span>
                      </div>
                      <div
                        className={`editor-query-layout query-layout--${activeQueryWindowMode}`}
                        role="presentation"
                      >
                        {hasBuilderQuery && activeQueryWindowMode !== 'raw' ? (
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
                        {!hasBuilderQuery || activeQueryWindowMode !== 'builder' ? (
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
                                if (
                                  activeBuilderState &&
                                  activeQueryWindowMode === 'both'
                                ) {
                                  const parsedBuilderState = parseBuilderStateFromQueryText(
                                    nextQueryText,
                                    activeBuilderState,
                                    activeConnection,
                                  )

                                  if (parsedBuilderState) {
                                    persistBuilderState(activeTab.id, parsedBuilderState)
                                    return
                                  }
                                }
                                void actions.updateQuery(activeTab.id, nextQueryText)
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
              </>
            )}
          </main>

          {shouldShowBottomPanel ? (
            <BottomPanel
              activeTab={activeTab}
              activeConnection={activeConnection}
              activeEnvironment={activeEnvironment}
              activePanelTab={snapshot.ui.activeBottomPanelTab}
              height={snapshot.ui.bottomPanelHeight}
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
              onResize={(nextHeight) =>
                void actions.updateUiState({
                  bottomPanelHeight: nextHeight,
                })
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
                queryTemplate && activeTab && !activeTabIsExplorer && !activeTabIsMetrics
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
          ) : null}
        </div>

        {snapshot.ui.rightDrawer !== 'none' ? (
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
            onImportWorkspace={() =>
              void actions.importWorkspace(exportPassphrase, importPayload)
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
): 'both' | 'builder' | 'raw' {
  if (builderKind === 'sql-select') {
    return 'raw'
  }

  if (builderKind === 'redis-key-browser') {
    return 'builder'
  }

  return 'both'
}

function parseBuilderStateFromQueryText(
  queryText: string,
  currentBuilderState: QueryBuilderState,
  connection: ConnectionProfile | undefined,
) {
  if (isMongoFindBuilderState(currentBuilderState)) {
    return parseMongoFindQueryText(queryText)
  }

  if (connection && isSqlSelectBuilderState(currentBuilderState)) {
    return parseSqlSelectQueryText(queryText, connection.engine)
  }

  if (isDynamoDbKeyConditionBuilderState(currentBuilderState)) {
    return parseDynamoDbKeyConditionQueryText(queryText)
  }

  if (isCqlPartitionBuilderState(currentBuilderState)) {
    return parseCqlPartitionQueryText(queryText)
  }

  if (isSearchDslBuilderState(currentBuilderState)) {
    return parseSearchDslQueryText(queryText)
  }

  if (isRedisKeyBrowserState(currentBuilderState)) {
    return parseRedisKeyBrowserQueryText(queryText)
  }

  return undefined
}

function inferLibraryItemKindForTab(tab: QueryTabState): LibraryItemKind {
  if (tab.tabKind === 'test-suite' || tab.testSuite) {
    return 'test-suite'
  }

  if (/\.(ps1|sh|bash|bat|cmd|js|ts|py)$/i.test(tab.title)) {
    return 'script'
  }

  return 'query'
}

export default App

