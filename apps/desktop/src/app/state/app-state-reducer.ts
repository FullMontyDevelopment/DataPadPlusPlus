import type { AppAction, StateShape } from './app-state-types'
import {
  applyExecutionToPayload,
  applyResultPageToPayload,
  createWorkbenchMessage,
  explorerCacheKey,
  explorerRequestKey,
  markTabExecutionFailed,
  markTabExecutionLoading,
  mergeExplorerCacheEntry,
  openMessagesPayload,
} from './app-state-reducer-helpers'

export const initialState: StateShape = {
  status: 'booting',
  explorerStatus: 'idle',
  explorerLoadingRequests: {},
  structureStatus: 'idle',
  executionStatus: 'idle',
  connectionTests: {},
  workbenchMessages: [],
}

export function reducer(state: StateShape, action: AppAction): StateShape {
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
      return {
        ...state,
        status: 'ready',
        payload: action.payload,
        diagnostics: action.payload.diagnostics,
        executionStatus:
          state.executionStatus === 'loading' ? 'ready' : state.executionStatus,
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
        executionStatus: 'loading',
        payload: markTabExecutionLoading(state.payload, action.tabId),
      }
    case 'EXECUTION_FAILED':
      return {
        ...state,
        executionStatus: state.executionStatus === 'loading' ? 'idle' : state.executionStatus,
        payload: markTabExecutionFailed(state.payload, action.tabId, action.message),
      }
    case 'EXECUTION_READY':
      return {
        ...state,
        executionStatus: 'ready',
        payload: applyExecutionToPayload(state.payload, action.execution),
        lastExecution: action.execution,
        lastExecutionRequest: action.request,
      }
    case 'RESULT_PAGE_READY':
      return {
        ...state,
        payload: applyResultPageToPayload(state.payload, action.page),
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
          state.executionStatus === 'loading' ? 'idle' : state.executionStatus,
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
