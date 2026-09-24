import catalog from './connection-editor-catalog.json'
import type { ConnectionMode, ConnectionProfile, DatastoreEngine } from './connection'

export type ConnectionEditorSection = 'general' | 'authentication' | 'tls' | 'advanced'
export interface ConnectionEditorField {
  path: string
  label: string
  section: ConnectionEditorSection
  kind: 'text' | 'integer' | 'boolean' | 'select' | 'list' | 'file' | 'secret'
  values?: string[]
  help?: string
  defaultDescription: string
}
export interface ConnectionEditorCapability {
  methods: ConnectionMode[]
  credentials: boolean
  username?: boolean
  credentialLabel?: string
  fields: ConnectionEditorField[]
  limitations: string[]
  status?: 'local-only'
  local?: { extension: string; starter: boolean }
}
export const CONNECTION_EDITOR_CATALOG = catalog as Record<DatastoreEngine, ConnectionEditorCapability>
export interface ConnectionSecretMutation { slot: string; action: 'replace' | 'remove'; value?: string }
export interface ConnectionEditorSaveRequest {
  profile: ConnectionProfile
  expectedUpdatedAt?: string
  workspaceRevision: number
  secrets: ConnectionSecretMutation[]
}
export interface ConnectionSecretRevealRequest {
  connectionId: string
  expectedUpdatedAt: string
  workspaceRevision: number
  slot: string
  confirmed: boolean
}
export interface ConnectionFieldError { path: string; message: string }

export function connectionFieldValue(profile: ConnectionProfile, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, profile)
}

/** Only catalogue-owned shallow paths are accepted; never evaluate arbitrary property paths. */
export function setConnectionField(profile: ConnectionProfile, path: string, value: unknown): ConnectionProfile {
  const keys = path.split('.')
  const generalFields = ['name', 'host', 'port', 'database', 'connectionMode', 'environmentIds', 'readOnly', 'favorite', 'auth.username']
  const field = CONNECTION_EDITOR_CATALOG[profile.engine]?.fields.find(item => item.path === path && item.kind !== 'secret')
  if ((!generalFields.includes(path) && !field) || keys.length > 2 || keys.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) {
    throw new Error('Unsupported connection field.')
  }
  const [root, child] = keys
  if (!root) throw new Error('Connection field is required.')
  return child
    ? { ...profile, [root]: { ...(connectionFieldValue(profile, root) as object | undefined), [child]: value } }
    : { ...profile, [root]: value }
}

export function validateConnectionEditor(profile: ConnectionProfile): ConnectionFieldError[] {
  const errors: ConnectionFieldError[] = []
  const capability = CONNECTION_EDITOR_CATALOG[profile.engine]
  if (!profile.name.trim()) errors.push({ path: 'name', message: 'Enter a connection name.' })
  const usesPort = profile.connectionMode !== 'connection-string' && profile.connectionMode !== 'local-file'
    && !(profile.engine === 'mongodb' && profile.mongodbOptions?.connectionScheme === 'mongodb+srv')
  if (usesPort && profile.port !== undefined && (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535)) {
    errors.push({ path: 'port', message: 'Enter a port between 1 and 65535.' })
  }
  if (!capability) return [...errors, { path: 'engine', message: 'Unsupported datastore.' }]
  if (!capability.methods.includes(profile.connectionMode ?? 'native')) errors.push({ path: 'connectionMode', message: 'Choose a supported connection method for this datastore.' })
  if (profile.connectionMode === 'connection-string') return errors
  for (const field of capability.fields) {
    const value = connectionFieldValue(profile, field.path)
    if (value === undefined || value === null || value === '') continue
    if (field.kind === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 && field.path !== 'sqliteOptions.cacheSize')) {
      errors.push({ path: field.path, message: 'Enter a non-negative whole number.' })
    }
    if (field.kind === 'select' && !field.values?.includes(String(value))) {
      errors.push({ path: field.path, message: 'This saved option is unavailable in the current runtime.' })
    }
  }
  if (profile.engine === 'mongodb' && profile.mongodbOptions) {
    const options = profile.mongodbOptions
    if (options.directConnection && (options.connectionScheme === 'mongodb+srv' || profile.host.includes(','))) {
      errors.push({ path: 'mongodbOptions.directConnection', message: 'Direct connection requires one standard MongoDB host, without SRV discovery.' })
    }
    for (const key of ['minPoolSize', 'maxPoolSize'] as const) {
      if (typeof options[key] === 'number' && options[key] > 4_294_967_295) {
        errors.push({ path: 'mongodbOptions.' + key, message: 'Pool size must be at most 4294967295.' })
      }
    }
    if (options.maxPoolSize && options.minPoolSize !== undefined && options.minPoolSize > options.maxPoolSize) {
      errors.push({ path: 'mongodbOptions.minPoolSize', message: 'Minimum pool size cannot exceed the maximum pool size.' })
    }
    if (options.tls === false && (options.tlsCaFile || options.tlsCertificateKeyFile)) {
      errors.push({ path: 'mongodbOptions.tls', message: 'Enable TLS or remove the certificate file paths.' })
    }
  }
  return errors
}
