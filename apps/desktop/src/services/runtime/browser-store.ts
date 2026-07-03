import type {
  BootstrapPayload,
  ConnectionProfile,
  EnvironmentProfile,
  ExecutionCapabilities,
  QueryTabState,
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
    return createBlankBootstrapPayload().snapshot
  }

  try {
    return sanitizeBrowserSnapshot(migrateWorkspaceSnapshot(JSON.parse(stored) as WorkspaceSnapshot))
  } catch {
    return createBlankBootstrapPayload().snapshot
  }
}



export function saveBrowserSnapshot(snapshot: WorkspaceSnapshot) {
  if (typeof window !== 'undefined') {
    const registry = ensureBrowserWorkspaceRegistry(snapshot)
    const activeWorkspaceId = registry.activeWorkspaceId || DEFAULT_WORKSPACE_ID
    const sanitized = sanitizeBrowserSnapshot(migrateWorkspaceSnapshot(snapshot))
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
  let registry = ensureBrowserWorkspaceRegistry()
  const current = loadBrowserSnapshot()
  saveBrowserSnapshot(current)
  registry = ensureBrowserWorkspaceRegistry()

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
  const snapshot = stored
    ? sanitizeBrowserSnapshot(migrateWorkspaceSnapshot(JSON.parse(stored) as WorkspaceSnapshot))
    : createBlankSnapshot()
  saveBrowserSnapshot(snapshot)
  return snapshot
}

function sanitizeBrowserSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const sanitized = cloneSnapshot(snapshot)
  sanitized.environments = sanitized.environments.map(sanitizeEnvironmentProfile)
  return sanitized
}

export function cloneSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WorkspaceSnapshot
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
    JSON.stringify(sanitizeBrowserSnapshot(migrateWorkspaceSnapshot(snapshot))),
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
  const migrated = migrateWorkspaceSnapshot(snapshot)
  const health = createBrowserPreviewHealth()

  return {
    health,
    snapshot: migrated,
    resolvedEnvironment: resolveEnvironment(
      migrated.environments,
      migrated.ui.activeEnvironmentId,
    ),
    diagnostics: createDiagnosticsReport(migrated, health),
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
) {
  return hashPassphrase(`${connectionId}:${environmentId}:${mode}:${queryText}`).replace(
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
