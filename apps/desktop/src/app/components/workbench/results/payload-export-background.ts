import type {
  ExecutionResultEnvelope,
  ExportResultFileRequest,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import {
  createResultExportFileMetadata,
  serializePayloadForExport,
  type ResultExportFormat,
  type ResultExportOption,
} from './payload-export-serializers'

export async function payloadToTextInBackground(
  payload: ResultPayload,
  format: ResultExportFormat,
) {
  if (typeof Worker === 'undefined') {
    await yieldToRenderer()
    return serializePayloadForExport(payload, format)
  }

  const worker = new Worker(
    new URL('./payload-export-worker.ts', import.meta.url),
    { type: 'module' },
  )
  try {
    return await new Promise<string>((resolve, reject) => {
      worker.onmessage = (
        event: MessageEvent<{ error?: string; text?: string }>,
      ) => {
        if (event.data.error) {
          reject(new Error(event.data.error))
        } else {
          resolve(event.data.text ?? '')
        }
      }
      worker.onerror = () => reject(new Error('Result formatting worker failed.'))
      worker.postMessage({ format, payload })
    })
  } finally {
    worker.terminate()
  }
}

export async function createResultExportFileInBackground(
  payload: ResultPayload,
  result: ExecutionResultEnvelope | undefined,
  option: ResultExportOption,
): Promise<ExportResultFileRequest> {
  return {
    ...createResultExportFileMetadata(payload, result, option),
    contents: await payloadToTextInBackground(payload, option.format),
  }
}

function yieldToRenderer() {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
}
