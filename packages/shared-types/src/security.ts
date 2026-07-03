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

export interface DatastoreSecurityChecksPreferences {
  enabled: boolean
  refreshIntervalDays: number
  mutedFindingIds?: string[]
  lastRefreshAttemptAt?: string
  lastSuccessfulRefreshAt?: string
  nextManualRefreshAllowedAt?: string
}

export type DatastoreSecurityCheckStatusValue =
  | 'idle'
  | 'refreshing'
  | 'ready'
  | 'stale'
  | 'error'
  | 'unsupported'

export type DatastoreSecurityTargetStatus =
  | 'pending'
  | 'checked'
  | 'notApplicable'
  | 'versionUnavailable'
  | 'mappingUnavailable'
  | 'error'

export type DatastoreSecuritySeverity =
  | 'CRITICAL'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'NONE'
  | 'UNKNOWN'

export interface DatastoreSecurityCpeCandidate {
  cpeName: string
  source: 'curated' | 'nvd'
  confidence: 'exact' | 'version-normalized' | 'product'
}

export interface DatastoreSecurityTarget {
  id: string
  connectionId: string
  environmentId: string
  connectionName: string
  environmentName: string
  engine: string
  family: string
  status: DatastoreSecurityTargetStatus
  detectedProduct?: string
  detectedVersion?: string
  cpeCandidates: DatastoreSecurityCpeCandidate[]
  findingCount: number
  highestSeverity?: DatastoreSecuritySeverity
  lastCheckedAt?: string
  message?: string
  warnings: string[]
}

export interface DatastoreSecurityKevDetails {
  dateAdded?: string
  requiredAction?: string
  dueDate?: string
  knownRansomwareCampaignUse?: string
  notes?: string
}

export interface DatastoreSecurityFinding {
  id: string
  targetIds: string[]
  cveId: string
  title: string
  summary: string
  severity: DatastoreSecuritySeverity
  cvssScore?: number
  cvssVector?: string
  publishedAt?: string
  modifiedAt?: string
  affectedProduct: string
  affectedVersion?: string
  remediation: string
  references: Array<{
    label: string
    url: string
    source?: string
  }>
  cwes: string[]
  knownExploited: boolean
  kev?: DatastoreSecurityKevDetails
  sourceUrls: string[]
}

export interface DatastoreSecurityCheckSnapshot {
  status: DatastoreSecurityCheckStatusValue
  checkedAt?: string
  expiresAt?: string
  sourceMetadata: Array<{
    source: 'nvd' | 'cisa-kev'
    fetchedAt?: string
    url: string
    recordCount?: number
  }>
  targets: DatastoreSecurityTarget[]
  findings: DatastoreSecurityFinding[]
  warnings: string[]
  errors: string[]
}

export interface DatastoreSecurityChecksSettingsRequest {
  enabled: boolean
  refreshIntervalDays?: number
  mutedFindingIds?: string[]
}

export interface DatastoreSecurityChecksRefreshRequest {
  manual?: boolean
}

export interface DatastoreSecurityChecksStatus {
  supported: boolean
  enabled: boolean
  message: string
  canRefresh: boolean
  refreshBlockedReason?: string
  preferences: DatastoreSecurityChecksPreferences
  snapshot?: DatastoreSecurityCheckSnapshot
}

export type FirstInstallGuideStatus = 'unseen' | 'started' | 'skipped' | 'completed'
export type FirstInstallGuidePersistedStatus = Exclude<FirstInstallGuideStatus, 'unseen'>
export type FirstInstallGuideStepId =
  | 'welcome'
  | 'folder'
  | 'connection'
  | 'save'
  | 'explorer'
  | 'query'
  | 'settings'

export interface FirstInstallGuidePreferences {
  status: FirstInstallGuideStatus
  currentStepId?: FirstInstallGuideStepId
  updatedAt?: string
  completedAt?: string
}

export interface ExplorerFolderOrderRequest {
  orderKey: string
  orderedNodeKeys: string[]
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
  datastoreSecurityChecks?: DatastoreSecurityChecksPreferences
  workspaceSearch?: WorkspaceSearchPreferences
  firstInstallGuide?: FirstInstallGuidePreferences
  explorerFolderOrders?: Record<string, string[]>
}

export interface LockState {
  isLocked: boolean
  lockedAt?: string
}
