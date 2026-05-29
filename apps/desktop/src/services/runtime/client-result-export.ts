import type {
  ExportResultFileRequest,
  ExportResultFileResponse,
} from '@datapadplusplus/shared-types'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'

const ALLOWED_RESULT_EXPORT_EXTENSIONS = new Set(['csv', 'json', 'ndjson', 'txt'])

export const clientResultExport = {
  async exportResultFile(
    request: ExportResultFileRequest,
  ): Promise<ExportResultFileResponse> {
    validateResultExportRequest(request)

    if (isTauriRuntime()) {
      return invokeDesktop<ExportResultFileResponse>('export_result_file', { request })
    }

    downloadBrowserResultFile(request)
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

  if (typeof request.contents !== 'string') {
    throw new Error('Result export content is invalid.')
  }
}

function downloadBrowserResultFile(request: ExportResultFileRequest) {
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
