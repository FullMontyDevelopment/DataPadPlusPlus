import type {
  ConnectionProfile,
  FirstInstallGuidePreferences,
  FirstInstallGuideStepId,
  LibraryNode,
  QueryTabState,
  SavedWorkItem,
  UiState,
  WorkspaceSnapshot,
  WorkspaceWindowState,
} from '@datapadplusplus/shared-types'
import {
  CONSOLIDATED_LEGACY_WORKSPACE_SCHEMA_VERSION,
  CURRENT_WORKSPACE_SCHEMA_VERSION,
  DATAPADPLUSPLUS_ADAPTER_MANIFESTS,
  datastoreBacklogByEngine,
} from '@datapadplusplus/shared-types'
import { defaultKeyboardShortcuts } from '../keyboard-shortcuts'
import { sanitizeEnvironmentProfile } from './environment-variables'
import { migrateLegacyVariableTokens } from './workspace-variable-migration'
import { stripDemoRecords } from './workspace-migration-demo'
import { normalizeDatastoreApiServerPreferences } from './workspace-migration/api-server'
import {
  normalizeDatastoreMcpServerPreferences,
  normalizeMcpEffectiveAccess,
} from './workspace-migration/mcp-server'
import {
  normalizeDatastoreSecurityCheckSnapshot,
  normalizeDatastoreSecurityChecksPreferences,
} from './workspace-migration/security'

const MIN_BOTTOM_PANEL_HEIGHT = 120
const DEFAULT_BOTTOM_PANEL_HEIGHT = 260
const MAX_BOTTOM_PANEL_HEIGHT = 900
const MIN_SIDEBAR_WIDTH = 220
const DEFAULT_SIDEBAR_WIDTH = 280
const MAX_SIDEBAR_WIDTH = 420
const MIN_RIGHT_DRAWER_WIDTH = 320
const DEFAULT_RIGHT_DRAWER_WIDTH = 360
const MAX_RIGHT_DRAWER_WIDTH = 560
const MIN_RESULTS_SIDE_WIDTH = 320
const DEFAULT_RESULTS_SIDE_WIDTH = 420
const MAX_RESULTS_SIDE_WIDTH = 2400
const MIN_MONGO_SCRIPT_GUIDE_WIDTH = 280
const DEFAULT_MONGO_SCRIPT_GUIDE_WIDTH = 360
const MAX_MONGO_SCRIPT_GUIDE_WIDTH = 520
const FIRST_INSTALL_GUIDE_STEP_IDS: FirstInstallGuideStepId[] = [
  'welcome',
  'folder',
  'connection',
  'save',
  'explorer',
  'query',
  'settings',
]
const DEFAULT_LIBRARY_ROOTS = [
  ['library-root-queries', 'Queries'],
  ['library-root-scripts', 'Scripts'],
  ['library-root-tests', 'Tests'],
  ['library-root-snippets', 'Snippets'],
  ['library-root-notes', 'Notes'],
] as const

function clampBottomPanelHeight(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_BOTTOM_PANEL_HEIGHT
  }

  return Math.min(
    MAX_BOTTOM_PANEL_HEIGHT,
    Math.max(MIN_BOTTOM_PANEL_HEIGHT, Math.round(value)),
  )
}

function clampSidebarWidth(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_SIDEBAR_WIDTH
  }

  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)),
  )
}

function clampRightDrawerWidth(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_RIGHT_DRAWER_WIDTH
  }

  return Math.min(
    MAX_RIGHT_DRAWER_WIDTH,
    Math.max(MIN_RIGHT_DRAWER_WIDTH, Math.round(value)),
  )
}

function clampResultsSideWidth(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_RESULTS_SIDE_WIDTH
  }

  return Math.min(
    MAX_RESULTS_SIDE_WIDTH,
    Math.max(MIN_RESULTS_SIDE_WIDTH, Math.round(value)),
  )
}

function clampMongoScriptGuideWidth(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_MONGO_SCRIPT_GUIDE_WIDTH
  }

  return Math.min(
    MAX_MONGO_SCRIPT_GUIDE_WIDTH,
    Math.max(MIN_MONGO_SCRIPT_GUIDE_WIDTH, Math.round(value)),
  )
}

function isResultsDock(value: unknown): value is UiState['resultsDock'] {
  return value === 'bottom' || value === 'right'
}

function isSidebarPane(value: unknown): value is UiState['activeSidebarPane'] {
  return (
    value === 'connections' ||
    value === 'environments' ||
    value === 'explorer' ||
    value === 'library' ||
    value === 'tests'
  )
}

function isActivity(value: unknown): value is UiState['activeActivity'] {
  return isSidebarPane(value) || value === 'settings'
}

function isBottomPanelTab(value: unknown): value is UiState['activeBottomPanelTab'] {
  return value === 'results' || value === 'messages' || value === 'history' || value === 'details'
}

function normalizeQueryViewMode(value: unknown) {
  if (value === 'builder' || value === 'raw' || value === 'script') {
    return value
  }

  if (value === 'both') {
    return 'builder'
  }

  return undefined
}

function isRightDrawer(value: unknown): value is UiState['rightDrawer'] {
  return (
    value === 'none' ||
    value === 'connection' ||
    value === 'inspection' ||
    value === 'diagnostics'
  )
}

function isExplorerView(value: unknown): value is UiState['explorerView'] {
  return value === 'tree' || value === 'structure'
}

function isConnectionGroupMode(value: unknown): value is UiState['connectionGroupMode'] {
  return value === 'none' || value === 'environment' || value === 'database-type'
}

function normalizeSidebarSectionStates(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'boolean',
    ),
  )
}

export function normalizeUiState(snapshot: WorkspaceSnapshot): UiState {
  const firstTab = snapshot.tabs[0]
  const firstConnection = snapshot.connections[0]
  const firstEnvironment = snapshot.environments[0]
  const legacyUi = snapshot.ui as Partial<UiState> | undefined
  const activeTab =
    snapshot.tabs.find((item) => item.id === legacyUi?.activeTabId) ?? firstTab
  const activeConnection =
    snapshot.connections.find((item) => item.id === legacyUi?.activeConnectionId) ??
    (activeTab
      ? snapshot.connections.find((item) => item.id === activeTab.connectionId)
      : undefined) ??
    firstConnection
  const activeEnvironment =
    snapshot.environments.find((item) => item.id === legacyUi?.activeEnvironmentId) ??
    (activeTab
      ? snapshot.environments.find((item) => item.id === activeTab.environmentId)
      : undefined) ??
    firstEnvironment
  const legacyActiveActivity = legacyUi?.activeActivity as string | undefined
  const legacyActiveSidebarPane = legacyUi?.activeSidebarPane as string | undefined
  const activeActivity = normalizeActivity(legacyActiveActivity)
  const activeSidebarPane = normalizeSidebarPane(
    legacyActiveSidebarPane,
    activeActivity === 'settings' ? 'library' : activeActivity,
  )
  const activeBottomPanelTab = isBottomPanelTab(legacyUi?.activeBottomPanelTab)
    ? legacyUi.activeBottomPanelTab
    : 'results'
  const rightDrawer =
    legacyUi?.rightDrawer === 'inspection' || legacyUi?.rightDrawer === 'diagnostics'
      ? 'none'
      : isRightDrawer(legacyUi?.rightDrawer)
        ? legacyUi.rightDrawer
        : 'none'

  return {
    activeConnectionId: activeConnection?.id ?? '',
    activeEnvironmentId: activeEnvironment?.id ?? '',
    activeTabId: activeTab?.id ?? '',
    explorerFilter:
      typeof legacyUi?.explorerFilter === 'string' ? legacyUi.explorerFilter : '',
    explorerView: isExplorerView(legacyUi?.explorerView) ? legacyUi.explorerView : 'structure',
    connectionGroupMode: isConnectionGroupMode(legacyUi?.connectionGroupMode)
      ? legacyUi.connectionGroupMode
      : 'none',
    sidebarSectionStates: normalizeSidebarSectionStates(legacyUi?.sidebarSectionStates),
    activeActivity,
    sidebarCollapsed: Boolean(legacyUi?.sidebarCollapsed),
    activeSidebarPane,
    sidebarWidth: clampSidebarWidth(legacyUi?.sidebarWidth),
    bottomPanelVisible:
      (Boolean(activeTab) || activeBottomPanelTab === 'messages') &&
      (typeof legacyUi?.bottomPanelVisible === 'boolean' ? legacyUi.bottomPanelVisible : false),
    activeBottomPanelTab,
    bottomPanelHeight: clampBottomPanelHeight(legacyUi?.bottomPanelHeight),
    resultsDock: isResultsDock(legacyUi?.resultsDock) ? legacyUi.resultsDock : 'bottom',
    resultsSideWidth: clampResultsSideWidth(legacyUi?.resultsSideWidth),
    mongoScriptGuideVisible:
      typeof legacyUi?.mongoScriptGuideVisible === 'boolean'
        ? legacyUi.mongoScriptGuideVisible
        : true,
    mongoScriptGuideWidth: clampMongoScriptGuideWidth(legacyUi?.mongoScriptGuideWidth),
    rightDrawer,
    rightDrawerWidth: clampRightDrawerWidth(legacyUi?.rightDrawerWidth),
    workspaceWindows: normalizeWorkspaceWindows(snapshot),
  }
}

export function tabCanDetach(tab: QueryTabState) {
  return ['query', 'explorer', 'test-suite', 'metrics', 'object-view', 'workspace-search']
    .includes(tab.tabKind ?? 'query')
}

export function normalizeWorkspaceWindows(snapshot: WorkspaceSnapshot): WorkspaceWindowState[] {
  const allTabIds = snapshot.tabs.map((tab) => tab.id)
  if (!snapshot.preferences.multiWindowTabs?.enabled) {
    return [{
      id: 'main',
      role: 'main',
      tabIds: allTabIds,
      activeTabId: allTabIds.includes(snapshot.ui?.activeTabId)
        ? snapshot.ui.activeTabId
        : (allTabIds[0] ?? ''),
    }]
  }

  const validTabs = new Map(snapshot.tabs.map((tab) => [tab.id, tab]))
  const seenWindows = new Set<string>()
  const seenTabs = new Set<string>()
  const windows: WorkspaceWindowState[] = []
  for (const candidate of snapshot.ui?.workspaceWindows ?? []) {
    const isMain = candidate.id === 'main'
    if (!candidate.id?.trim() || seenWindows.has(candidate.id) || (!isMain && candidate.role !== 'editor')) {
      continue
    }
    seenWindows.add(candidate.id)
    const tabIds = (candidate.tabIds ?? []).filter((tabId) => {
      const tab = validTabs.get(tabId)
      if (!tab || seenTabs.has(tabId) || (!isMain && !tabCanDetach(tab))) return false
      seenTabs.add(tabId)
      return true
    })
    if (!isMain && tabIds.length === 0) continue
    windows.push({
      id: candidate.id,
      role: isMain ? 'main' : 'editor',
      tabIds,
      activeTabId: tabIds.includes(candidate.activeTabId)
        ? candidate.activeTabId
        : (tabIds[0] ?? ''),
      bounds: normalizeWindowBounds(candidate.bounds),
      monitorName: candidate.monitorName,
      maximized: Boolean(candidate.maximized),
      lastFocusedAt: candidate.lastFocusedAt,
    })
  }
  let main = windows.find((window) => window.id === 'main')
  if (!main) {
    main = { id: 'main', role: 'main', tabIds: [], activeTabId: '' }
    windows.unshift(main)
  }
  main.tabIds.push(...allTabIds.filter((tabId) => !seenTabs.has(tabId)))
  main.activeTabId = main.tabIds.includes(snapshot.ui?.activeTabId)
    ? snapshot.ui.activeTabId
    : main.tabIds.includes(main.activeTabId)
      ? main.activeTabId
      : (main.tabIds[0] ?? '')
  return windows
}

function normalizeWindowBounds(bounds: WorkspaceWindowState['bounds']) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    return undefined
  }
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.min(7680, Math.max(720, Math.round(bounds.width))),
    height: Math.min(4320, Math.max(480, Math.round(bounds.height))),
  }
}

export function migrateWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  assertSupportedWorkspaceSchemaVersion(snapshot.schemaVersion)
  const next = JSON.parse(JSON.stringify(snapshot)) as WorkspaceSnapshot
  next.lockState ??= { isLocked: false }
  next.lockState.isLocked = false
  next.lockState.lockedAt = undefined
  next.closedTabs ??= []
  next.savedWork ??= []
  next.libraryNodes ??= []
  next.adapterManifests = DATAPADPLUSPLUS_ADAPTER_MANIFESTS
  stripDemoRecords(next)
  next.environments = next.environments.map(sanitizeEnvironmentProfile)
  migrateLegacyVariableTokens(next)
  migrateGeneratedSqlServerScopes(next)
  migrateConnectionModes(next.connections)
  next.preferences = normalizePreferences(next.preferences)
  normalizeMcpEffectiveAccess(
    next.preferences.datastoreMcpServer,
    next.connections,
    next.libraryNodes,
  )
  next.datastoreSecurityChecks = normalizeDatastoreSecurityCheckSnapshot(
    next.datastoreSecurityChecks,
  )
  next.libraryNodes = migrateLibraryNodes(next.libraryNodes, next.savedWork)
  ensureConnectionLibraryNodes(next.libraryNodes, next.connections)
  pruneEmptyDefaultLibraryRoots(next.libraryNodes)
  migrateTabKinds(next.tabs)
  migrateTabKinds(next.closedTabs)
  migrateTabSaveTargets(next.tabs)
  migrateTabSaveTargets(next.closedTabs)
  migrateV11SnapshotToV12(next)
  next.workspaceRevision ??= 0
  next.ui = normalizeUiState(next)

  for (const tab of next.tabs) {
    tab.result = undefined
  }

  for (const tab of next.closedTabs) {
    tab.result = undefined
  }

  return next
}

function migrateV11SnapshotToV12(snapshot: WorkspaceSnapshot) {
  if ((snapshot.schemaVersion ?? 0) <= CONSOLIDATED_LEGACY_WORKSPACE_SCHEMA_VERSION) {
    snapshot.schemaVersion = CURRENT_WORKSPACE_SCHEMA_VERSION
  }
}

function assertSupportedWorkspaceSchemaVersion(version: unknown) {
  if (version === undefined || version === null) return
  if (!Number.isInteger(version) || Number(version) < 0) {
    throw new Error('Workspace schema version is invalid.')
  }
  if (Number(version) > CURRENT_WORKSPACE_SCHEMA_VERSION) {
    throw new Error(
      `This workspace was created by a newer DataPad++ version (schema ${version}).`,
    )
  }
}

const GENERATED_SQLSERVER_TEMPLATE_PREFIXES = [
  'select db_name() as database_name;',
  'select top 100 * from [',
  'select top 50 * from sys.query_store_runtime_stats',
  'select session_id, status, command, wait_type, blocking_session_id from sys.dm_exec_requests',
  'select request_session_id, resource_type, request_mode, request_status from sys.dm_tran_locks',
  'select top 50 * from sys.dm_db_missing_index_details',
  'select name, type_desc from sys.database_principals',
  'select sm.definition from sys.sql_modules',
  'select s.name as schema_name,',
  'select role.name, count(member.member_principal_id)',
  'select name, subject, issuer_name, expiry_date',
  'select name, algorithm_desc, key_length',
  'select name, credential_identity, target_type',
  'select name, is_state_enabled, create_date',
  'select name, type_desc, physical_name',
  'select fg.name, fg.type_desc',
  'select ps.name, pf.name as function_name',
  'select name, type_desc, fanout',
  'select name, event_retention_mode_desc',
  'select top 100 name, enabled from msdb.dbo.sysjobs',
] as const

function migrateGeneratedSqlServerScopes(snapshot: WorkspaceSnapshot) {
  const sqlServerConnections = new Set(
    snapshot.connections
      .filter((connection) => connection.engine === 'sqlserver')
      .map((connection) => connection.id),
  )
  const migrateTab = (tab: QueryTabState) => {
    if (!sqlServerConnections.has(tab.connectionId)) return
    const migrated = generatedSqlServerScope(tab.queryText)
    if (migrated) {
      tab.queryText = migrated.queryText
      tab.sqlScope ??= { database: migrated.database }
    }
    for (const entry of tab.history) {
      const history = generatedSqlServerScope(entry.queryText)
      if (!history) continue
      entry.queryText = history.queryText
      entry.sqlScope ??= { database: history.database }
    }
  }
  snapshot.tabs.forEach(migrateTab)
  snapshot.closedTabs.forEach(migrateTab)
  for (const node of snapshot.libraryNodes) {
    if (!node.queryText || !node.connectionId || !sqlServerConnections.has(node.connectionId)) continue
    const migrated = generatedSqlServerScope(node.queryText)
    if (!migrated) continue
    node.queryText = migrated.queryText
    node.sqlScope ??= { database: migrated.database }
  }
}

function generatedSqlServerScope(queryText: string) {
  const match = /^\s*use\s+\[((?:[^\]]|\]\])+)\]\s*;\s*/i.exec(queryText)
  if (!match) return undefined
  const remaining = queryText.slice(match[0].length).trimStart()
  const normalized = remaining.toLowerCase()
  if (!GENERATED_SQLSERVER_TEMPLATE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return undefined
  }
  return {
    database: (match[1] ?? '').replace(/\]\]/g, ']'),
    queryText: remaining,
  }
}

function normalizePreferences(
  preferences: WorkspaceSnapshot['preferences'] | undefined,
): WorkspaceSnapshot['preferences'] {
  return {
    theme: preferences?.theme ?? 'dark',
    telemetry: preferences?.telemetry ?? 'opt-in',
    lockAfterMinutes: preferences?.lockAfterMinutes ?? 15,
    safeModeEnabled: preferences?.safeModeEnabled ?? false,
    keyboardShortcuts: {
      ...defaultKeyboardShortcuts(),
      ...(preferences?.keyboardShortcuts ?? {}),
    },
    workspaceBackups: {
      enabled: Boolean(preferences?.workspaceBackups?.enabled),
      intervalMinutes: clampNumber(preferences?.workspaceBackups?.intervalMinutes, 30, 5, 1440),
      maxBackups: clampNumber(preferences?.workspaceBackups?.maxBackups, 20, 1, 20),
      includeSecrets: Boolean(preferences?.workspaceBackups?.includeSecrets),
      passphraseSecretRef: preferences?.workspaceBackups?.passphraseSecretRef,
      lastBackupAt: preferences?.workspaceBackups?.lastBackupAt,
      lastWorkspaceUpdatedAt: preferences?.workspaceBackups?.lastWorkspaceUpdatedAt,
    },
    datastoreApiServer: {
      enabled: Boolean(preferences?.datastoreApiServer?.enabled),
      host: '127.0.0.1',
      ...normalizeDatastoreApiServerPreferences(preferences?.datastoreApiServer),
    },
    datastoreMcpServer: {
      enabled: Boolean(preferences?.datastoreMcpServer?.enabled),
      host: '127.0.0.1',
      ...normalizeDatastoreMcpServerPreferences(preferences?.datastoreMcpServer),
    },
    datastoreSecurityChecks: normalizeDatastoreSecurityChecksPreferences(
      preferences?.datastoreSecurityChecks,
    ),
    workspaceSearch: {
      enabled: Boolean(preferences?.workspaceSearch?.enabled),
    },
    datastoreTests: {
      enabled: Boolean(preferences?.datastoreTests?.enabled),
    },
    multiWindowTabs: {
      enabled: Boolean(preferences?.multiWindowTabs?.enabled),
    },
    firstInstallGuide: normalizeFirstInstallGuidePreferences(preferences?.firstInstallGuide),
    explorerFolderOrders: normalizeExplorerFolderOrders(preferences?.explorerFolderOrders),
  }
}

function normalizeExplorerFolderOrders(
  orders: WorkspaceSnapshot['preferences']['explorerFolderOrders'] | undefined,
) {
  const normalized: Record<string, string[]> = {}

  for (const [key, value] of Object.entries(orders ?? {})) {
    const orderKey = key.trim()
    const orderedNodeKeys = Array.isArray(value)
      ? value.map((item) => item.trim()).filter(Boolean)
      : []

    if (orderKey && orderedNodeKeys.length > 0) {
      normalized[orderKey] = [...new Set(orderedNodeKeys)]
    }
  }

  return normalized
}

function normalizeFirstInstallGuidePreferences(
  preferences: FirstInstallGuidePreferences | undefined,
): FirstInstallGuidePreferences {
  const status = preferences?.status
  const normalizedStatus =
    status === 'started' || status === 'skipped' || status === 'completed'
      ? status
      : 'unseen'

  const currentStepId =
    normalizedStatus === 'started' && isFirstInstallGuideStepId(preferences?.currentStepId)
      ? preferences.currentStepId
      : undefined

  return {
    status: normalizedStatus,
    ...(currentStepId ? { currentStepId } : {}),
    updatedAt: typeof preferences?.updatedAt === 'string' ? preferences.updatedAt : undefined,
    completedAt:
      normalizedStatus === 'completed' && typeof preferences?.completedAt === 'string'
        ? preferences.completedAt
        : undefined,
  }
}

function isFirstInstallGuideStepId(value: unknown): value is FirstInstallGuideStepId {
  return typeof value === 'string' && FIRST_INSTALL_GUIDE_STEP_IDS.includes(value as FirstInstallGuideStepId)
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback
}

function normalizeActivity(value: string | undefined): UiState['activeActivity'] {
  if (value === 'settings') {
    return 'settings'
  }

  if (value === 'explorer') {
    return 'explorer'
  }

  if (value === 'library' || value === 'saved-work' || value === 'search') {
    return 'library'
  }

  if (value === 'connections' || value === 'tests' || value === 'environments') {
    return 'library'
  }

  return isActivity(value) ? value : 'library'
}

function normalizeSidebarPane(
  value: string | undefined,
  fallback: UiState['activeSidebarPane'],
): UiState['activeSidebarPane'] {
  if (value === 'explorer') {
    return 'explorer'
  }

  if (
    value === 'library' ||
    value === 'saved-work' ||
    value === 'search' ||
    value === 'connections' ||
    value === 'tests' ||
    value === 'environments'
  ) {
    return 'library'
  }

  return isSidebarPane(value) ? value : fallback
}

function migrateTabKinds(tabs: QueryTabState[]) {
  tabs.forEach((tab) => {
    if (!tab.tabKind) {
      tab.tabKind = 'query'
    }

    const queryViewMode = normalizeQueryViewMode(tab.queryViewMode)
    if (queryViewMode) {
      tab.queryViewMode = queryViewMode
    }

    tab.documentEfficiencyMode = Boolean(tab.documentEfficiencyMode)
  })
}

function migrateConnectionModes(connections: ConnectionProfile[]) {
  connections.forEach((connection) => {
    const supportedModes =
      datastoreBacklogByEngine(connection.engine)?.connectionModes ?? ['native']
    const persistedMode = connection.connectionMode as string | undefined
    const legacyMode = persistedMode === 'file'
      ? 'local-file'
      : connection.connectionMode
    const hasConnectionString = Boolean(
      connection.connectionString?.trim() || connection.auth.connectionStringSecretRef,
    )

    if (
      legacyMode &&
      supportedModes.includes(legacyMode)
    ) {
      connection.connectionMode = legacyMode
      return
    }

    if (
      hasConnectionString &&
      supportedModes.includes('connection-string')
    ) {
      connection.connectionMode = 'connection-string'
      return
    }

    connection.connectionMode = supportedModes[0] ?? 'native'
  })
}

function migrateTabSaveTargets(tabs: QueryTabState[]) {
  tabs.forEach((tab) => {
    if (!tab.saveTarget && tab.savedQueryId) {
      tab.saveTarget = {
        kind: 'library',
        libraryItemId: tab.savedQueryId,
      }
    }
  })
}

function migrateLibraryNodes(
  libraryNodes: LibraryNode[],
  savedWork: SavedWorkItem[],
): LibraryNode[] {
  const timestamp = new Date().toISOString()
  const nodes = [...libraryNodes]

  savedWork.forEach((item) => {
    if (nodes.some((node) => node.id === item.id)) {
      return
    }

    const parentId = ensureLegacyFolder(nodes, item.folder, timestamp)
    nodes.push({
      id: item.id,
      kind: item.kind,
      parentId,
      name: item.name,
      summary: item.summary,
      tags: item.tags ?? [],
      favorite: item.favorite,
      createdAt: item.updatedAt || timestamp,
      updatedAt: item.updatedAt || timestamp,
      connectionId: item.connectionId,
      environmentId: item.environmentId,
      language: item.language,
      queryText: item.queryText,
      queryViewMode: item.kind === 'script' ? 'script' : undefined,
      snapshotResultId: item.snapshotResultId,
    })
  })

  nodes.forEach((node) => {
    const queryViewMode = normalizeQueryViewMode(node.queryViewMode)
    if (queryViewMode) {
      node.queryViewMode = queryViewMode
    }

    if (node.documentEfficiencyMode !== undefined) {
      node.documentEfficiencyMode = Boolean(node.documentEfficiencyMode)
    }
  })

  return nodes
}

function ensureConnectionLibraryNodes(
  nodes: LibraryNode[],
  connections: ConnectionProfile[],
) {
  const timestamp = new Date().toISOString()

  connections.forEach((connection) => {
    const existing = nodes.find(
      (node) => node.kind === 'connection' && node.connectionId === connection.id,
    )

    if (existing) {
      existing.name = connection.name
      existing.summary = `${connection.engine} / connection`
      existing.updatedAt ||= timestamp
      return
    }

    nodes.push({
      id: `library-connection-${connection.id}`,
      kind: 'connection',
      name: connection.name,
      summary: `${connection.engine} / connection`,
      tags: connection.tags ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
      connectionId: connection.id,
    })
  })
}

function pruneEmptyDefaultLibraryRoots(nodes: LibraryNode[]) {
  const defaultRootIds = new Set<string>(DEFAULT_LIBRARY_ROOTS.map(([id]) => id))
  const nodesWithChildren = new Set(
    nodes.map((node) => node.parentId).filter(Boolean) as string[],
  )

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (
      node &&
      isUnmodifiedDefaultLibraryRoot(node) &&
      defaultRootIds.has(node.id) &&
      !nodesWithChildren.has(node.id)
    ) {
      nodes.splice(index, 1)
    }
  }
}

function isUnmodifiedDefaultLibraryRoot(node: LibraryNode) {
  return (
    node.kind === 'folder' &&
    !node.parentId &&
    !node.connectionId &&
    !node.environmentId &&
    !node.queryText &&
    !node.scriptText &&
    !node.testSuite &&
    (node.tags?.length ?? 0) === 0 &&
    !node.favorite &&
    DEFAULT_LIBRARY_ROOTS.some(([id, name]) => node.id === id && node.name === name)
  )
}

function ensureLegacyFolder(
  nodes: LibraryNode[],
  folder: string | undefined,
  timestamp: string,
) {
  const normalized =
    !folder?.trim() || folder.trim().toLowerCase() === 'saved queries'
      ? 'Queries'
      : folder.trim()
  const segments = normalized
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const path = segments.length > 0 ? segments : ['Queries']
  let parentId: string | undefined
  const accumulated: string[] = []

  for (const segment of path) {
    accumulated.push(segment)
    const existing = nodes.find(
      (node) =>
        node.kind === 'folder' && node.parentId === parentId && node.name === segment,
    )
    if (existing) {
      parentId = existing.id
      continue
    }

    const id = `library-folder-${slugifyLibraryPath(accumulated)}`
    nodes.push({
      id,
      kind: 'folder',
      parentId,
      name: segment,
      tags: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      summary: 'Migrated Library folder.',
    })
    parentId = id
  }

  return parentId ?? 'library-root-queries'
}

function slugifyLibraryPath(path: string[]) {
  return path
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
