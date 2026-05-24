import type { ExecutionRequest, ExecutionResponse, LocalDatabaseCreateRequest, LocalDatabaseCreateResult, LocalDatabasePickRequest, LocalDatabasePickResult, ResultPageRequest, ResultPageResponse } from '@datapadplusplus/shared-types'
import { applyExecutionRequestLocally } from './browser-execution'
import { fetchResultPageLocally } from './browser-structure'
import { findConnection, findTab, loadBrowserSnapshot, saveBrowserSnapshot } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'
import {
  validateCancelExecutionRequest,
  validateExecutionRequest,
  validateResultPageRequest,
} from './request-validation'

export const clientExecution = {
  async executeQuery(request: ExecutionRequest): Promise<ExecutionResponse> {
    request = validateExecutionRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<ExecutionResponse>('execute_query_request', { request })
    }

    const { snapshot, response } = applyExecutionRequestLocally(
      loadBrowserSnapshot(),
      request,
    )
    saveBrowserSnapshot(snapshot)
    return response
  },

  async fetchResultPage(request: ResultPageRequest): Promise<ResultPageResponse> {
    request = validateResultPageRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<ResultPageResponse>('fetch_result_page', { request })
    }

    return fetchResultPageLocally(loadBrowserSnapshot(), request)
  },

  async cancelExecution(
    request: { executionId: string; tabId?: string },
  ): Promise<{ ok: boolean; supported: boolean; message: string }> {
    request = validateCancelExecutionRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop('cancel_execution_request', { request })
    }

    const snapshot = loadBrowserSnapshot()
    const tab = request.tabId ? findTab(snapshot, request.tabId) : undefined
    const engine = tab
      ? findConnection(snapshot, tab.connectionId)?.engine
      : undefined
    const supported = engine === 'postgresql' || engine === 'sqlserver'

    return {
      ok: supported,
      supported,
      message: supported
        ? 'Preview mode has no long-running execution to cancel right now.'
        : 'Cancellation is not supported for this adapter in preview mode.',
    }
  },

  async pickLocalDatabaseFile(
    request: LocalDatabasePickRequest,
  ): Promise<LocalDatabasePickResult> {
    if (isTauriRuntime()) {
      return invokeDesktop<LocalDatabasePickResult>('pick_local_database_file', { request })
    }

    const extension = localDatabaseExtension(request.engine)

    if (!extension) {
      return { canceled: true }
    }

    const filename =
      request.purpose === 'create'
        ? undefined
        : `datapadplusplus-preview-existing.${extension}`

    return {
      canceled: false,
      path: filename
        ? `C:\\Users\\gmont\\DataPad++\\${filename}`
        : 'C:\\Users\\gmont\\DataPad++',
    }
  },

  async createLocalDatabase(
    request: LocalDatabaseCreateRequest,
  ): Promise<LocalDatabaseCreateResult> {
    if (isTauriRuntime()) {
      return invokeDesktop<LocalDatabaseCreateResult>('create_local_database', { request })
    }

    return {
      engine: request.engine,
      path: request.path,
      message: previewLocalDatabaseMessage(request),
      warnings: request.engine === 'litedb'
        ? [
            'LiteDB file was prepared. The .NET LiteDB sidecar will initialize database pages when live file access is enabled.',
          ]
        : [],
    }
  },
}

function localDatabaseExtension(engine: LocalDatabasePickRequest['engine']) {
  switch (engine) {
    case 'sqlite':
      return 'sqlite'
    case 'duckdb':
      return 'duckdb'
    case 'litedb':
      return 'db'
    default:
      return undefined
  }
}

function previewLocalDatabaseMessage(request: LocalDatabaseCreateRequest) {
  const label = request.engine === 'duckdb'
    ? 'DuckDB'
    : request.engine === 'litedb'
      ? 'LiteDB'
      : 'SQLite'

  return request.mode === 'starter'
    ? `Preview ${label} starter database prepared.`
    : `Preview ${label} empty database prepared.`
}
