import type {
  ConnectionProfile,
  EnvironmentProfile,
  ResolvedEnvironment,
} from './connection'

export type ThemeMode =
  | 'system'
  | 'light'
  | 'dark'
  | 'midnight'
  | 'graphite'
  | 'solarized-dark'
  | 'solarized-light'
  | 'high-contrast'
export type TelemetryMode = 'disabled' | 'opt-in'
export type GuardrailAction = 'connect' | 'execute-query' | 'export'
export type GuardrailStatus = 'allow' | 'confirm' | 'block'
export type AppShortcutId =
  | 'saveQuery'
  | 'runQuery'
  | 'explainQuery'
  | 'togglePanel'
  | 'toggleSidebar'
  | 'newQuery'
  | 'closeTab'
  | 'reopenClosedTab'
  | 'refresh'

export type KeyboardShortcutPreferences = Partial<Record<AppShortcutId, string>>

export interface WorkspaceBackupPreferences {
  enabled: boolean
  intervalMinutes: number
  maxBackups: number
  includeSecrets: boolean
  passphraseSecretRef?: import('./connection').SecretRef
  lastBackupAt?: string
  lastWorkspaceUpdatedAt?: string
}

export interface DatastoreApiServerPreferences {
  enabled: boolean
  host: '127.0.0.1'
  port: number
  autoStart: boolean
  connectionId?: string
  environmentId?: string
  activeServerId?: string
  servers?: DatastoreApiServerConfig[]
}

export type DatastoreApiServerProtocol = 'rest' | 'graphql' | 'grpc'

export interface DatastoreApiServerResourceConfig {
  id: string
  kind: 'table' | 'collection' | 'key' | 'item' | 'index'
  label: string
  nodeId: string
  path?: string[]
  scope?: string
  endpointSlug: string
  enabled: boolean
  detail?: string
  metadata?: Record<string, unknown>
}

export type DatastoreApiServerCustomEndpointMethod = 'GET' | 'POST'
export type DatastoreApiServerCustomEndpointParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
export type DatastoreApiServerCustomEndpointParameterSerialization =
  | 'auto'
  | 'sql'
  | 'json'
  | 'raw'

export interface DatastoreApiServerCustomEndpointParameterConfig {
  name: string
  type: DatastoreApiServerCustomEndpointParameterType
  required: boolean
  defaultValue?: unknown
  description?: string
  serialization?: DatastoreApiServerCustomEndpointParameterSerialization
}

export interface DatastoreApiServerCustomEndpointConfig {
  id: string
  label: string
  description?: string
  endpointSlug: string
  enabled: boolean
  method: DatastoreApiServerCustomEndpointMethod
  sourceLibraryNodeId: string
  sourceName: string
  queryText: string
  language: import('./workspace').QueryLanguage
  queryViewMode?: import('./workspace').QueryViewMode
  rowLimit?: number
  parameters?: DatastoreApiServerCustomEndpointParameterConfig[]
}

export interface DatastoreApiServerConfig {
  id: string
  name: string
  description?: string
  host: '127.0.0.1'
  port: number
  autoStart: boolean
  protocol?: DatastoreApiServerProtocol
  basePath?: string
  connectionId?: string
  environmentId?: string
  resources?: DatastoreApiServerResourceConfig[]
  customEndpoints?: DatastoreApiServerCustomEndpointConfig[]
}

export const DATASTORE_MCP_SERVER_SCOPES = [
  'workspace:read',
  'workspace:switch',
  'datastore:list',
  'datastore:explore',
  'query:read',
  'operation:diagnostic',
] as const

export type DatastoreMcpServerScope = (typeof DATASTORE_MCP_SERVER_SCOPES)[number]

export interface DatastoreMcpServerTokenConfig {
  id: string
  label: string
  enabled: boolean
  scopes: DatastoreMcpServerScope[]
  verifierSecretRef: import('./connection').SecretRef
  createdAt: string
  lastUsedAt?: string
}

export interface DatastoreMcpServerConfig {
  id: string
  name: string
  description?: string
  host: '127.0.0.1'
  port: number
  autoStart: boolean
  allowedOrigins: string[]
  connectionIds: string[]
  environmentIds: string[]
  tokens: DatastoreMcpServerTokenConfig[]
}

export interface DatastoreMcpServerPreferences {
  enabled: boolean
  host: '127.0.0.1'
  port: number
  autoStart: boolean
  activeServerId?: string
  servers?: DatastoreMcpServerConfig[]
}

export interface WorkspaceSearchPreferences {
  enabled: boolean
}

export type FirstInstallGuideStatus = 'unseen' | 'started' | 'skipped' | 'completed'
export type FirstInstallGuidePersistedStatus = Exclude<FirstInstallGuideStatus, 'unseen'>

export interface FirstInstallGuidePreferences {
  status: FirstInstallGuideStatus
  updatedAt?: string
  completedAt?: string
}

export interface GuardrailPolicy {
  id: string
  action: GuardrailAction
  minimumRisk?: 'medium' | 'high' | 'critical'
  requireConfirmation?: boolean
  blockWritesWhenReadOnly?: boolean
  warnOnLargeResults?: boolean
}

export interface GuardrailDecision {
  id?: string
  status: GuardrailStatus
  reasons: string[]
  safeModeApplied: boolean
  requiredConfirmationText?: string
}

export interface GuardrailEvaluationInput {
  action: GuardrailAction
  connection: ConnectionProfile
  environment: EnvironmentProfile
  resolvedEnvironment: ResolvedEnvironment
  queryText?: string
}

export interface AppPreferences {
  theme: ThemeMode
  telemetry: TelemetryMode
  lockAfterMinutes: number
  safeModeEnabled: boolean
  keyboardShortcuts?: KeyboardShortcutPreferences
  workspaceBackups?: WorkspaceBackupPreferences
  datastoreApiServer?: DatastoreApiServerPreferences
  datastoreMcpServer?: DatastoreMcpServerPreferences
  workspaceSearch?: WorkspaceSearchPreferences
  firstInstallGuide?: FirstInstallGuidePreferences
}

export interface LockState {
  isLocked: boolean
  lockedAt?: string
}
