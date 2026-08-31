import type { WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import type { AppAction, StateShape } from './app-state-types'
import { applyConnectionHealth } from './app-state-reducer-helpers'
import type { ConnectionHealth } from './connection-health'
import {
  connectionHealthKey,
  connectionHealthChecking,
  connectionHealthConnected,
  connectionHealthFromTestResult,
  connectionHealthIssue,
} from './connection-health'

type ConnectionHealthAction = Extract<
  AppAction,
  {
    type:
      | 'CONNECTION_HEALTH_CHECKING'
      | 'CONNECTION_HEALTH_SETTLED'
      | 'CONNECTION_HEALTH_READY'
      | 'CONNECTION_HEALTH_CONNECTED'
      | 'CONNECTION_HEALTH_ISSUE'
  }
>

export function reduceConnectionHealth(
  state: StateShape,
  action: ConnectionHealthAction,
): StateShape {
  switch (action.type) {
    case 'CONNECTION_HEALTH_CHECKING': {
      const key = connectionHealthKey(action.connectionId, action.environmentId)
      const previous = state.connectionHealthByKey[key]
      const checking = connectionHealthChecking(
        action.connectionId,
        action.environmentId,
        action.source,
        action.message,
      )
      checking.previous =
        previous?.status === 'checking' ? previous.previous : previous
      return applyConnectionHealth(state, checking)
    }
    case 'CONNECTION_HEALTH_SETTLED': {
      const key = connectionHealthKey(action.connectionId, action.environmentId)
      const current = state.connectionHealthByKey[key]
      if (!current || current.status !== 'checking' || current.source !== action.source) {
        return state
      }
      const connectionHealthByKey = { ...state.connectionHealthByKey }
      if (current.previous) {
        connectionHealthByKey[key] = current.previous
      } else {
        delete connectionHealthByKey[key]
      }
      return {
        ...state,
        connectionHealthByKey,
      }
    }
    case 'CONNECTION_HEALTH_READY': {
      return applyConnectionHealth(
        state,
        connectionHealthFromTestResult(
          action.connectionId,
          action.environmentId,
          action.result,
          action.source,
        ),
      )
    }
    case 'CONNECTION_HEALTH_CONNECTED':
      return applyConnectionHealth(
        state,
        connectionHealthConnected(
          action.connectionId,
          action.environmentId,
          action.source,
          action.message,
          action.durationMs,
        ),
      )
    case 'CONNECTION_HEALTH_ISSUE':
      return applyConnectionHealth(
        state,
        connectionHealthIssue(
          action.connectionId,
          action.environmentId,
          action.source,
          action.message,
          action.warnings,
        ),
      )
  }
}

export function reconcileConnectionHealth(
  current: Record<string, ConnectionHealth>,
  previousSnapshot: WorkspaceSnapshot | undefined,
  nextSnapshot: WorkspaceSnapshot,
) {
  if (!previousSnapshot || Object.keys(current).length === 0) {
    return {}
  }

  const previousConnections = new Map(
    previousSnapshot.connections.map((connection) => [connection.id, connection.updatedAt]),
  )
  const nextConnections = new Map(
    nextSnapshot.connections.map((connection) => [connection.id, connection.updatedAt]),
  )
  const previousEnvironments = new Map(
    previousSnapshot.environments.map((environment) => [environment.id, environment.updatedAt]),
  )
  const nextEnvironments = new Map(
    nextSnapshot.environments.map((environment) => [environment.id, environment.updatedAt]),
  )
  const retained: Record<string, ConnectionHealth> = {}

  for (const [key, health] of Object.entries(current)) {
    const connectionRevision = previousConnections.get(health.connectionId)
    if (
      !connectionRevision ||
      connectionRevision !== nextConnections.get(health.connectionId)
    ) {
      continue
    }

    if (health.environmentId) {
      const environmentRevision = previousEnvironments.get(health.environmentId)
      if (
        !environmentRevision ||
        environmentRevision !== nextEnvironments.get(health.environmentId)
      ) {
        continue
      }
    }

    retained[key] = health
  }

  return retained
}
