import type { ExecutionResultEnvelope, ResultPayload } from '@datapadplusplus/shared-types'
import {
  createResultExportFile,
  defaultExportOptionForPayload,
} from './payload-export-serializers'
import { sanitizeExportText } from './payload-export-sanitizers'

export {
  createResultExportFile,
  defaultExportOptionForPayload,
  exportOptionsForPayload,
  payloadToText,
  serializePayloadForExport,
  type ResultExportFormat,
  type ResultExportOption,
} from './payload-export-serializers'
export { sanitizePayloadForExport, sanitizeExportText } from './payload-export-sanitizers'

export async function copyText(value: string) {
  const safeValue = sanitizeExportText(value)

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(safeValue)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = safeValue
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

export function exportPayload(payload: ResultPayload, result?: ExecutionResultEnvelope) {
  downloadExportFile(
    createResultExportFile(payload, result, defaultExportOptionForPayload(payload)),
  )
}

function downloadExportFile(file: {
  suggestedFileName: string
  extension: string
  mimeType: string
  contents: string
}) {
  const blob = new Blob([file.contents], { type: file.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = sanitizeFilename(`${file.suggestedFileName}.${file.extension}`)
  anchor.click()
  URL.revokeObjectURL(url)
}

function sanitizeFilename(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}
