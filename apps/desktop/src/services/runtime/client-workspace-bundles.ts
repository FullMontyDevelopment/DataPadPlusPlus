import type {
  ExportBundle,
  WorkspaceBackupSummary,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { getWorkspaceBundlePassphraseBlockReason } from '../../app/security/workspace-passphrase'
import { decodeBase64, hashPassphrase } from './browser-store'
import { parseBrowserWorkspacePayload } from './client-workspace-integrity'

const MAX_WORKSPACE_BUNDLE_BYTES = 25 * 1024 * 1024
const EXPORT_KDF = 'pbkdf2-sha256'
const EXPORT_KDF_ITERATIONS = 210_000
const SHORT_DESKTOP_PASSPHRASE_COMPAT_PREFIX =
  'datapadplusplus-workspace-backup-short-passphrase-v2:'

export function validateWorkspaceBundlePassphrase(passphrase: string) {
  const blockReason = getWorkspaceBundlePassphraseBlockReason(passphrase)

  if (blockReason) {
    throw new Error(blockReason)
  }
}

export function toDesktopWorkspaceBundlePassphrase(passphrase: string) {
  const trimmedLength = passphrase.trim().length

  if (trimmedLength > 0 && trimmedLength < 8) {
    return `${SHORT_DESKTOP_PASSPHRASE_COMPAT_PREFIX}${passphrase}`
  }

  return passphrase
}

export function validateWorkspaceBundlePayload(encryptedPayload: string) {
  if (!encryptedPayload.trim()) {
    throw new Error('Choose a workspace bundle before importing.')
  }

  if (encryptedPayload.length > MAX_WORKSPACE_BUNDLE_BYTES) {
    throw new Error('Workspace bundle is too large to import safely.')
  }
}

export function extractBrowserWorkspaceSnapshot(value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    'snapshot' in value &&
    (value as { snapshot?: unknown }).snapshot
  ) {
    return (value as { snapshot: WorkspaceSnapshot }).snapshot
  }

  return value as WorkspaceSnapshot
}

export function downloadBrowserWorkspaceBundle(bundle: ExportBundle) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `datapadplusplus-workspace-${new Date()
    .toISOString()
    .slice(0, 10)}.datapadpp-workspace`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function pickBrowserWorkspaceBundleFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.datapadpp-workspace,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error('Choose a workspace bundle before importing.'))
        return
      }
      void file.text().then(resolve, reject)
    }
    input.click()
  })
}

export function browserBackupSummaries(): WorkspaceBackupSummary[] {
  try {
    const text = globalThis.localStorage?.getItem('datapadplusplus-browser-backups')
    return text ? JSON.parse(text) as WorkspaceBackupSummary[] : []
  } catch {
    return []
  }
}

export async function encryptBrowserWorkspacePayload(
  passphrase: string,
  payload: string,
) {
  const crypto = browserCrypto()
  const salt = new Uint8Array(16)
  const nonce = new Uint8Array(12)
  crypto.getRandomValues(salt)
  crypto.getRandomValues(nonce)

  const key = await deriveBrowserExportKey(passphrase, salt, EXPORT_KDF_ITERATIONS)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
      key,
      new TextEncoder().encode(payload),
    ),
  )

  return bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({
        kdf: EXPORT_KDF,
        iterations: EXPORT_KDF_ITERATIONS,
        salt: bytesToBase64(salt),
        nonce: bytesToBase64(nonce),
        ciphertext: bytesToBase64(ciphertext),
      }),
    ),
  )
}

export async function decryptBrowserWorkspacePayload(
  passphrase: string,
  encryptedPayload: string,
): Promise<WorkspaceSnapshot> {
  try {
    const packageText = new TextDecoder().decode(base64ToBytes(encryptedPayload))
    const packageValue = JSON.parse(packageText) as Partial<EncryptedBrowserBundle>

    if ('snapshot' in packageValue || 'passphraseHash' in packageValue) {
      return parseLegacyBrowserPreviewBundle(
        passphrase,
        packageValue as Partial<LegacyBrowserPreviewBundle>,
      )
    }

    const nonce = requiredBase64Bytes(packageValue.nonce, 'Missing nonce.')
    const ciphertext = requiredBase64Bytes(packageValue.ciphertext, 'Missing ciphertext.')
    const key =
      packageValue.kdf === EXPORT_KDF
        ? await deriveBrowserExportKey(
            passphrase,
            requiredBase64Bytes(packageValue.salt, 'Missing salt.'),
            positiveIterations(packageValue.iterations),
          )
        : await deriveLegacyBrowserExportKey(passphrase)
    const plaintext = await browserCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
      key,
      toArrayBuffer(ciphertext),
    )

    return await parseBrowserWorkspacePayload(new TextDecoder().decode(plaintext))
  } catch (error) {
    const legacySnapshot = tryParseLegacyBrowserPreviewBundle(passphrase, encryptedPayload)

    if (legacySnapshot) {
      return legacySnapshot
    }

    throw error
  }
}

interface EncryptedBrowserBundle {
  kdf: string
  iterations: number
  salt: string
  nonce: string
  ciphertext: string
}

async function deriveBrowserExportKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
) {
  const crypto = browserCrypto()
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function deriveLegacyBrowserExportKey(passphrase: string) {
  const digest = await browserCrypto().subtle.digest(
    'SHA-256',
    new TextEncoder().encode(passphrase),
  )
  return browserCrypto().subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )
}

function browserCrypto() {
  const crypto = globalThis.crypto

  if (!crypto?.subtle) {
    throw new Error('This browser cannot encrypt workspace bundles.')
  }

  return crypto
}

function positiveIterations(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 100_000
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = globalThis.atob ? globalThis.atob(value) : decodeBase64(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function requiredBase64Bytes(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message)
  }
  return base64ToBytes(value)
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

interface LegacyBrowserPreviewBundle {
  snapshot: WorkspaceSnapshot
  passphraseHash?: string
}

function parseLegacyBrowserPreviewBundle(
  passphrase: string,
  packageValue: Partial<LegacyBrowserPreviewBundle>,
) {
  if (!packageValue.snapshot) {
    throw new Error('Missing snapshot payload.')
  }

  if (
    typeof packageValue.passphraseHash === 'string' &&
    packageValue.passphraseHash !== hashPassphrase(passphrase)
  ) {
    throw new Error('Passphrase does not match the exported bundle.')
  }

  return packageValue.snapshot
}

function tryParseLegacyBrowserPreviewBundle(
  passphrase: string,
  encryptedPayload: string,
) {
  try {
    return parseLegacyBrowserPreviewBundle(
      passphrase,
      JSON.parse(decodeBase64(encryptedPayload)) as Partial<LegacyBrowserPreviewBundle>,
    )
  } catch {
    return undefined
  }
}
