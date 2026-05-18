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

export const EMPTY_WORKSPACE_SCHEMA_VERSION = 9

export const adapterManifests: AdapterManifest[] = DATAPADPLUSPLUS_ADAPTER_MANIFESTS

export const defaultPreferences: AppPreferences = {
  theme: 'dark',
  telemetry: 'opt-in',
  lockAfterMinutes: 15,
  safeModeEnabled: true,
}

export function createBlankSnapshot(): WorkspaceSnapshot {
  const timestamp = new Date().toISOString()

  return {
    schemaVersion: EMPTY_WORKSPACE_SCHEMA_VERSION,
    connections: [],
    environments: [],
    tabs: [],
    closedTabs: [],
    libraryNodes: [
      {
        id: 'library-root-queries',
        kind: 'folder',
        name: 'Queries',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        summary: 'Workspace library folder.',
      },
      {
        id: 'library-root-scripts',
        kind: 'folder',
        name: 'Scripts',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        summary: 'Workspace library folder.',
      },
      {
        id: 'library-root-tests',
        kind: 'folder',
        name: 'Tests',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        summary: 'Workspace library folder.',
      },
      {
        id: 'library-root-snippets',
        kind: 'folder',
        name: 'Snippets',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        summary: 'Workspace library folder.',
      },
      {
        id: 'library-root-notes',
        kind: 'folder',
        name: 'Notes',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        summary: 'Workspace library folder.',
      },
    ],
    savedWork: [],
    explorerNodes: [],
    adapterManifests,
    preferences: defaultPreferences,
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
