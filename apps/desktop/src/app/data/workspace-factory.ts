import type {
  AdapterManifest,
  AppHealth,
  AppPreferences,
  BootstrapPayload,
  DiagnosticsReport,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { DATAPADPLUSPLUS_ADAPTER_MANIFESTS } from '@datapadplusplus/shared-types'
import { buildDiagnosticsReport, resolveEnvironment } from '../state/helpers'
import { defaultKeyboardShortcuts } from '../keyboard-shortcuts'

export const EMPTY_WORKSPACE_SCHEMA_VERSION = 10

export const adapterManifests: AdapterManifest[] = DATAPADPLUSPLUS_ADAPTER_MANIFESTS

export function createDefaultPreferences(): AppPreferences {
  return {
    theme: 'dark',
    telemetry: 'opt-in',
    lockAfterMinutes: 15,
    safeModeEnabled: true,
    keyboardShortcuts: defaultKeyboardShortcuts(),
    workspaceBackups: {
      enabled: false,
      intervalMinutes: 30,
      maxBackups: 20,
      includeSecrets: false,
    },
    datastoreApiServer: {
      enabled: false,
      host: '127.0.0.1',
      port: 17640,
      autoStart: false,
      activeServerId: undefined,
      servers: [],
    },
    datastoreMcpServer: {
      enabled: false,
      host: '127.0.0.1',
      port: 17641,
      autoStart: false,
      activeServerId: undefined,
      servers: [],
    },
    workspaceSearch: {
      enabled: false,
    },
    firstInstallGuide: {
      status: 'unseen',
    },
  }
}

export const defaultPreferences: AppPreferences = createDefaultPreferences()

export function createBlankSnapshot(): WorkspaceSnapshot {
  const timestamp = new Date().toISOString()

  return {
    schemaVersion: EMPTY_WORKSPACE_SCHEMA_VERSION,
    connections: [],
    environments: [],
    tabs: [],
    closedTabs: [],
    libraryNodes: [],
    savedWork: [],
    explorerNodes: [],
    adapterManifests,
    preferences: createDefaultPreferences(),
    guardrails: [],
    lockState: {
      isLocked: false,
    },
    ui: {
      activeConnectionId: '',
      activeEnvironmentId: '',
      activeTabId: '',
      explorerFilter: '',
      explorerView: 'structure',
      connectionGroupMode: 'none',
      sidebarSectionStates: {},
      activeActivity: 'library',
      sidebarCollapsed: false,
      activeSidebarPane: 'library',
      sidebarWidth: 280,
      bottomPanelVisible: false,
      activeBottomPanelTab: 'results',
      bottomPanelHeight: 260,
      resultsDock: 'bottom',
      resultsSideWidth: 420,
      rightDrawer: 'none',
      rightDrawerWidth: 360,
    },
    updatedAt: timestamp,
  }
}

export function createBrowserPreviewHealth(): AppHealth {
  return {
    runtime: 'browser-preview',
    adapterHost: 'simulated',
    secretStorage: 'planned',
    platform: 'web',
    telemetry: 'opt-in',
  }
}

export function createBlankBootstrapPayload(): BootstrapPayload {
  const snapshot = createBlankSnapshot()
  const health = createBrowserPreviewHealth()

  return {
    health,
    snapshot,
    resolvedEnvironment: resolveEnvironment(
      snapshot.environments,
      snapshot.ui.activeEnvironmentId,
    ),
    diagnostics: buildDiagnosticsReport(snapshot, health),
  }
}

export function createDiagnosticsReport(
  snapshot: WorkspaceSnapshot,
  health: AppHealth,
): DiagnosticsReport {
  return buildDiagnosticsReport(snapshot, health)
}
