import type {
  ConnectionProfile,
  LibraryNode,
  QueryTabState,
  SavedWorkItem,
  UiState,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import {
  DATAPADPLUSPLUS_ADAPTER_MANIFESTS,
  datastoreBacklogByEngine,
} from '@datapadplusplus/shared-types'
import { defaultKeyboardShortcuts } from '../keyboard-shortcuts'
import { sanitizeEnvironmentProfile } from './environment-variables'
import { migrateLegacyVariableTokens } from './workspace-variable-migration'

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
const WORKSPACE_SCHEMA_VERSION = 9
const DEFAULT_LIBRARY_ROOTS = [
  ['library-root-queries', 'Queries'],
  ['library-root-scripts', 'Scripts'],
  ['library-root-tests', 'Tests'],
  ['library-root-snippets', 'Snippets'],
  ['library-root-notes', 'Notes'],
] as const

const DEMO_CONNECTION_IDS = new Set([
  'conn-analytics',
  'conn-orders',
  'conn-catalog',
  'conn-commerce',
  'conn-local-sqlite',
  'conn-cache',
])
const DEMO_ENVIRONMENT_IDS = new Set(['env-dev', 'env-uat', 'env-prod'])
const DEMO_TAB_IDS = new Set([
  'tab-sql-ops',
  'tab-orders-audit',
  'tab-mongo-catalog',
  'tab-commerce-mysql',
  'tab-local-sqlite',
  'tab-redis-session',
])
const DEMO_SAVED_WORK_IDS = new Set(['saved-locks', 'saved-hotkeys', 'saved-catalog'])

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
    rightDrawer,
    rightDrawerWidth: clampRightDrawerWidth(legacyUi?.rightDrawerWidth),
  }
}

export function migrateWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
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
  migrateConnectionModes(next.connections)
  next.preferences = normalizePreferences(next.preferences)
  next.libraryNodes = migrateLibraryNodes(next.libraryNodes, next.savedWork)
  ensureConnectionLibraryNodes(next.libraryNodes, next.connections)
  pruneEmptyDefaultLibraryRoots(next.libraryNodes)
  migrateTabKinds(next.tabs)
  migrateTabKinds(next.closedTabs)
  migrateTabSaveTargets(next.tabs)
  migrateTabSaveTargets(next.closedTabs)
  next.schemaVersion = WORKSPACE_SCHEMA_VERSION
  next.ui = normalizeUiState(next)

  for (const tab of next.tabs) {
    tab.result = undefined
  }

  for (const tab of next.closedTabs) {
    tab.result = undefined
  }

  return next
}

function normalizePreferences(
  preferences: WorkspaceSnapshot['preferences'] | undefined,
): WorkspaceSnapshot['preferences'] {
  return {
    theme: preferences?.theme ?? 'dark',
    telemetry: preferences?.telemetry ?? 'opt-in',
    lockAfterMinutes: preferences?.lockAfterMinutes ?? 15,
    safeModeEnabled: preferences?.safeModeEnabled ?? true,
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
  }
}

function normalizeDatastoreApiServerPreferences(
  preferences: WorkspaceSnapshot['preferences']['datastoreApiServer'] | undefined,
) {
  const rawServers = Array.isArray(preferences?.servers) ? preferences.servers : []
  const servers = (rawServers.length > 0
    ? rawServers
    : [{
        id: preferences?.activeServerId || 'api-server-default',
        name: 'Local API Server',
        host: '127.0.0.1' as const,
        port: preferences?.port,
        autoStart: preferences?.autoStart,
        connectionId: preferences?.connectionId,
        environmentId: preferences?.environmentId,
      }]
  ).map((server, index) => {
    const port = clampNumber(server.port, 17640, 1024, 65535)
    return {
      id: typeof server.id === 'string' && server.id ? server.id : `api-server-${index + 1}`,
      name:
        typeof server.name === 'string' && server.name.trim()
          ? server.name.trim()
          : defaultApiServerName(port),
      host: '127.0.0.1' as const,
      port,
      autoStart: Boolean(server.autoStart),
      connectionId: typeof server.connectionId === 'string' ? server.connectionId : undefined,
      environmentId:
        typeof server.environmentId === 'string' ? server.environmentId : undefined,
    }
  })
  const activeServerId =
    typeof preferences?.activeServerId === 'string' &&
    servers.some((server) => server.id === preferences.activeServerId)
      ? preferences.activeServerId
      : servers[0]?.id
  const active = servers.find((server) => server.id === activeServerId) ?? servers[0]

  return {
    port: active?.port ?? 17640,
    autoStart: Boolean(active?.autoStart),
    connectionId: active?.connectionId,
    environmentId: active?.environmentId,
    activeServerId,
    servers,
  }
}

function defaultApiServerName(port: number) {
  return port === 17640 ? 'Local API Server' : `Local API Server ${port}`
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

    if (
      legacyMode &&
      supportedModes.includes(legacyMode) &&
      (legacyMode !== 'connection-string' || connection.connectionString?.trim())
    ) {
      connection.connectionMode = legacyMode
      return
    }

    if (
      connection.connectionString?.trim() &&
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

function stripDemoRecords(snapshot: WorkspaceSnapshot) {
  snapshot.connections = snapshot.connections.filter(
    (connection) => !DEMO_CONNECTION_IDS.has(connection.id),
  )
  snapshot.tabs = snapshot.tabs.filter((tab) => !DEMO_TAB_IDS.has(tab.id))
  snapshot.closedTabs = (snapshot.closedTabs ?? []).filter(
    (tab) => !DEMO_TAB_IDS.has(tab.id),
  )
  snapshot.savedWork = snapshot.savedWork.filter(
    (item) => !DEMO_SAVED_WORK_IDS.has(item.id),
  )
  snapshot.libraryNodes = snapshot.libraryNodes.filter(
    (item) => !DEMO_SAVED_WORK_IDS.has(item.id),
  )
  snapshot.explorerNodes = snapshot.explorerNodes.filter(
    (node) => !node.id.startsWith('explorer-'),
  )
  snapshot.guardrails = []

  const referencedEnvironmentIds = new Set<string>()
  snapshot.connections.forEach((connection) => {
    connection.environmentIds.forEach((environmentId) =>
      referencedEnvironmentIds.add(environmentId),
    )
  })
  snapshot.tabs.forEach((tab) => referencedEnvironmentIds.add(tab.environmentId))
  snapshot.closedTabs.forEach((tab) => referencedEnvironmentIds.add(tab.environmentId))
  snapshot.savedWork.forEach((item) => {
    if (item.environmentId) {
      referencedEnvironmentIds.add(item.environmentId)
    }
  })
  snapshot.libraryNodes.forEach((item) => {
    if (item.environmentId) {
      referencedEnvironmentIds.add(item.environmentId)
    }
  })
  snapshot.environments = snapshot.environments.filter(
    (environment) =>
      !DEMO_ENVIRONMENT_IDS.has(environment.id) ||
      referencedEnvironmentIds.has(environment.id),
  )
}
