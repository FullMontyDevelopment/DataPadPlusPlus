import type { ResultPayload } from '@datapadplusplus/shared-types'
import { redactSensitiveText } from '../../../state/security-redaction'

export function sanitizePayloadForExport(payload: ResultPayload): ResultPayload {
  if (payload.renderer === 'table') {
    return {
      ...payload,
      rows: payload.rows.map((row) =>
        row.map((cell, index) => sanitizeExportCell(cell, payload.columns[index])),
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
      metadata: sanitizeExportValue(payload.metadata) as Record<string, unknown> | undefined,
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

export function sanitizeExportText(value: string) {
  return redactSensitiveText(value)
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
