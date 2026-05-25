import type { ExecutionResultEnvelope, ResultPayload } from '@datapadplusplus/shared-types'
import { redactSensitiveText } from '../../../state/security-redaction'

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
  const serialized = payloadToText(payload)
  const { extension, mimeType } = exportDetailsForPayload(payload)
  const filename = sanitizeFilename(
    `${result?.engine ?? 'datapadplusplus'}-${payload.renderer}-${result?.executedAt ?? 'result'}.${extension}`,
  )
  const blob = new Blob([serialized], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function payloadToText(payload: ResultPayload) {
  const safePayload = sanitizePayloadForExport(payload)

  if (safePayload.renderer === 'table') {
    return tableToCsv(safePayload.columns, safePayload.rows)
  }

  if (safePayload.renderer === 'raw' || safePayload.renderer === 'resp') {
    return safePayload.text
  }

  if (safePayload.renderer === 'document') {
    return JSON.stringify(safePayload.documents, null, 2)
  }

  if (safePayload.renderer === 'json') {
    return JSON.stringify(safePayload.value, null, 2)
  }

  if (safePayload.renderer === 'keyvalue') {
    return JSON.stringify(
      {
        entries: safePayload.entries,
        ttl: safePayload.ttl,
        memoryUsage: safePayload.memoryUsage,
      },
      null,
      2,
    )
  }

  if (safePayload.renderer === 'schema') {
    return JSON.stringify(safePayload.items, null, 2)
  }

  return JSON.stringify(safePayload, null, 2)
}

export function sanitizePayloadForExport(payload: ResultPayload): ResultPayload {
  if (payload.renderer === 'table') {
    return {
      ...payload,
      rows: payload.rows.map((row) =>
        row.map((cell, index) =>
          sanitizeExportCell(cell, payload.columns[index]),
        ),
      ),
    }
  }

  if (payload.renderer === 'raw' || payload.renderer === 'resp') {
    return {
      ...payload,
      text: sanitizeExportText(payload.text),
    }
  }

  if (payload.renderer === 'document') {
    return {
      ...payload,
      documents: payload.documents.map((document) =>
        sanitizeExportValue(document) as Record<string, unknown>,
      ),
    }
  }

  if (payload.renderer === 'json') {
    return {
      ...payload,
      value: sanitizeExportValue(payload.value),
    }
  }

  if (payload.renderer === 'keyvalue') {
    return {
      ...payload,
      entries: sanitizeKeyValueEntries(payload.entries),
      value: sanitizeExportValue(payload.value, payload.key),
      members: payload.members?.map((member) =>
        sanitizeExportValue(member) as Record<string, unknown>,
      ),
      metadata: sanitizeExportValue(payload.metadata) as
        | Record<string, unknown>
        | undefined,
      disabledActions: sanitizeExportValue(payload.disabledActions) as
        | Record<string, string>
        | undefined,
      moduleMetadata: sanitizeExportValue(payload.moduleMetadata) as
        | Record<string, unknown>
        | undefined,
    }
  }

  if (payload.renderer === 'schema') {
    return {
      ...payload,
      items: payload.items.map((item) => ({
        label: item.label,
        detail: sanitizeExportText(item.detail),
      })),
    }
  }

  return sanitizeExportValue(payload) as ResultPayload
}

function sanitizeKeyValueEntries(entries: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      key,
      sanitizeExportCell(value, key),
    ]),
  )
}

function sanitizeExportCell(value: string, keyHint?: string) {
  const sanitized = sanitizeExportValue(value, keyHint)
  return typeof sanitized === 'string' ? sanitized : String(sanitized)
}

function sanitizeExportValue(value: unknown, keyHint?: string): unknown {
  if (keyHint && isSensitiveFieldName(keyHint) && isRedactableSecretValue(value)) {
    return SECRET_REPLACEMENT
  }

  if (typeof value === 'string') {
    return sanitizeExportText(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeExportValue(item, keyHint))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        sanitizeExportValue(entryValue, key),
      ]),
    )
  }

  return value
}

function isRedactableSecretValue(value: unknown) {
  return value === null || typeof value !== 'object'
}

export function sanitizeExportText(value: string) {
  return redactSensitiveText(value)
}

function tableToCsv(columns: string[], rows: string[][]) {
  return [columns, ...rows]
    .map((row) => row.map((cell) => csvEscape(cell)).join(','))
    .join('\n')
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }

  return value
}

function exportDetailsForPayload(payload: ResultPayload) {
  if (payload.renderer === 'table') {
    return { extension: 'csv', mimeType: 'text/csv;charset=utf-8' }
  }

  if (payload.renderer === 'raw' || payload.renderer === 'resp') {
    return { extension: 'txt', mimeType: 'text/plain;charset=utf-8' }
  }

  return { extension: 'json', mimeType: 'application/json;charset=utf-8' }
}

function sanitizeFilename(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-')
}

const SECRET_REPLACEMENT = '********'

const SENSITIVE_FIELD_NAMES = new Set([
  'apikey',
  'authkey',
  'authtoken',
  'accesstoken',
  'pass',
  'password',
  'privatekey',
  'pwd',
  'secret',
  'secretkey',
  'sharedaccesskey',
  'token',
])

function isSensitiveFieldName(value: string) {
  const normalized = value.replaceAll(/[^a-z0-9]+/gi, '').toLowerCase()
  return (
    SENSITIVE_FIELD_NAMES.has(normalized) ||
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('authkey') ||
    normalized.includes('privatekey')
  )
}
