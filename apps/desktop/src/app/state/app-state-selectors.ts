import type {
  ConnectionProfile,
  EnvironmentProfile,
  SavedWorkItem,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { createId } from './helpers'
import { redactErrorMessage } from './security-redaction'

export function toUserMessage(error: unknown, fallback: string) {
  return redactErrorMessage(error, fallback)
}

export function toUserError(error: unknown, fallback: string) {
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code.trim()
      : ''

  return {
    code: /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'execution-error',
    message: toUserMessage(error, fallback),
  }
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

export function activeConnectionForSnapshot(
  snapshot: WorkspaceSnapshot,
): ConnectionProfile | undefined {
  return findConnection(snapshot, snapshot.ui.activeConnectionId) ?? snapshot.connections[0]
}

export function activeEnvironmentForSnapshot(
  snapshot: WorkspaceSnapshot,
): EnvironmentProfile | undefined {
  return findEnvironment(snapshot, snapshot.ui.activeEnvironmentId) ?? snapshot.environments[0]
}

export function savedWorkItemForTab(
  snapshot: WorkspaceSnapshot,
  tabId: string,
): SavedWorkItem {
  const tab = snapshot.tabs.find((item) => item.id === tabId)
  const connection = tab
    ? snapshot.connections.find((item) => item.id === tab.connectionId)
    : undefined
  const environment = tab
    ? snapshot.environments.find((item) => item.id === tab.environmentId)
    : undefined

  if (!tab || !connection || !environment) {
    throw new Error('The active query tab cannot be saved yet.')
  }

  const existingSavedWork = tab.savedQueryId
    ? snapshot.savedWork.find((item) => item.id === tab.savedQueryId)
    : undefined

  return {
    id: existingSavedWork?.id ?? tab.savedQueryId ?? createId('saved'),
    kind: 'query',
    name: tab.title,
    summary: `${connection.name} / ${environment.label}`,
    tags:
      existingSavedWork?.tags ??
      [connection.engine, environment.label.toLowerCase()],
    folder: existingSavedWork?.folder ?? 'Queries',
    favorite: existingSavedWork?.favorite ?? false,
    updatedAt: new Date().toISOString(),
    connectionId: connection.id,
    environmentId: environment.id,
    language: tab.language,
    queryText: tab.queryText,
  }
}
