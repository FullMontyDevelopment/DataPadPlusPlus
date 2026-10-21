import type {
  ExportResultFileRequest,
  ExportResultFileResponse,
  ResultExportContext,
} from '@datapadplusplus/shared-types'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'
import { loadBrowserSnapshot } from './browser-store'
import { browserResultExportContext } from './browser-result-sessions'

const ALLOWED_RESULT_EXPORT_EXTENSIONS = new Set(['csv', 'json', 'ndjson', 'txt'])

export const clientResultExport = {
  async cancelResultExport(exportId: string): Promise<boolean> {
    return invokeDesktop<boolean>('cancel_result_export', { exportId })
  },
  async getResultExportContext(tabId: string, resultId: string): Promise<ResultExportContext> {
    if (!isTauriRuntime()) {
      const snapshot = loadBrowserSnapshot()
      return browserResultExportContext(snapshot, tabId, resultId)
    }
    return invokeDesktop<ResultExportContext>('result_export_context', { tabId, resultId })
  },
  async exportResultFile(
    request: ExportResultFileRequest,
  ): Promise<ExportResultFileResponse> {
    validateResultExportRequest(request)

    if (isTauriRuntime()) {
      return invokeDesktop<ExportResultFileResponse>('export_result_file', { request })
    }

    if (request.resultReference?.scope === 'full-query') {
      throw new Error('Full-query export requires the desktop application.')
    }
    downloadBrowserResultFile(request)
    if (request.preparedResult) return {
      saved: true,
      exportedRows: request.preparedResult.rowCount,
      limited: request.preparedResult.rowCount < request.preparedResult.sourceRowCount,
    }
    return { saved: true }
  },
}

function validateResultExportRequest(request: ExportResultFileRequest) {
  if (!request.suggestedFileName.trim()) {
    throw new Error('Choose a result export name before saving.')
  }

  if (!ALLOWED_RESULT_EXPORT_EXTENSIONS.has(request.extension)) {
    throw new Error('Choose a supported result export format.')
  }

  if (!request.mimeType.trim()) {
    throw new Error('Result export format is missing its content type.')
  }

  if (
    typeof request.contents !== 'string' &&
    (
      !request.resultReference ||
      !request.resultReference.tabId ||
      !request.resultReference.resultId ||
      !['json', 'ndjson', 'csv'].includes(request.resultReference.format)
    )
  ) {
    throw new Error('Result export content or result reference is invalid.')
  }
}

function downloadBrowserResultFile(request: ExportResultFileRequest) {
  if (typeof request.contents !== 'string') {
    throw new Error('Browser result exports require formatted content.')
  }
  const blob = new Blob([request.contents], { type: request.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = sanitizeExportFileName(
    `${request.suggestedFileName}.${request.extension}`,
  )
  anchor.click()
  URL.revokeObjectURL(url)
}

function sanitizeExportFileName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}
