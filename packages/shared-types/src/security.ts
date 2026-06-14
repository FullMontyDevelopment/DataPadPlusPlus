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

export interface DatastoreApiServerConfig {
  id: string
  name: string
  host: '127.0.0.1'
  port: number
  autoStart: boolean
  connectionId?: string
  environmentId?: string
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
}

export interface LockState {
  isLocked: boolean
  lockedAt?: string
}
