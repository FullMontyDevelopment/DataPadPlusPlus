import type {
  ConnectionProfile,
  MemcachedAuthMode,
  MemcachedProtocol,
  SecretRef,
} from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from './request-validation-core'

const PROTOCOLS = new Set<MemcachedProtocol>(['text', 'binary'])
const AUTH_MODES = new Set<MemcachedAuthMode>(['none', 'sasl-plain'])

export function validateMemcachedConnectionOptions(
  options: ConnectionProfile['memcachedOptions'] | null | undefined,
): ConnectionProfile['memcachedOptions'] {
  if (options === undefined || options === null) {
    return undefined
  }
  if (typeof options !== 'object') {
    throw new Error('Memcached connection options must be an object.')
  }

  return {
    servers: serverList(options.servers),
    protocol: enumValue(options.protocol, PROTOCOLS, 'Memcached protocol'),
    authMode: enumValue(options.authMode, AUTH_MODES, 'Memcached auth mode'),
    username: text(options.username, 'Memcached username', MAX_OBJECT_NAME_LENGTH),
    saslPasswordSecretRef: options.saslPasswordSecretRef
      ? validateSecretRef(options.saslPasswordSecretRef, 'Memcached SASL password')
      : undefined,
    namespacePrefix: text(
      options.namespacePrefix,
      'Memcached namespace prefix',
      MAX_OBJECT_NAME_LENGTH,
    ),
    defaultTtlSeconds: integer(
      options.defaultTtlSeconds,
      'Memcached default TTL',
      0,
      60 * 60 * 24 * 30,
    ),
    connectTimeoutMs: integer(
      options.connectTimeoutMs,
      'Memcached connection timeout',
      1,
      900_000,
    ),
    requestTimeoutMs: integer(
      options.requestTimeoutMs,
      'Memcached request timeout',
      1,
      900_000,
    ),
    tcpNoDelay: bool(options.tcpNoDelay, 'Memcached TCP no-delay flag'),
    keepAlive: bool(options.keepAlive, 'Memcached keep-alive flag'),
    enableCompression: bool(options.enableCompression, 'Memcached compression flag'),
    lruCrawlerEnabled: bool(options.lruCrawlerEnabled, 'Memcached LRU crawler flag'),
    flushDelaySeconds: integer(
      options.flushDelaySeconds,
      'Memcached flush delay',
      0,
      60 * 60 * 24,
    ),
    readOnlyMode: bool(options.readOnlyMode, 'Memcached read-only mode flag'),
    maxValueBytes: integer(options.maxValueBytes, 'Memcached max value bytes', 1, 1024 * 1024 * 128),
  }
}

function validateSecretRef(secretRef: SecretRef, label: string): SecretRef {
  if (!secretRef || typeof secretRef !== 'object') {
    throw new Error(`${label} must be a stored credential reference.`)
  }
  validateRequiredId(secretRef.id, `${label} id`)
  validateRequiredText(secretRef.provider, `${label} provider`, 80)
  validateRequiredText(secretRef.service, `${label} service`, MAX_OBJECT_NAME_LENGTH)
  validateRequiredText(secretRef.account, `${label} account`, MAX_OBJECT_NAME_LENGTH)
  validateRequiredText(secretRef.label, `${label} label`, MAX_OBJECT_NAME_LENGTH)
  return secretRef
}

function enumValue<T extends string>(value: T | undefined, allowed: Set<T>, label: string) {
  const normalized = validateOptionalText(value, label, MAX_OBJECT_NAME_LENGTH)?.trim()
  if (normalized && !allowed.has(normalized as T)) {
    throw new Error(`Unsupported ${label}: ${normalized}.`)
  }
  return (normalized as T) || undefined
}

function text(value: string | undefined, label: string, maxLength: number) {
  return validateOptionalText(value, label, maxLength)?.trim() || undefined
}

function serverList(values: string[] | undefined) {
  if (values === undefined) {
    return undefined
  }
  if (!Array.isArray(values)) {
    throw new Error('Memcached server list must be an array.')
  }
  if (values.length > 32) {
    throw new Error('Memcached server list may include at most 32 entries.')
  }
  return values
    .map((value) => text(value, 'Memcached server', MAX_SCOPE_LENGTH))
    .filter((value): value is string => Boolean(value))
}

function bool(value: boolean | undefined, label: string) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be true or false.`)
  }
  return value
}

function integer(value: number | undefined, label: string, min: number, max: number) {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`)
  }
  return value
}
