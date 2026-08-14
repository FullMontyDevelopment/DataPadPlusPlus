import type { AdapterManifest } from './capabilities'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ResolvedEnvironment,
} from './connection'
import type {
  AppPreferences,
  DatastoreSecurityCheckSnapshot,
  GuardrailDecision,
  LockState,
} from './security'
import type {
  ClosedQueryTabSnapshot,
  DiagnosticsReport,
  ExplorerNode,
  QueryTabState,
  LibraryNode,
  SavedWorkItem,
} from './workspace'

export interface AppHealth {
  runtime: 'browser-preview' | 'tauri'
  adapterHost: 'scaffolded' | 'connected' | 'simulated'
  secretStorage: 'planned' | 'ready' | 'keyring' | 'file'
  platform: string
  telemetry: 'disabled' | 'opt-in'
}

export interface AppLogFileSummary {
  id: string
  fileName: string
  path: string
  sizeBytes: number
  modifiedAt?: string
}

export interface AppLogFileContent {
  file: AppLogFileSummary
  content: string
}

export type UiActivity =
  | 'connections'
  | 'environments'
  | 'explorer'
  | 'library'
  | 'tests'
  | 'settings'

export type SidebarPane =
  | 'connections'
  | 'environments'
  | 'explorer'
  | 'library'
  | 'tests'

export type BottomPanelTab = 'results' | 'messages' | 'history' | 'details'
export type ResultsDock = 'bottom' | 'right'

export type RightDrawerView =
  | 'none'
  | 'connection'
  | 'inspection'
  | 'diagnostics'

export type ConnectionGroupMode = 'environment' | 'database-type' | 'none'

export type WorkspaceWindowRole = 'main' | 'editor'

export interface WorkspaceWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WorkspaceWindowState {
  id: string
  role: WorkspaceWindowRole
  tabIds: string[]
  activeTabId: string
  bounds?: WorkspaceWindowBounds
  monitorName?: string
  maximized?: boolean
  lastFocusedAt?: string
}

export interface UiState {
  activeConnectionId: string
  activeEnvironmentId: string
  activeTabId: string
  explorerFilter: string
  explorerView: 'tree' | 'structure'
  connectionGroupMode: ConnectionGroupMode
  sidebarSectionStates: Record<string, boolean>
  activeActivity: UiActivity
  sidebarCollapsed: boolean
  activeSidebarPane: SidebarPane
  sidebarWidth: number
  bottomPanelVisible: boolean
  activeBottomPanelTab: BottomPanelTab
  bottomPanelHeight: number
  resultsDock: ResultsDock
  resultsSideWidth: number
  mongoScriptGuideVisible: boolean
  mongoScriptGuideWidth: number
  rightDrawer: RightDrawerView
  rightDrawerWidth: number
  /** Window-local tab ownership. Older snapshots are normalized to one main window. */
  workspaceWindows?: WorkspaceWindowState[]
}

export interface WorkspaceSnapshot {
  schemaVersion: number
  workspaceRevision?: number
  connections: ConnectionProfile[]
  environments: EnvironmentProfile[]
  tabs: QueryTabState[]
  closedTabs: ClosedQueryTabSnapshot[]
  libraryNodes: LibraryNode[]
  /** @deprecated Legacy flat Saved Work data migrated into libraryNodes. */
  savedWork: SavedWorkItem[]
  explorerNodes: ExplorerNode[]
  adapterManifests: AdapterManifest[]
  preferences: AppPreferences
  datastoreSecurityChecks?: DatastoreSecurityCheckSnapshot
  guardrails: GuardrailDecision[]
  lockState: LockState
  ui: UiState
  updatedAt: string
}

export interface BootstrapPayload {
  health: AppHealth
  snapshot: WorkspaceSnapshot
  resolvedEnvironment: ResolvedEnvironment
  diagnostics: DiagnosticsReport
  transientResultIds?: Record<string, string>
  persistenceWarning?: PersistenceWarning
}

export interface PersistenceWarning {
  code: string
  message: string
}

export interface ExportBundle {
  format: 'datapadplusplus-bundle'
  version: number
  formatVersion?: number
  workspaceSchemaVersion?: number
  createdAt?: string
  compression?: 'gzip'
  kdf?: {
    algorithm: 'pbkdf2-sha256'
    iterations: number
    salt: string
  }
  cipher?: {
    algorithm: 'aes-256-gcm'
    nonce: string
  }
  encryptedPayload: string
  includesSecrets?: boolean
  secretCount?: number
}
