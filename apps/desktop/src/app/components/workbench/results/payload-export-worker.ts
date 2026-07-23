import type { ResultPayload } from '@datapadplusplus/shared-types'
import {
  serializePayloadForExport,
  type ResultExportFormat,
} from './payload-export-serializers'

interface ExportWorkerRequest {
  format: ResultExportFormat
  payload: ResultPayload
}

interface ExportWorkerResponse {
  error?: string
  text?: string
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ExportWorkerRequest>) => void) | null
  postMessage(message: ExportWorkerResponse): void
}

workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({
      text: serializePayloadForExport(event.data.payload, event.data.format),
    })
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : 'Result formatting failed.',
    })
  }
}
