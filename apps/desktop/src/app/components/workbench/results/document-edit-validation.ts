import type {
  ConnectionProfile,
  DocumentEditMetadata,
} from '@datapadplusplus/shared-types'
import { isDocumentLazyNode } from './document-grid-model'
import { isObjectRecord, valueAtPath } from './document-path-edits'

const UNSAFE_FIELD_NAMES = new Set(['__proto__', 'constructor', 'prototype'])
const TIMEZONE_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i
const DECIMAL_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const BSON_NONFINITE_PATTERN = /^(?:NaN|-?Infinity)$/

export function protectedDocumentPaths(
  connection?: ConnectionProfile,
  metadata?: DocumentEditMetadata,
) {
  if (metadata?.protectedPaths.length) {
    return metadata.protectedPaths
  }

  switch (connection?.engine) {
    case 'cosmosdb':
      return [['id'], ['_etag'], ['_rid'], ['_self'], ['_attachments'], ['_ts']]
    case 'arango':
      return [['_id'], ['_key'], ['_rev'], ['_from'], ['_to']]
    case 'mongodb':
    case 'litedb':
      return [['_id']]
    default:
      return []
  }
}

export function validateDocumentFieldName({
  fieldName,
  parent,
  parentPath,
  protectedPaths,
}: {
  fieldName: string
  parent: unknown
  parentPath: Array<string | number>
  protectedPaths: string[][]
}) {
  const name = fieldName.trim()
  if (!name) {
    return 'Field name is required.'
  }
  if (name.includes('.')) {
    return 'Field names containing dots are not safe for guarded document edits.'
  }
  if (name.startsWith('$')) {
    return 'Field names beginning with $ are reserved by document datastores.'
  }
  if (UNSAFE_FIELD_NAMES.has(name)) {
    return `Field name ${name} is reserved by the application runtime.`
  }
  if (!isObjectRecord(parent)) {
    return 'Fields can only be added to JSON objects.'
  }
  if (Object.hasOwn(parent, name)) {
    return `Field ${name} already exists.`
  }
  if (isProtectedDocumentPath([...parentPath, name], protectedPaths)) {
    return `Field ${name} is protected by the datastore.`
  }
  return undefined
}

export function isProtectedDocumentPath(
  path: Array<string | number>,
  protectedPaths: string[][],
) {
  const normalized = path.map(String)
  return protectedPaths.some(
    (protectedPath) =>
      protectedPath.length <= normalized.length &&
      protectedPath.every((segment, index) => normalized[index] === segment),
  )
}

export function rawDocumentValidationErrors({
  beforeDocument,
  nextDocument,
  metadata,
  protectedPaths,
}: {
  beforeDocument: Record<string, unknown>
  nextDocument: Record<string, unknown>
  metadata?: DocumentEditMetadata
  protectedPaths: string[][]
}) {
  const errors: string[] = []
  if (containsUnavailableValue(nextDocument)) {
    errors.push('Lazy, summarized, or truncated values must be hydrated before saving.')
  }

  for (const path of protectedPaths) {
    if (!jsonValuesEqual(valueAtPath(beforeDocument, path), valueAtPath(nextDocument, path))) {
      errors.push(`Protected field ${path.join('.')} cannot be changed.`)
    }
  }

  if (metadata?.maxDocumentBytes) {
    const bytes = new TextEncoder().encode(JSON.stringify(nextDocument)).byteLength
    if (bytes > metadata.maxDocumentBytes) {
      errors.push(
        `Document is ${bytes.toLocaleString()} bytes; the configured limit is ${metadata.maxDocumentBytes.toLocaleString()} bytes.`,
      )
    }
  }

  if (metadata?.adapterStrategy === 'mongodb' || metadata?.adapterStrategy === 'litedb') {
    validateExtendedJson(nextDocument, metadata.adapterStrategy, '$', errors)
  }

  return errors
}

export function containsUnavailableValue(value: unknown): boolean {
  if (isDocumentLazyNode(value)) {
    return true
  }
  if (Array.isArray(value)) {
    return value.some(containsUnavailableValue)
  }
  if (!isObjectRecord(value)) {
    return false
  }
  if (value.__datapadTruncated === true || value.__datapadUnsupported === true) {
    return true
  }
  return Object.values(value).some(containsUnavailableValue)
}

function validateExtendedJson(
  value: unknown,
  strategy: 'mongodb' | 'litedb',
  path: string,
  errors: string[],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateExtendedJson(item, strategy, `${path}[${index}]`, errors))
    return
  }
  if (!isObjectRecord(value)) {
    return
  }

  const keys = Object.keys(value)
  if (keys.length === 1 && keys[0]?.startsWith('$')) {
    const key = keys[0]
    const scalarError = validateExtendedJsonScalar(key, value[key], strategy)
    if (scalarError) {
      errors.push(`${path}: ${scalarError}`)
    }
    return
  }

  Object.entries(value).forEach(([key, item]) =>
    validateExtendedJson(item, strategy, `${path}.${key}`, errors),
  )
}

function validateExtendedJsonScalar(
  key: string,
  value: unknown,
  strategy: 'mongodb' | 'litedb',
) {
  if (key === '$oid') {
    return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)
      ? undefined
      : '$oid must contain 24 hexadecimal characters.'
  }
  if (key === '$uuid' || key === '$guid') {
    if (key === '$uuid' && strategy !== 'mongodb') return '$uuid is not a LiteDB native value.'
    if (key === '$guid' && strategy !== 'litedb') return '$guid is not a MongoDB native value.'
    return typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
      ? undefined
      : `${key} must use canonical UUID notation.`
  }
  if (key === '$date') {
    if (typeof value === 'string') {
      return TIMEZONE_ISO_PATTERN.test(value) && Number.isFinite(new Date(value).getTime())
        ? undefined
        : '$date must contain a timezone-bearing ISO date.'
    }
    return strategy === 'mongodb' && isObjectRecord(value) && typeof value.$numberLong === 'string' && /^-?\d+$/.test(value.$numberLong)
      ? undefined
      : '$date must contain an ISO string or MongoDB $numberLong wrapper.'
  }
  if (key === '$numberLong' || key === '$numberInt') {
    return typeof value === 'string' && /^-?\d+$/.test(value) ? undefined : `${key} must contain an integer string.`
  }
  if (key === '$numberDouble' || key === '$numberDecimal') {
    return typeof value === 'string' && (DECIMAL_PATTERN.test(value) || BSON_NONFINITE_PATTERN.test(value))
      ? undefined
      : `${key} must contain a canonical numeric string.`
  }
  if (key === '$binary') {
    if (strategy === 'litedb') {
      return typeof value === 'string' && isBase64(value) ? undefined : '$binary must contain Base64 text.'
    }
    return isObjectRecord(value) && typeof value.base64 === 'string' && isBase64(value.base64) && typeof value.subType === 'string' && /^[a-f\d]{2}$/i.test(value.subType)
      ? undefined
      : '$binary must contain canonical Base64 and a two-digit subtype.'
  }
  if (strategy === 'mongodb' && key === '$regularExpression') {
    return isObjectRecord(value) &&
      typeof value.pattern === 'string' &&
      typeof value.options === 'string'
      ? undefined
      : '$regularExpression must contain string pattern and options fields.'
  }
  if (strategy === 'mongodb' && key === '$timestamp') {
    return isObjectRecord(value) && isUint32(value.t) && isUint32(value.i)
      ? undefined
      : '$timestamp must contain unsigned 32-bit integer t and i fields.'
  }
  if (strategy === 'mongodb' && (key === '$minKey' || key === '$maxKey')) {
    return value === 1 ? undefined : `${key} must contain the number 1.`
  }
  return `Unsupported native Extended JSON wrapper ${key}.`
}

function isBase64(value: string) {
  return value.length % 4 === 0 && /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(value)
}

function isUint32(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4_294_967_295
}

function jsonValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}
