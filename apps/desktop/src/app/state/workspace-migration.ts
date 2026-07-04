import type {
  ConnectionProfile,
  DatastoreApiServerConfig,
  DatastoreApiServerCustomEndpointConfig,
  DatastoreApiServerCustomEndpointParameterConfig,
  DatastoreApiServerProtocol,
  DatastoreApiServerResourceConfig,
  DatastoreMcpServerConfig,
  DatastoreMcpServerScope,
  DatastoreMcpServerTokenConfig,
  DatastoreSecurityCheckSnapshot,
  DatastoreSecurityChecksPreferences,
  DatastoreSecurityFinding,
  DatastoreSecurityPostureCheckResult,
  DatastoreSecuritySeverity,
  DatastoreSecurityTarget,
  FirstInstallGuidePreferences,
  FirstInstallGuideStepId,
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
const WORKSPACE_SCHEMA_VERSION = 10
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
    firstInstallGuide: normalizeFirstInstallGuidePreferences(preferences?.firstInstallGuide),
    explorerFolderOrders: normalizeExplorerFolderOrders(preferences?.explorerFolderOrders),
  }
}

function normalizeDatastoreSecurityChecksPreferences(
  preferences: DatastoreSecurityChecksPreferences | undefined,
): DatastoreSecurityChecksPreferences {
  return {
    enabled: Boolean(preferences?.enabled),
    refreshIntervalDays: clampNumber(preferences?.refreshIntervalDays, 7, 1, 30),
    mutedFindingIds: normalizeStringList(preferences?.mutedFindingIds),
    lastRefreshAttemptAt:
      typeof preferences?.lastRefreshAttemptAt === 'string'
        ? preferences.lastRefreshAttemptAt
        : undefined,
    lastSuccessfulRefreshAt:
      typeof preferences?.lastSuccessfulRefreshAt === 'string'
        ? preferences.lastSuccessfulRefreshAt
        : undefined,
    nextManualRefreshAllowedAt:
      typeof preferences?.nextManualRefreshAllowedAt === 'string'
        ? preferences.nextManualRefreshAllowedAt
        : undefined,
  }
}

function normalizeDatastoreSecurityCheckSnapshot(
  snapshot: WorkspaceSnapshot['datastoreSecurityChecks'] | undefined,
): DatastoreSecurityCheckSnapshot | undefined {
  if (!snapshot || typeof snapshot !== 'object') {
    return undefined
  }

  const status = ['idle', 'refreshing', 'ready', 'stale', 'error', 'unsupported'].includes(
    snapshot.status,
  )
    ? snapshot.status
    : 'idle'

  return {
    status,
    checkedAt: typeof snapshot.checkedAt === 'string' ? snapshot.checkedAt : undefined,
    expiresAt: typeof snapshot.expiresAt === 'string' ? snapshot.expiresAt : undefined,
    sourceMetadata: Array.isArray(snapshot.sourceMetadata)
      ? snapshot.sourceMetadata
          .filter((item) => item && typeof item === 'object')
          .map((item) => {
            const source: 'nvd' | 'cisa-kev' | 'version-catalog' =
              item.source === 'cisa-kev'
                ? 'cisa-kev'
                : item.source === 'version-catalog'
                  ? 'version-catalog'
                  : 'nvd'
            return {
              source,
              fetchedAt: typeof item.fetchedAt === 'string' ? item.fetchedAt : undefined,
              url: typeof item.url === 'string' ? item.url : '',
              recordCount: typeof item.recordCount === 'number' ? item.recordCount : undefined,
            }
          })
          .filter((item) => item.url)
      : [],
    targets: Array.isArray(snapshot.targets)
      ? snapshot.targets.map(normalizeDatastoreSecurityTarget)
      : [],
    findings: Array.isArray(snapshot.findings)
      ? snapshot.findings.map(normalizeDatastoreSecurityFinding)
      : [],
    postureChecks: Array.isArray(snapshot.postureChecks)
      ? snapshot.postureChecks.map(normalizeDatastoreSecurityPostureCheck)
      : [],
    warnings: normalizeStringList(snapshot.warnings),
    errors: normalizeStringList(snapshot.errors),
  }
}

function normalizeDatastoreSecurityTarget(
  target: Partial<DatastoreSecurityTarget>,
  index: number,
): DatastoreSecurityTarget {
  const status = [
    'pending',
    'checked',
    'notApplicable',
    'versionUnavailable',
    'mappingUnavailable',
    'error',
  ].includes(target.status ?? '')
    ? target.status
    : 'pending'
  const normalizedStatus = status as DatastoreSecurityTarget['status']

  return {
    id: typeof target.id === 'string' && target.id ? target.id : `security-target-${index + 1}`,
    connectionId: typeof target.connectionId === 'string' ? target.connectionId : '',
    environmentId: typeof target.environmentId === 'string' ? target.environmentId : '',
    connectionName: typeof target.connectionName === 'string' ? target.connectionName : 'Datastore',
    environmentName:
      typeof target.environmentName === 'string' ? target.environmentName : 'Environment',
    engine: typeof target.engine === 'string' ? target.engine : 'unknown',
    family: typeof target.family === 'string' ? target.family : 'unknown',
    status: normalizedStatus,
    detectedProduct:
      typeof target.detectedProduct === 'string' ? target.detectedProduct : undefined,
    detectedVersion:
      typeof target.detectedVersion === 'string' ? target.detectedVersion : undefined,
    knownLatestVersion:
      typeof target.knownLatestVersion === 'string' ? target.knownLatestVersion : undefined,
    recommendedVersion:
      typeof target.recommendedVersion === 'string' ? target.recommendedVersion : undefined,
    versionStatus: normalizeDatastoreVersionStatus(target.versionStatus),
    versionSource: normalizeDatastoreVersionSource(target.versionSource),
    versionSourceLabel:
      typeof target.versionSourceLabel === 'string' ? target.versionSourceLabel : undefined,
    versionSourceUrl:
      typeof target.versionSourceUrl === 'string' ? target.versionSourceUrl : undefined,
    versionSourceUpdatedAt:
      typeof target.versionSourceUpdatedAt === 'string' ? target.versionSourceUpdatedAt : undefined,
    cpeCandidates: Array.isArray(target.cpeCandidates)
      ? target.cpeCandidates
          .filter((candidate) => candidate && typeof candidate.cpeName === 'string')
          .map((candidate) => ({
            cpeName: candidate.cpeName,
            source: candidate.source === 'nvd' ? 'nvd' : 'curated',
            confidence:
              candidate.confidence === 'product' ||
              candidate.confidence === 'version-normalized'
                ? candidate.confidence
                : 'exact',
          }))
      : [],
    findingCount:
      typeof target.findingCount === 'number' && Number.isFinite(target.findingCount)
        ? Math.max(0, Math.floor(target.findingCount))
        : 0,
    highestSeverity: normalizeDatastoreSecuritySeverity(target.highestSeverity),
    lastCheckedAt: typeof target.lastCheckedAt === 'string' ? target.lastCheckedAt : undefined,
    message: typeof target.message === 'string' ? target.message : undefined,
    warnings: normalizeStringList(target.warnings),
  }
}

function normalizeDatastoreSecurityFinding(
  finding: Partial<DatastoreSecurityFinding>,
  index: number,
): DatastoreSecurityFinding {
  const cveId =
    typeof finding.cveId === 'string' && finding.cveId.trim()
      ? finding.cveId.trim()
      : `CVE-UNKNOWN-${index + 1}`
  return {
    id: typeof finding.id === 'string' && finding.id ? finding.id : cveId,
    targetIds: normalizeStringList(finding.targetIds),
    cveId,
    title: typeof finding.title === 'string' && finding.title ? finding.title : cveId,
    summary: typeof finding.summary === 'string' ? finding.summary : '',
    severity: normalizeDatastoreSecuritySeverity(finding.severity) ?? 'UNKNOWN',
    cvssScore:
      typeof finding.cvssScore === 'number' && Number.isFinite(finding.cvssScore)
        ? finding.cvssScore
        : undefined,
    cvssVector: typeof finding.cvssVector === 'string' ? finding.cvssVector : undefined,
    publishedAt: typeof finding.publishedAt === 'string' ? finding.publishedAt : undefined,
    modifiedAt: typeof finding.modifiedAt === 'string' ? finding.modifiedAt : undefined,
    affectedProduct:
      typeof finding.affectedProduct === 'string' ? finding.affectedProduct : 'Datastore',
    affectedVersion:
      typeof finding.affectedVersion === 'string' ? finding.affectedVersion : undefined,
    affectedVersionRange:
      typeof finding.affectedVersionRange === 'string'
        ? finding.affectedVersionRange
        : undefined,
    fixedVersionHint:
      typeof finding.fixedVersionHint === 'string' ? finding.fixedVersionHint : undefined,
    remediation:
      typeof finding.remediation === 'string' && finding.remediation.trim()
        ? finding.remediation
        : 'Review vendor guidance and apply a supported patched version.',
    references: Array.isArray(finding.references)
      ? finding.references
          .filter((reference) => reference && typeof reference.url === 'string')
          .map((reference) => ({
            label:
              typeof reference.label === 'string' && reference.label
                ? reference.label
                : reference.url,
            url: reference.url,
            source: typeof reference.source === 'string' ? reference.source : undefined,
          }))
      : [],
    cwes: normalizeStringList(finding.cwes),
    knownExploited: Boolean(finding.knownExploited),
    kev: finding.kev,
    sourceUrls: normalizeStringList(finding.sourceUrls),
  }
}

function normalizeDatastoreSecurityPostureCheck(
  check: Partial<DatastoreSecurityPostureCheckResult>,
  index: number,
): DatastoreSecurityPostureCheckResult {
  const ruleId =
    typeof check.ruleId === 'string' && check.ruleId.trim()
      ? check.ruleId.trim()
      : `posture.unknown.${index + 1}`
  return {
    id:
      typeof check.id === 'string' && check.id
        ? check.id
        : `posture-${ruleId.replace(/[^a-z0-9]+/gi, '-')}`,
    targetIds: normalizeStringList(check.targetIds),
    ruleId,
    category: normalizeDatastoreSecurityPostureCategory(check.category),
    status: normalizeDatastoreSecurityPostureStatus(check.status),
    severity: normalizeDatastoreSecuritySeverity(check.severity) ?? 'UNKNOWN',
    title: typeof check.title === 'string' && check.title ? check.title : ruleId,
    summary: typeof check.summary === 'string' ? check.summary : '',
    evidence: typeof check.evidence === 'string' ? check.evidence : undefined,
    remediation:
      typeof check.remediation === 'string' && check.remediation.trim()
        ? check.remediation
        : 'Review the datastore posture and apply least-privilege, authenticated, encrypted defaults where practical.',
    source: check.source === 'read-only-probe' ? 'read-only-probe' : 'profile',
    references: Array.isArray(check.references)
      ? check.references
          .filter((reference) => reference && typeof reference.url === 'string')
          .map((reference) => ({
            label:
              typeof reference.label === 'string' && reference.label
                ? reference.label
                : reference.url,
            url: reference.url,
            source: typeof reference.source === 'string' ? reference.source : undefined,
          }))
      : [],
  }
}

function normalizeDatastoreSecuritySeverity(
  severity: unknown,
): DatastoreSecuritySeverity | undefined {
  return severity === 'CRITICAL' ||
    severity === 'HIGH' ||
    severity === 'MEDIUM' ||
    severity === 'LOW' ||
    severity === 'NONE' ||
    severity === 'UNKNOWN'
    ? severity
    : undefined
}

function normalizeDatastoreVersionStatus(status: unknown) {
  return status === 'current' ||
    status === 'updateAvailable' ||
    status === 'unsupported' ||
    status === 'unknown'
    ? status
    : undefined
}

function normalizeDatastoreVersionSource(source: unknown) {
  return source === 'bundled-catalog' ||
    source === 'nvd-range' ||
    source === 'datastore-local'
    ? source
    : undefined
}

function normalizeDatastoreSecurityPostureStatus(status: unknown) {
  return status === 'pass' ||
    status === 'warn' ||
    status === 'fail' ||
    status === 'unknown' ||
    status === 'notApplicable'
    ? status
    : 'unknown'
}

function normalizeDatastoreSecurityPostureCategory(category: unknown) {
  return category === 'transport' ||
    category === 'auth' ||
    category === 'environment' ||
    category === 'secrets' ||
    category === 'privileges' ||
    category === 'durability' ||
    category === 'risky-settings' ||
    category === 'cloud' ||
    category === 'local-file'
    ? category
    : 'environment'
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

function normalizeDatastoreApiServerPreferences(
  preferences: WorkspaceSnapshot['preferences']['datastoreApiServer'] | undefined,
) {
  const rawServers = Array.isArray(preferences?.servers) ? preferences.servers : []
  const hasLegacyServer = rawServers.length === 0 && Boolean(preferences) && (
    typeof preferences?.connectionId === 'string' ||
    typeof preferences?.environmentId === 'string' ||
    Boolean(preferences?.autoStart) ||
    (typeof preferences?.port === 'number' && preferences.port !== 17640) ||
    (typeof preferences?.activeServerId === 'string' &&
      preferences.activeServerId !== 'api-server-default')
  )
  const serverSource: Partial<DatastoreApiServerConfig>[] = rawServers.length > 0
    ? rawServers
    : hasLegacyServer
      ? [{
        id: preferences?.activeServerId || 'api-server-default',
        name: 'Local API Server',
        description: undefined,
        host: '127.0.0.1' as const,
        port: preferences?.port,
        autoStart: preferences?.autoStart,
        connectionId: preferences?.connectionId,
        environmentId: preferences?.environmentId,
        protocol: 'rest' as const,
        basePath: '',
        resources: [],
        customEndpoints: [],
      }]
      : []
  const servers: DatastoreApiServerConfig[] = serverSource.map((server, index) => {
    const port = clampNumber(server.port, 17640, 1024, 65535)
    const resources = normalizeDatastoreApiServerResources(server.resources)
    const customEndpoints = normalizeDatastoreApiServerCustomEndpoints(
      server.customEndpoints,
      resources,
    )
    return {
      id: typeof server.id === 'string' && server.id ? server.id : `api-server-${index + 1}`,
      name:
        typeof server.name === 'string' && server.name.trim()
          ? server.name.trim()
          : defaultApiServerName(port),
      description:
        typeof server.description === 'string' && server.description.trim()
          ? server.description.trim()
          : undefined,
      host: '127.0.0.1' as const,
      port,
      autoStart: Boolean(server.autoStart),
      protocol: normalizeApiServerProtocol(server.protocol),
      basePath: normalizeApiServerBasePath(server.basePath),
      connectionId: typeof server.connectionId === 'string' ? server.connectionId : undefined,
      environmentId:
        typeof server.environmentId === 'string' ? server.environmentId : undefined,
      resources,
      customEndpoints,
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

function normalizeDatastoreApiServerResources(resources: unknown): DatastoreApiServerResourceConfig[] {
  if (!Array.isArray(resources)) {
    return []
  }

  const seen = new Map<string, number>()
  return resources
    .filter((resource): resource is Record<string, unknown> => Boolean(resource && typeof resource === 'object'))
    .map((resource, index) => {
      const label = typeof resource.label === 'string' && resource.label.trim()
        ? resource.label.trim()
        : typeof resource.nodeId === 'string'
          ? resource.nodeId
          : `Resource ${index + 1}`
      const slug = uniqueApiServerSlug(
        typeof resource.endpointSlug === 'string' ? resource.endpointSlug : label,
        seen,
      )
      return {
        id: typeof resource.id === 'string' && resource.id ? resource.id : `api-resource-${index + 1}`,
        kind: normalizeCrudResourceKind(resource.kind),
        label,
        nodeId: typeof resource.nodeId === 'string' ? resource.nodeId : label,
        path: Array.isArray(resource.path)
          ? resource.path.filter((part): part is string => typeof part === 'string' && part.length > 0)
          : [],
        scope: typeof resource.scope === 'string' ? resource.scope : undefined,
        endpointSlug: slug,
        enabled: resource.enabled !== false,
        detail: typeof resource.detail === 'string' ? resource.detail : undefined,
        metadata: resource.metadata && typeof resource.metadata === 'object'
          ? resource.metadata as Record<string, unknown>
          : undefined,
      }
    })
}

function normalizeDatastoreApiServerCustomEndpoints(
  endpoints: unknown,
  resources: DatastoreApiServerResourceConfig[],
): DatastoreApiServerCustomEndpointConfig[] {
  if (!Array.isArray(endpoints)) {
    return []
  }

  const seen = new Map(resources.map((resource) => [resource.endpointSlug, 1]))
  return endpoints
    .filter((endpoint): endpoint is Record<string, unknown> => Boolean(endpoint && typeof endpoint === 'object'))
    .map((endpoint, index) => {
      const sourceName = typeof endpoint.sourceName === 'string' && endpoint.sourceName.trim()
        ? endpoint.sourceName.trim()
        : `Custom Endpoint ${index + 1}`
      const label = typeof endpoint.label === 'string' && endpoint.label.trim()
        ? endpoint.label.trim()
        : sourceName
      const slug = uniqueApiServerSlug(
        typeof endpoint.endpointSlug === 'string' ? endpoint.endpointSlug : label,
        seen,
      )
      const queryText = typeof endpoint.queryText === 'string' ? endpoint.queryText : ''
      return {
        id: typeof endpoint.id === 'string' && endpoint.id ? endpoint.id : `api-endpoint-${index + 1}`,
        label,
        description:
          typeof endpoint.description === 'string' && endpoint.description.trim()
            ? endpoint.description.trim()
            : undefined,
        endpointSlug: slug,
        enabled: endpoint.enabled !== false,
        method: endpoint.method === 'POST' ? 'POST' : 'GET',
        sourceLibraryNodeId:
          typeof endpoint.sourceLibraryNodeId === 'string'
            ? endpoint.sourceLibraryNodeId
            : '',
        sourceName,
        queryText,
        language:
          typeof endpoint.language === 'string' && endpoint.language.trim()
            ? endpoint.language as DatastoreApiServerCustomEndpointConfig['language']
            : 'sql',
        queryViewMode:
          endpoint.queryViewMode === 'builder' ||
          endpoint.queryViewMode === 'raw' ||
          endpoint.queryViewMode === 'script'
            ? endpoint.queryViewMode
            : 'raw',
        rowLimit: clampNumber(endpoint.rowLimit, 100, 1, 500),
        parameters: normalizeCustomEndpointParameters(endpoint.parameters, queryText),
      }
    })
}

function normalizeCustomEndpointParameters(
  parameters: unknown,
  queryText: string,
): DatastoreApiServerCustomEndpointParameterConfig[] {
  const seen = new Set<string>()
  const normalized: DatastoreApiServerCustomEndpointParameterConfig[] = Array.isArray(parameters)
    ? parameters
        .filter((parameter): parameter is Record<string, unknown> => Boolean(parameter && typeof parameter === 'object'))
        .flatMap((parameter, index) => {
          const name =
            typeof parameter.name === 'string' && validApiParameterName(parameter.name)
              ? parameter.name.trim()
              : `param${index + 1}`
          if (seen.has(name)) {
            return []
          }
          seen.add(name)
          return [{
            name,
            type:
              parameter.type === 'number' ||
              parameter.type === 'boolean' ||
              parameter.type === 'json'
                ? parameter.type
                : 'string',
            required: Boolean(parameter.required),
            defaultValue: parameter.defaultValue,
            description:
              typeof parameter.description === 'string' && parameter.description.trim()
                ? parameter.description.trim()
                : undefined,
            serialization:
              parameter.serialization === 'sql' ||
              parameter.serialization === 'json' ||
              parameter.serialization === 'raw'
                ? parameter.serialization
                : 'auto',
          }]
        })
    : []

  for (const name of apiParameterNames(queryText)) {
    if (!seen.has(name)) {
      seen.add(name)
      normalized.push({
        name,
        type: 'string',
        required: true,
        serialization: 'auto',
      })
    }
  }

  return normalized
}

function apiParameterNames(queryText: string) {
  const names: string[] = []
  const pattern = /\{\{api\.([^}]+)\}\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(queryText)) !== null) {
    const name = match[1]?.trim() ?? ''
    if (validApiParameterName(name) && !names.includes(name)) {
      names.push(name)
    }
  }
  return names
}

function validApiParameterName(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim())
}

function normalizeCrudResourceKind(value: unknown): DatastoreApiServerResourceConfig['kind'] {
  return value === 'collection' || value === 'key' || value === 'item' || value === 'index'
    ? value
    : 'table'
}

function normalizeApiServerProtocol(value: unknown): DatastoreApiServerProtocol {
  return value === 'graphql' || value === 'grpc' ? value : 'rest'
}

function normalizeApiServerBasePath(value: unknown) {
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}` : ''
}

function uniqueApiServerSlug(value: string, seen: Map<string, number>) {
  const base = apiServerSlug(value)
  const count = (seen.get(base) ?? 0) + 1
  seen.set(base, count)
  return count > 1 ? `${base}-${count}` : base
}

function apiServerSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'resource'
}

function normalizeDatastoreMcpServerPreferences(
  preferences: WorkspaceSnapshot['preferences']['datastoreMcpServer'] | undefined,
) {
  const rawServers = Array.isArray(preferences?.servers) ? preferences.servers : []
  const servers: DatastoreMcpServerConfig[] = rawServers.map((server, index) => {
    const port = clampNumber(server.port, 17641, 1024, 65535)
    return {
      id: typeof server.id === 'string' && server.id ? server.id : `mcp-server-${index + 1}`,
      name:
        typeof server.name === 'string' && server.name.trim()
          ? server.name.trim()
          : defaultMcpServerName(port),
      description:
        typeof server.description === 'string' && server.description.trim()
          ? server.description.trim()
          : undefined,
      host: '127.0.0.1' as const,
      port,
      autoStart: Boolean(server.autoStart),
      allowedOrigins: normalizeStringList(server.allowedOrigins),
      connectionIds: normalizeStringList(server.connectionIds),
      environmentIds: normalizeStringList(server.environmentIds),
      tokens: normalizeDatastoreMcpServerTokens(server.tokens),
    }
  })
  const activeServerId =
    typeof preferences?.activeServerId === 'string' &&
    servers.some((server) => server.id === preferences.activeServerId)
      ? preferences.activeServerId
      : servers[0]?.id
  const active = servers.find((server) => server.id === activeServerId) ?? servers[0]

  return {
    port: active?.port ?? 17641,
    autoStart: Boolean(active?.autoStart),
    activeServerId,
    servers,
  }
}

function normalizeDatastoreMcpServerTokens(tokens: unknown): DatastoreMcpServerTokenConfig[] {
  if (!Array.isArray(tokens)) {
    return []
  }

  return tokens
    .filter((token): token is Record<string, unknown> => Boolean(token && typeof token === 'object'))
    .filter((token) => Boolean(token.verifierSecretRef && typeof token.verifierSecretRef === 'object'))
    .map((token, index) => ({
      id: typeof token.id === 'string' && token.id ? token.id : `mcp-token-${index + 1}`,
      label:
        typeof token.label === 'string' && token.label.trim()
          ? token.label.trim()
          : `MCP client ${index + 1}`,
      enabled: token.enabled !== false,
      scopes: normalizeDatastoreMcpServerScopes(token.scopes),
      verifierSecretRef: token.verifierSecretRef as DatastoreMcpServerTokenConfig['verifierSecretRef'],
      createdAt: typeof token.createdAt === 'string' ? token.createdAt : new Date().toISOString(),
      lastUsedAt: typeof token.lastUsedAt === 'string' ? token.lastUsedAt : undefined,
    }))
}

function normalizeDatastoreMcpServerScopes(scopes: unknown): DatastoreMcpServerScope[] {
  const allowed = new Set<DatastoreMcpServerScope>([
    'workspace:read',
    'workspace:switch',
    'datastore:list',
    'datastore:explore',
    'query:read',
    'operation:diagnostic',
  ])
  const values = Array.isArray(scopes) ? scopes : []
  const normalized = values.filter((scope): scope is DatastoreMcpServerScope =>
    typeof scope === 'string' && allowed.has(scope as DatastoreMcpServerScope),
  )
  return normalized.length > 0 ? [...new Set(normalized)] : ['workspace:read', 'datastore:list']
}

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))]
}

function defaultMcpServerName(port: number) {
  return port === 17641 ? 'Local MCP Server' : `Local MCP Server ${port}`
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
