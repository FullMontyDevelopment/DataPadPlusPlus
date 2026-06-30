import type { AppAction, StateShape } from './app-state-types'
import { preserveActiveExecutionsOnPayload } from './app-state-execution-payload'
import {
  applyExecutionToPayload,
  applyResultPageToPayload,
  createWorkbenchMessage,
  explorerCacheKey,
  explorerRequestKey,
  markTabExecutionFailed,
  markTabExecutionDisplayed,
  markTabExecutionPhase,
  markTabExecutionLoading,
  mergeExplorerCacheEntry,
  openMessagesPayload,
} from './app-state-reducer-helpers'
import { reduceConnectionHealth } from './app-state-reducer-connection-health'
import { reduceAppUpdateAction } from './app-state-reducer-updates'

export const initialState: StateShape = {
  status: 'booting',
  explorerStatus: 'idle',
  explorerLoadingRequests: {},
  structureStatus: 'idle',
  executionStatus: 'idle',
  executionsByTab: {},
  latestExecutionsByTab: {},
  connectionTests: {},
  connectionHealthByKey: {},
  workbenchMessages: [],
  appUpdateStatus: 'idle',
  appUpdateInstallStatus: 'idle',
}

export function reducer(state: StateShape, action: AppAction): StateShape {
  const appUpdateState = reduceAppUpdateAction(state, action)
  if (appUpdateState) {
    return appUpdateState
  }

  switch (action.type) {
    case 'BOOTSTRAP_SUCCESS':
      return {
        ...state,
        status: 'ready',
        payload: action.payload,
        diagnostics: action.payload.diagnostics,
        startupErrorMessage: undefined,
      }
    case 'COMMAND_SUCCESS':
    {
      const payload = preserveActiveExecutionsOnPayload(
        action.payload,
        state.payload,
        state.executionsByTab,
      )
      return {
        ...state,
        status: 'ready',
        payload,
        diagnostics: payload.diagnostics,
        executionStatus:
          Object.keys(state.executionsByTab).length > 0 ? 'loading' : 'ready',
      }
    }
    case 'DIAGNOSTICS_READY':
      return {
        ...state,
        diagnostics: action.diagnostics,
      }
    case 'EXPORT_READY':
      return {
        ...state,
        exportBundle: action.exportBundle,
      }
    case 'CONNECTION_TEST_READY':
      return {
        ...state,
        connectionTests: {
          ...state.connectionTests,
          [action.profileId]: action.result,
        },
      }
    case 'CONNECTION_HEALTH_CHECKING':
    case 'CONNECTION_HEALTH_SETTLED':
    case 'CONNECTION_HEALTH_READY':
    case 'CONNECTION_HEALTH_CONNECTED':
    case 'CONNECTION_HEALTH_ISSUE':
      return reduceConnectionHealth(state, action)
    case 'EXPLORER_LOADING':
      return {
        ...state,
        explorerStatus: 'loading',
        explorerLoadingRequests: {
          ...state.explorerLoadingRequests,
          [explorerRequestKey(action.request)]: action.requestId,
        },
        explorerError: undefined,
      }
    case 'EXPLORER_READY': {
      const requestKey = explorerRequestKey(action.explorer)
      if (state.explorerLoadingRequests[requestKey] !== action.requestId) {
        return state
      }
      const cacheKey = explorerCacheKey(
        action.explorer.connectionId,
        action.explorer.environmentId,
      )
      const cacheEntry = mergeExplorerCacheEntry(
        state.explorerCache?.[cacheKey],
        action.explorer,
      )
      const loadingRequests = { ...state.explorerLoadingRequests }
      delete loadingRequests[requestKey]

      return {
        ...state,
        explorerStatus: Object.keys(loadingRequests).length ? 'loading' : 'ready',
        explorer: cacheEntry.response,
        explorerCache: {
          ...(state.explorerCache ?? {}),
          [cacheKey]: cacheEntry,
        },
        explorerLoadingRequests: loadingRequests,
        explorerError: undefined,
      }
    }
    case 'EXPLORER_ERROR': {
      const requestKey = explorerRequestKey(action.request)
      if (
        action.requestId &&
        state.explorerLoadingRequests[requestKey] !== action.requestId
      ) {
        return state
      }
      const loadingRequests = { ...state.explorerLoadingRequests }
      delete loadingRequests[requestKey]

      return {
        ...state,
        explorerStatus: Object.keys(loadingRequests).length ? 'loading' : 'ready',
        explorerLoadingRequests: loadingRequests,
        explorerError: action.message,
      }
    }
    case 'EXPLORER_INSPECTION_READY':
      return {
        ...state,
        explorerInspection: action.inspection,
      }
    case 'STRUCTURE_LOADING':
      return {
        ...state,
        structureStatus: 'loading',
        structureError: undefined,
      }
    case 'STRUCTURE_READY':
      return {
        ...state,
        structureStatus: 'ready',
        structure: action.structure,
        structureError: undefined,
      }
    case 'STRUCTURE_ERROR':
      return {
        ...state,
        structureStatus: 'ready',
        structureError: action.message,
      }
    case 'EXECUTION_LOADING':
      return {
        ...state,
        executionsByTab: action.tabId
          ? {
              ...state.executionsByTab,
              [action.tabId]: action.execution,
            }
          : state.executionsByTab,
        latestExecutionsByTab: action.tabId
          ? {
              ...state.latestExecutionsByTab,
              [action.tabId]: action.execution.executionId,
            }
          : state.latestExecutionsByTab,
        executionStatus: 'loading',
        payload: markTabExecutionLoading(state.payload, action.tabId, action.execution),
      }
    case 'EXECUTION_PHASE':
      return {
        ...state,
        executionsByTab: action.tabId
          ? {
              ...state.executionsByTab,
              [action.tabId]: {
                ...(state.executionsByTab[action.tabId] ?? {
                  executionId: action.executionId,
                  startedAt: new Date().toISOString(),
                }),
                executionId: action.executionId,
                phase: action.phase,
                message: action.message,
              },
            }
          : state.executionsByTab,
        executionStatus: 'loading',
        payload: markTabExecutionPhase(
          state.payload,
          action.tabId,
          action.executionId,
          action.phase,
          action.message,
        ),
      }
    case 'EXECUTION_DISPLAYED': {
      const executionsByTab = { ...state.executionsByTab }
      if (
        action.tabId &&
        executionsByTab[action.tabId]?.executionId === action.executionId
      ) {
        delete executionsByTab[action.tabId]
      }
      return {
        ...state,
        executionsByTab,
        executionStatus: Object.keys(executionsByTab).length ? 'loading' : 'ready',
        payload: markTabExecutionDisplayed(
          state.payload,
          action.tabId,
          action.executionId,
        ),
      }
    }
    case 'EXECUTION_FAILED':
    {
      const executionsByTab = { ...state.executionsByTab }
      if (
        action.tabId &&
        (!action.executionId ||
          executionsByTab[action.tabId]?.executionId === action.executionId)
      ) {
        delete executionsByTab[action.tabId]
      }
      return {
        ...state,
        executionsByTab,
        executionStatus: Object.keys(executionsByTab).length ? 'loading' : 'idle',
        payload: markTabExecutionFailed(
          state.payload,
          action.tabId,
          action.message,
          action.executionId,
        ),
      }
    }
    case 'EXECUTION_READY':
    {
      const tabId = action.execution.tab.id
      const currentExecution = state.executionsByTab[tabId]
      const latestExecutionId = state.latestExecutionsByTab[tabId]
      if (
        (currentExecution && currentExecution.executionId !== action.execution.executionId) ||
        (latestExecutionId && latestExecutionId !== action.execution.executionId)
      ) {
        return state
      }
      const waitForDisplay = Boolean(action.waitForDisplay && action.execution.result)
      const executionsByTab = { ...state.executionsByTab }
      if (waitForDisplay) {
        executionsByTab[tabId] = {
          ...(currentExecution ?? {
            executionId: action.execution.executionId,
            startedAt: new Date().toISOString(),
          }),
          executionId: action.execution.executionId,
          phase: 'rendering',
        }
      } else {
        delete executionsByTab[tabId]
      }
      return {
        ...state,
        executionsByTab,
        executionStatus: Object.keys(executionsByTab).length ? 'loading' : 'ready',
        payload: applyExecutionToPayload(state.payload, action.execution, {
          waitForDisplay,
        }, action.request),
        lastExecution: action.execution,
        lastExecutionRequest: action.request,
      }
    }
    case 'RESULT_PAGE_LOADING':
      return {
        ...state,
        executionsByTab: {
          ...state.executionsByTab,
          [action.tabId]: action.execution,
        },
        latestExecutionsByTab: {
          ...state.latestExecutionsByTab,
          [action.tabId]: action.execution.executionId,
        },
        executionStatus: 'loading',
        payload: markTabExecutionLoading(state.payload, action.tabId, action.execution),
      }
    case 'RESULT_PAGE_READY':
    {
      const tabId = action.page.tabId
      const currentExecution = state.executionsByTab[tabId]
      const latestExecutionId = state.latestExecutionsByTab[tabId]
      if (
        action.executionId &&
        ((currentExecution && currentExecution.executionId !== action.executionId) ||
          (latestExecutionId && latestExecutionId !== action.executionId))
      ) {
        return state
      }
      const waitForDisplay = Boolean(action.waitForDisplay)
      const executionsByTab = { ...state.executionsByTab }
      if (waitForDisplay && action.executionId) {
        executionsByTab[tabId] = {
          ...(currentExecution ?? {
            executionId: action.executionId,
            startedAt: new Date().toISOString(),
          }),
          executionId: action.executionId,
          phase: 'paging',
        }
      } else {
        delete executionsByTab[tabId]
      }
      return {
        ...state,
        executionsByTab,
        executionStatus: Object.keys(executionsByTab).length ? 'loading' : 'ready',
        payload: applyResultPageToPayload(state.payload, action.page, {
          executionId: action.executionId,
          waitForDisplay,
        }),
      }
    }
    case 'BOOTSTRAP_ERROR':
      return {
        ...state,
        status: 'error',
        startupErrorMessage: action.message,
      }
    case 'COMMAND_ERROR':
      return {
        ...state,
        status: state.payload ? 'ready' : 'error',
        payload: openMessagesPayload(state.payload),
        explorerStatus: state.explorerStatus === 'loading' ? 'idle' : state.explorerStatus,
        explorerLoadingRequests: {},
        structureStatus: state.structureStatus === 'loading' ? 'idle' : state.structureStatus,
        executionStatus:
          Object.keys(state.executionsByTab).length > 0 ? 'loading' : state.executionStatus,
        executionsByTab: state.executionsByTab,
        startupErrorMessage: state.payload ? state.startupErrorMessage : action.message,
        workbenchMessages: [
          createWorkbenchMessage(action.message, 'Desktop command'),
          ...state.workbenchMessages,
        ],
      }
    case 'WORKBENCH_MESSAGE_ADDED':
      return {
        ...state,
        payload: openMessagesPayload(state.payload),
        workbenchMessages: [action.message, ...state.workbenchMessages],
      }
    case 'WORKBENCH_MESSAGES_OPENED':
      return {
        ...state,
        payload: openMessagesPayload(state.payload),
      }
    case 'WORKBENCH_MESSAGE_DISMISSED':
      return {
        ...state,
        workbenchMessages: state.workbenchMessages.filter(
          (message) => message.id !== action.id,
        ),
      }
    case 'WORKBENCH_MESSAGES_CLEARED':
      return {
        ...state,
        workbenchMessages: [],
      }
    default:
      return state
  }
}
