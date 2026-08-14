import type {
  BootstrapPayload,
  ConnectionProfile,
  EnvironmentProfile,
  ExecutionCapabilities,
  ExecutionResultEnvelope,
  QueryTabState,
  SqlQueryScope,
  UpdateUiStateRequest,
  WorkspaceCreateRequest,
  WorkspaceRenameRequest,
  WorkspaceSnapshot,
  WorkspaceSummary,
  WorkspaceSwitcherSettingsRequest,
  WorkspaceSwitcherStatus,
  WorkspaceSwitchRequest,
} from '@datapadplusplus/shared-types'
import { createBlankBootstrapPayload, createBlankSnapshot, createBrowserPreviewHealth, createDiagnosticsReport } from '../../app/data/workspace-factory'
import { sanitizeEnvironmentProfile } from '../../app/state/environment-variables'
import { defaultRowLimitForConnection, editorLanguageForConnection, migrateWorkspaceSnapshot, resolveEnvironment } from '../../app/state/helpers'

const STORAGE_KEY = 'datapadplusplus.workspace.v2'
const WORKSPACE_REGISTRY_STORAGE_KEY = 'datapadplusplus.workspaces.registry.v1'
const WORKSPACE_SNAPSHOT_STORAGE_PREFIX = 'datapadplusplus.workspace.snapshot.v1.'
const DEFAULT_WORKSPACE_ID = 'default'
const DEFAULT_WORKSPACE_NAME = 'Default Workspace'
const browserResults = new Map<string, ExecutionResultEnvelope>()
const browserConnectionStrings = new Map<string, string>()

interface BrowserWorkspaceRegistry {
  enabled: boolean
  activeWorkspaceId: string
  workspaces: WorkspaceSummary[]
}

export function loadBrowserSnapshot(): WorkspaceSnapshot {
  if (typeof window === 'undefined') {
    return createBlankBootstrapPayload().snapshot
  }

  const registry = ensureBrowserWorkspaceRegistry()
  const activeWorkspaceId = registry.activeWorkspaceId || DEFAULT_WORKSPACE_ID
  const stored =
    window.localStorage.getItem(workspaceSnapshotStorageKey(activeWorkspaceId)) ??
    (activeWorkspaceId === DEFAULT_WORKSPACE_ID
      ? window.localStorage.getItem(STORAGE_KEY)
      : null)

  if (!stored) {
    browserResults.clear()
    return createBlankBootstrapPayload().snapshot
  }

  try {
    const migrated = migrateWorkspaceSnapshot(JSON.parse(stored) as WorkspaceSnapshot)
    rememberBrowserConnectionStrings(migrated)
    const sanitized = sanitizeBrowserSnapshot(stripBrowserConnectionStrings(migrated))
    window.localStorage.setItem(
      workspaceSnapshotStorageKey(activeWorkspaceId),
      JSON.stringify(sanitized),
    )
    if (activeWorkspaceId === DEFAULT_WORKSPACE_ID) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
    }
    return restoreBrowserConnectionStrings(restoreBrowserResults(sanitized))
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('newer DataPad++ version') ||
        error.message.includes('schema version is invalid'))
    ) {
      throw error
    }
    return createBlankBootstrapPayload().snapshot
  }
}



export function saveBrowserSnapshot(snapshot: WorkspaceSnapshot) {
  if (typeof window !== 'undefined') {
    const registry = ensureBrowserWorkspaceRegistry(snapshot)
    const activeWorkspaceId = registry.activeWorkspaceId || DEFAULT_WORKSPACE_ID
    syncBrowserResults(snapshot)
    rememberBrowserConnectionStrings(snapshot)
    const sanitized = sanitizeBrowserSnapshot(
      stripBrowserConnectionStrings(migrateWorkspaceSnapshot(stripTransientResults(snapshot))),
    )
    window.localStorage.setItem(
      workspaceSnapshotStorageKey(activeWorkspaceId),
      JSON.stringify(sanitized),
    )
    if (activeWorkspaceId === DEFAULT_WORKSPACE_ID) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
    }
    saveBrowserWorkspaceRegistry(
      updateBrowserWorkspaceSummary(registry, activeWorkspaceId, sanitized),
    )
  }
}

export function getBrowserWorkspaceSwitcherStatus(): WorkspaceSwitcherStatus {
  return registryToStatus(ensureBrowserWorkspaceRegistry())
}

export function setBrowserWorkspaceSwitcherEnabled(
  request: WorkspaceSwitcherSettingsRequest,
): WorkspaceSwitcherStatus {
  const registry = ensureBrowserWorkspaceRegistry()
  registry.enabled = Boolean(request.enabled)
  saveBrowserWorkspaceRegistry(registry)
  return registryToStatus(registry)
}

export function createBrowserWorkspace(request: WorkspaceCreateRequest): WorkspaceSnapshot {
  const current = loadBrowserSnapshot()
  saveBrowserSnapshot(current)
  const registry = ensureBrowserWorkspaceRegistry()

  const timestamp = new Date().toISOString()
  const workspaceId = browserWorkspaceId()
  const snapshot = createBlankSnapshot()
  snapshot.updatedAt = timestamp
  const name = normalizeWorkspaceName(request.name)

  const nextRegistry: BrowserWorkspaceRegistry = {
    ...registry,
    activeWorkspaceId: workspaceId,
    workspaces: [
      ...registry.workspaces,
      {
        id: workspaceId,
        name,
        schemaVersion: snapshot.schemaVersion,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastOpenedAt: timestamp,
        counts: workspaceCounts(snapshot),
      },
    ],
  }

  saveBrowserWorkspaceRegistry(nextRegistry)
  saveBrowserSnapshot(snapshot)
  return snapshot
}

export function importBrowserWorkspace(
  importedSnapshot: WorkspaceSnapshot,
  workspaceName: string | undefined,
  importAsNew: boolean,
): { snapshot: WorkspaceSnapshot; status: WorkspaceSwitcherStatus } {
  const current = loadBrowserSnapshot()
  saveBrowserSnapshot(current)
  const registry = ensureBrowserWorkspaceRegistry()
  const timestamp = new Date().toISOString()
  const snapshot = migrateWorkspaceSnapshot(cloneSnapshot(importedSnapshot))
  snapshot.updatedAt = timestamp

  if (importAsNew) {
    const workspaceId = browserWorkspaceId()
    const name = normalizeWorkspaceName(workspaceName ?? '')
    const nextRegistry: BrowserWorkspaceRegistry = {
      ...registry,
      activeWorkspaceId: workspaceId,
      workspaces: [
        ...registry.workspaces,
        {
          id: workspaceId,
          name,
          schemaVersion: snapshot.schemaVersion,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastOpenedAt: timestamp,
          counts: workspaceCounts(snapshot),
        },
      ],
    }
    saveBrowserWorkspaceRegistry(nextRegistry)
  }

  saveBrowserSnapshot(snapshot)
  return {
    snapshot,
    status: getBrowserWorkspaceSwitcherStatus(),
  }
}

export function renameBrowserWorkspace(request: WorkspaceRenameRequest): WorkspaceSwitcherStatus {
  const registry = ensureBrowserWorkspaceRegistry()
  const name = normalizeWorkspaceName(request.name)
  const next = {
    ...registry,
    workspaces: registry.workspaces.map((workspace) =>
      workspace.id === request.workspaceId
        ? { ...workspace, name }
        : workspace,
    ),
  }

  if (!next.workspaces.some((workspace) => workspace.id === request.workspaceId)) {
    throw new Error('Workspace was not found.')
  }

  saveBrowserWorkspaceRegistry(next)
  return registryToStatus(next)
}

export function switchBrowserWorkspace(request: WorkspaceSwitchRequest): WorkspaceSnapshot {
  let registry = ensureBrowserWorkspaceRegistry()
  let workspace = registry.workspaces.find((item) => item.id === request.workspaceId)

  if (!workspace) {
    throw new Error('Workspace was not found.')
  }

  saveBrowserSnapshot(loadBrowserSnapshot())
  registry = ensureBrowserWorkspaceRegistry()
  workspace = registry.workspaces.find((item) => item.id === request.workspaceId)
  if (!workspace) {
    throw new Error('Workspace was not found.')
  }
  const timestamp = new Date().toISOString()
  const nextRegistry: BrowserWorkspaceRegistry = {
    ...registry,
    activeWorkspaceId: workspace.id,
    workspaces: registry.workspaces.map((item) =>
      item.id === workspace.id ? { ...item, lastOpenedAt: timestamp } : item,
    ),
  }
  saveBrowserWorkspaceRegistry(nextRegistry)

  const stored = window.localStorage.getItem(workspaceSnapshotStorageKey(workspace.id))
  const snapshot = restoreBrowserConnectionStrings(
    stored
      ? sanitizeBrowserSnapshot(migrateWorkspaceSnapshot(JSON.parse(stored) as WorkspaceSnapshot))
      : createBlankSnapshot(),
  )
  saveBrowserSnapshot(snapshot)
  return snapshot
}

function sanitizeBrowserSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const sanitized = boundBrowserHistory(stripRefreshableBrowserState(snapshot))
  return {
    ...sanitized,
    environments: sanitized.environments.map(sanitizeEnvironmentProfile),
    adapterManifests: [],
    datastoreSecurityChecks: undefined,
  }
}

function rememberBrowserConnectionStrings(snapshot: WorkspaceSnapshot) {
  for (const connection of snapshot.connections) {
    if (connection.connectionString) {
      browserConnectionStrings.set(connection.id, connection.connectionString)
    }
  }
}

function stripBrowserConnectionStrings(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    connections: snapshot.connections.map((connection) => ({
      ...connection,
      connectionString: undefined,
      auth: {
        ...connection.auth,
        connectionStringSecretRef: undefined,
      },
    })),
  }
}

function restoreBrowserConnectionStrings(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    connections: snapshot.connections.map((connection) => ({
      ...connection,
      connectionString: browserConnectionStrings.get(connection.id),
    })),
  }
}

const MAX_PERSISTED_HISTORY_ENTRIES = 500
const MAX_PERSISTED_HISTORY_BYTES = 2 * 1024 * 1024

function stripRefreshableBrowserState(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const sanitizeTab = <T extends WorkspaceSnapshot['tabs'][number]>(tab: T): T => {
    const objectTarget = { ...tab.objectViewState }
    delete objectTarget.payload
    delete objectTarget.queryTemplate
    delete objectTarget.warnings
    const metricsTarget = { ...tab.metricsState }
    delete metricsTarget.diagnostics
    delete metricsTarget.warnings
    const hadObjectPayload = Boolean(
      tab.objectViewState?.payload ||
      tab.objectViewState?.queryTemplate ||
      (tab.objectViewState?.warnings?.length ?? 0) > 0,
    )
    const hadMetricsPayload = Boolean(
      tab.metricsState?.diagnostics || (tab.metricsState?.warnings?.length ?? 0) > 0,
    )

    return {
      ...tab,
      result: undefined,
      activeExecution: undefined,
      error: undefined,
      testRun: undefined,
      status: tab.status === 'queued' || tab.status === 'running' ? 'idle' as const : tab.status,
      objectViewState: tab.objectViewState
        ? {
            ...objectTarget,
            warnings: [],
            refreshRequired: hadObjectPayload || tab.objectViewState.refreshRequired,
          } as WorkspaceSnapshot['tabs'][number]['objectViewState']
        : undefined,
      metricsState: tab.metricsState
        ? {
            ...metricsTarget,
            warnings: [],
            refreshRequired: hadMetricsPayload || tab.metricsState.refreshRequired,
          } as WorkspaceSnapshot['tabs'][number]['metricsState']
        : undefined,
    } as T
  }

  return {
    ...snapshot,
    tabs: snapshot.tabs.map(sanitizeTab),
    closedTabs: snapshot.closedTabs.map(sanitizeTab),
  }
}

function boundBrowserHistory(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const openTabs = snapshot.tabs.map((tab) => ({
    ...tab,
    history: [] as typeof tab.history,
  }))
  const closedTabs = snapshot.closedTabs.map((tab) => ({
    ...tab,
    history: [] as typeof tab.history,
  }))
  const candidates = [
    ...snapshot.tabs.flatMap((tab, tabIndex) =>
      tab.history.map((entry) => ({ closed: false, tabIndex, entry })),
    ),
    ...snapshot.closedTabs.flatMap((tab, tabIndex) =>
      tab.history.map((entry) => ({ closed: true, tabIndex, entry })),
    ),
  ].sort((left, right) => right.entry.executedAt.localeCompare(left.entry.executedAt))

  let retainedBytes = 0
  let retainedEntries = 0
  for (const candidate of candidates) {
    if (retainedEntries >= MAX_PERSISTED_HISTORY_ENTRIES) break
    const entryBytes = new TextEncoder().encode(JSON.stringify(candidate.entry)).byteLength
    if (retainedBytes + entryBytes > MAX_PERSISTED_HISTORY_BYTES) break

    if (candidate.closed) {
      closedTabs[candidate.tabIndex]?.history.push(candidate.entry)
    } else {
      openTabs[candidate.tabIndex]?.history.push(candidate.entry)
    }
    retainedBytes += entryBytes
    retainedEntries += 1
  }

  return {
    ...snapshot,
    tabs: openTabs,
    closedTabs,
  }
}

export function cloneSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const resultsByTab = new Map(
    snapshot.tabs
      .filter((tab) => tab.result)
      .map((tab) => [tab.id, tab.result] as const),
  )
  const cloned = JSON.parse(
    JSON.stringify(stripTransientResults(snapshot)),
  ) as WorkspaceSnapshot

  return {
    ...cloned,
    tabs: cloned.tabs.map((tab) => {
      const result = resultsByTab.get(tab.id)
      return result ? { ...tab, result } : tab
    }),
  }
}

function ensureBrowserWorkspaceRegistry(seedSnapshot?: WorkspaceSnapshot): BrowserWorkspaceRegistry {
  if (typeof window === 'undefined') {
    return defaultBrowserWorkspaceRegistry(seedSnapshot ?? createBlankSnapshot())
  }

  const stored = window.localStorage.getItem(WORKSPACE_REGISTRY_STORAGE_KEY)
  if (stored) {
    try {
      const registry = normalizeBrowserWorkspaceRegistry(JSON.parse(stored) as Partial<BrowserWorkspaceRegistry>)
      if (registry.workspaces.length) {
        saveBrowserWorkspaceRegistry(registry)
        return registry
      }
    } catch {
      // Fall back to default registry below.
    }
  }

  const legacyStored = window.localStorage.getItem(STORAGE_KEY)
  let snapshot = seedSnapshot ?? createBlankSnapshot()
  if (legacyStored) {
    try {
      snapshot = sanitizeBrowserSnapshot(migrateWorkspaceSnapshot(JSON.parse(legacyStored) as WorkspaceSnapshot))
    } catch {
      snapshot = seedSnapshot ?? createBlankSnapshot()
    }
  }
  const registry = defaultBrowserWorkspaceRegistry(snapshot)
  window.localStorage.setItem(
    workspaceSnapshotStorageKey(DEFAULT_WORKSPACE_ID),
    JSON.stringify(
      sanitizeBrowserSnapshot(
        migrateWorkspaceSnapshot(stripTransientResults(snapshot)),
      ),
    ),
  )
  saveBrowserWorkspaceRegistry(registry)
  return registry
}

function defaultBrowserWorkspaceRegistry(snapshot: WorkspaceSnapshot): BrowserWorkspaceRegistry {
  const timestamp = snapshot.updatedAt || new Date().toISOString()

  return {
    enabled: false,
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    workspaces: [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
        schemaVersion: snapshot.schemaVersion,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastOpenedAt: timestamp,
        counts: workspaceCounts(snapshot),
      },
    ],
  }
}

function normalizeBrowserWorkspaceRegistry(
  registry: Partial<BrowserWorkspaceRegistry>,
): BrowserWorkspaceRegistry {
  const workspaces = Array.isArray(registry.workspaces)
    ? registry.workspaces
        .filter((workspace): workspace is WorkspaceSummary =>
          Boolean(workspace?.id && workspace.name),
        )
        .map((workspace) => ({
          id: workspace.id,
          name: workspace.name.trim() || DEFAULT_WORKSPACE_NAME,
          schemaVersion: workspace.schemaVersion || createBlankSnapshot().schemaVersion,
          createdAt: workspace.createdAt || new Date().toISOString(),
          updatedAt: workspace.updatedAt || workspace.createdAt || new Date().toISOString(),
          lastOpenedAt: workspace.lastOpenedAt,
          counts: {
            connections: Math.max(0, Math.round(workspace.counts?.connections ?? 0)),
            environments: Math.max(0, Math.round(workspace.counts?.environments ?? 0)),
            libraryItems: Math.max(0, Math.round(workspace.counts?.libraryItems ?? 0)),
            openTabs: Math.max(0, Math.round(workspace.counts?.openTabs ?? 0)),
          },
        }))
    : []
  const activeWorkspaceId =
    typeof registry.activeWorkspaceId === 'string' &&
    workspaces.some((workspace) => workspace.id === registry.activeWorkspaceId)
      ? registry.activeWorkspaceId
      : workspaces[0]?.id ?? DEFAULT_WORKSPACE_ID

  return {
    enabled: Boolean(registry.enabled),
    activeWorkspaceId,
    workspaces: workspaces.length ? workspaces : defaultBrowserWorkspaceRegistry(createBlankSnapshot()).workspaces,
  }
}

function saveBrowserWorkspaceRegistry(registry: BrowserWorkspaceRegistry) {
  window.localStorage.setItem(
    WORKSPACE_REGISTRY_STORAGE_KEY,
    JSON.stringify(normalizeBrowserWorkspaceRegistry(registry)),
  )
}

function updateBrowserWorkspaceSummary(
  registry: BrowserWorkspaceRegistry,
  workspaceId: string,
  snapshot: WorkspaceSnapshot,
): BrowserWorkspaceRegistry {
  const timestamp = snapshot.updatedAt || new Date().toISOString()
  const workspaces = registry.workspaces.map((workspace) =>
    workspace.id === workspaceId
      ? {
          ...workspace,
          updatedAt: timestamp,
          schemaVersion: snapshot.schemaVersion,
          counts: workspaceCounts(snapshot),
        }
      : workspace,
  )

  return {
    ...registry,
    workspaces,
  }
}

function workspaceCounts(snapshot: WorkspaceSnapshot): WorkspaceSummary['counts'] {
  return {
    connections: snapshot.connections.length,
    environments: snapshot.environments.length,
    libraryItems: snapshot.libraryNodes.length,
    openTabs: snapshot.tabs.length,
  }
}

function registryToStatus(registry: BrowserWorkspaceRegistry): WorkspaceSwitcherStatus {
  return {
    enabled: registry.enabled,
    activeWorkspaceId: registry.activeWorkspaceId,
    workspaces: [...registry.workspaces].sort(compareWorkspaceSummaries),
  }
}

function compareWorkspaceSummaries(left: WorkspaceSummary, right: WorkspaceSummary) {
  if (left.id === DEFAULT_WORKSPACE_ID) return -1
  if (right.id === DEFAULT_WORKSPACE_ID) return 1
  return left.name.localeCompare(right.name, undefined, {
    sensitivity: 'base',
    numeric: true,
  })
}

function workspaceSnapshotStorageKey(workspaceId: string) {
  return `${WORKSPACE_SNAPSHOT_STORAGE_PREFIX}${workspaceId}`
}

function normalizeWorkspaceName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Enter a workspace name.')
  }
  return trimmed.slice(0, 80)
}

function browserWorkspaceId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `workspace-${crypto.randomUUID()}`
  }
  return `workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`
}



export function buildBrowserPayload(snapshot: WorkspaceSnapshot): BootstrapPayload {
  const migrated = migrateWorkspaceSnapshot(stripTransientResults(snapshot))
  const health = createBrowserPreviewHealth()
  const transientResultIds = Object.fromEntries(
    snapshot.tabs.flatMap((tab) =>
      tab.result ? [[tab.id, tab.result.id] as const] : [],
    ),
  )

  return {
    health,
    snapshot: migrated,
    resolvedEnvironment: resolveEnvironment(
      migrated.environments,
      migrated.ui.activeEnvironmentId,
    ),
    diagnostics: createDiagnosticsReport(migrated, health),
    transientResultIds,
  }
}

function stripTransientResults(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((tab) =>
      tab.result ? { ...tab, result: undefined } : tab,
    ),
    closedTabs: snapshot.closedTabs.map((tab) =>
      tab.result ? { ...tab, result: undefined } : tab,
    ),
  }
}

function syncBrowserResults(snapshot: WorkspaceSnapshot) {
  browserResults.clear()
  for (const tab of snapshot.tabs) {
    if (tab.result) {
      browserResults.set(tab.id, tab.result)
    }
  }
}

function restoreBrowserResults(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  if (!browserResults.size) {
    return snapshot
  }

  return {
    ...snapshot,
    tabs: snapshot.tabs.map((tab) => {
      const result = browserResults.get(tab.id)
      return result ? { ...tab, result } : tab
    }),
  }
}



export function updateUiStateLocally(
  snapshot: WorkspaceSnapshot,
  patch: UpdateUiStateRequest,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  next.ui = {
    ...next.ui,
    ...normalizeUiStatePatch(patch),
  }
  next.updatedAt = new Date().toISOString()
  return migrateWorkspaceSnapshot(next)
}

export function normalizeUiStatePatch(patch: UpdateUiStateRequest): UpdateUiStateRequest {
  const next = { ...patch }

  for (const key of UI_SIZE_PATCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      continue
    }

    const normalized = normalizeUiSize(next[key])
    if (typeof normalized === 'number') {
      next[key] = normalized
    } else {
      delete next[key]
    }
  }

  return next
}

const UI_SIZE_PATCH_KEYS = [
  'sidebarWidth',
  'bottomPanelHeight',
  'resultsSideWidth',
  'rightDrawerWidth',
] as const satisfies readonly (keyof UpdateUiStateRequest)[]

function normalizeUiSize(value: number | undefined) {
  if (typeof value !== 'number') {
    return undefined
  }

  if (!Number.isFinite(value) || value < 0) {
    return undefined
  }

  return Math.round(value)
}



export function decodeBase64(input: string) {
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    return window.atob(input)
  }

  return input
}



export function hashPassphrase(input: string) {
  let hash = 0

  for (const character of input) {
    hash = (hash << 5) - hash + character.charCodeAt(0)
    hash |= 0
  }

  return `preview-${Math.abs(hash).toString(16)}`
}



export function confirmationGuardrailId(
  connectionId: string,
  environmentId: string,
  mode: string,
  queryText: string,
  sqlScope?: SqlQueryScope,
) {
  return hashPassphrase(`${connectionId}:${environmentId}:${mode}:${queryText}:${JSON.stringify(sqlScope ?? null)}`).replace(
    'preview-',
    'guardrail-',
  )
}



export function findConnection(
  snapshot: WorkspaceSnapshot,
  connectionId: string,
): ConnectionProfile | undefined {
  return snapshot.connections.find((item) => item.id === connectionId)
}



export function findEnvironment(
  snapshot: WorkspaceSnapshot,
  environmentId: string,
): EnvironmentProfile | undefined {
  return snapshot.environments.find((item) => item.id === environmentId)
}



export function findTab(
  snapshot: WorkspaceSnapshot,
  tabId: string,
): QueryTabState | undefined {
  return snapshot.tabs.find((item) => item.id === tabId)
}



export function buildExecutionCapabilities(
  connection: ConnectionProfile,
  snapshot: WorkspaceSnapshot,
): ExecutionCapabilities {
  const manifest = snapshot.adapterManifests.find(
    (item) => item.engine === connection.engine,
  )
  const capabilities = new Set(manifest?.capabilities ?? [])

  return {
    canCancel: capabilities.has('supports_query_cancellation'),
    canExplain: capabilities.has('supports_explain_plan'),
    supportsLiveMetadata:
      capabilities.has('supports_schema_browser') ||
      capabilities.has('supports_key_browser') ||
      capabilities.has('supports_document_view') ||
      capabilities.has('supports_graph_view') ||
      capabilities.has('supports_index_management') ||
      capabilities.has('supports_metrics_collection'),
    editorLanguage: editorLanguageForConnection(connection),
    defaultRowLimit: defaultRowLimitForConnection(connection),
  }
}
