import type { DocumentNodeChildrenRequest, DocumentNodeChildrenResponse, ExecutionRequest, ExecutionResponse, LocalDatabaseCreateRequest, LocalDatabaseCreateResult, LocalDatabasePickRequest, LocalDatabasePickResult, MaterializeResultRendererRequest, MaterializeResultRendererResponse, ResultPageRequest, ResultPageResponse } from '@datapadplusplus/shared-types'
import { applyExecutionRequestLocally, fetchDocumentNodeChildrenLocally } from './browser-execution'
import { fetchResultPageLocally } from './browser-structure'
import { findConnection, findTab, loadBrowserSnapshot, saveBrowserSnapshot } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'
import { projectDeferredResultPayload } from './result-materialization'
import {
  validateCancelExecutionRequest,
  validateDocumentNodeChildrenRequest,
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

  async materializeResultRenderer(
    request: MaterializeResultRendererRequest,
  ): Promise<MaterializeResultRendererResponse> {
    if (isTauriRuntime()) {
      return invokeDesktop<MaterializeResultRendererResponse>(
        'materialize_result_renderer',
        { request },
      )
    }

    await yieldToBrowser()
    const tab = findTab(loadBrowserSnapshot(), request.tabId)
    const result = tab?.result
    if (!result || result.id !== request.resultId) {
      throw new Error('The result changed before this view could be prepared.')
    }
    const payload = projectDeferredResultPayload(result, request.renderer)
    if (!payload) {
      throw new Error(`The ${request.renderer} renderer is unavailable for this result.`)
    }

    return {
      tabId: request.tabId,
      resultId: request.resultId,
      renderer: request.renderer,
      payload,
    }
  },

  async fetchDocumentNodeChildren(
    request: DocumentNodeChildrenRequest,
  ): Promise<DocumentNodeChildrenResponse> {
    request = validateDocumentNodeChildrenRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<DocumentNodeChildrenResponse>('fetch_document_node_children', { request })
    }

    return fetchDocumentNodeChildrenLocally(loadBrowserSnapshot(), request)
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
    const supported = engine === 'postgresql' || engine === 'sqlserver' || engine === 'mongodb'

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

    return { canceled: true }
  },

  async createLocalDatabase(
    request: LocalDatabaseCreateRequest,
  ): Promise<LocalDatabaseCreateResult> {
    if (isTauriRuntime()) {
      return invokeDesktop<LocalDatabaseCreateResult>('create_local_database', { request })
    }

    throw new Error('Local database creation requires the desktop application. Browser preview did not create a file.')
  },
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}
