import type { AppAction, StateShape } from './app-state-types'
import { applyConnectionHealth } from './app-state-reducer-helpers'
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
        action.checkId,
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
      if (action.checkId && current.checkId !== action.checkId) {
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
      if (action.checkId) {
        const key = connectionHealthKey(action.connectionId, action.environmentId)
        const current = state.connectionHealthByKey[key]
        if (
          current?.status !== 'checking' ||
          current.source !== action.source ||
          current.checkId !== action.checkId
        ) {
          return state
        }
      }
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
