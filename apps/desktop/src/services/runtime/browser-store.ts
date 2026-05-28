import type { BootstrapPayload, ConnectionProfile, EnvironmentProfile, ExecutionCapabilities, QueryTabState, UpdateUiStateRequest, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createBlankBootstrapPayload, createBrowserPreviewHealth, createDiagnosticsReport } from '../../app/data/workspace-factory'
import { sanitizeEnvironmentProfile } from '../../app/state/environment-variables'
import { defaultRowLimitForConnection, editorLanguageForConnection, migrateWorkspaceSnapshot, resolveEnvironment } from '../../app/state/helpers'
import { connectionStringContainsPlainSecret } from '../../app/state/security-redaction'

const STORAGE_KEY = 'datapadplusplus.workspace.v2'

export function loadBrowserSnapshot(): WorkspaceSnapshot {
  const stored =
    typeof window !== 'undefined'
      ? window.localStorage.getItem(STORAGE_KEY)
      : null

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
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(sanitizeBrowserSnapshot(migrateWorkspaceSnapshot(snapshot))),
    )
  }
}

function sanitizeBrowserSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const sanitized = cloneSnapshot(snapshot)
  sanitized.environments = sanitized.environments.map(sanitizeEnvironmentProfile)
  sanitized.connections = sanitized.connections.map((connection) => {
    if (!connection.connectionString || !connectionStringContainsPlainSecret(connection.connectionString)) {
      return connection
    }

    return {
      ...connection,
      connectionString: undefined,
    }
  })
  return sanitized
}

export function cloneSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WorkspaceSnapshot
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
    ...patch,
  }
  next.updatedAt = new Date().toISOString()
  return migrateWorkspaceSnapshot(next)
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
  return (
    snapshot.connections.find((item) => item.id === connectionId) ??
    snapshot.connections[0]
  )
}



export function findEnvironment(
  snapshot: WorkspaceSnapshot,
  environmentId: string,
): EnvironmentProfile | undefined {
  return (
    snapshot.environments.find((item) => item.id === environmentId) ??
    snapshot.environments[0]
  )
}



export function findTab(
  snapshot: WorkspaceSnapshot,
  tabId: string,
): QueryTabState | undefined {
  return snapshot.tabs.find((item) => item.id === tabId) ?? snapshot.tabs[0]
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
