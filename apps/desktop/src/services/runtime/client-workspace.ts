import type { BootstrapPayload, DiagnosticsReport, ExportBundle, UpdateUiStateRequest, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createBrowserPreviewHealth } from '../../app/data/workspace-factory'
import { buildDiagnosticsReport, migrateWorkspaceSnapshot } from '../../app/state/helpers'
import { redactErrorMessage } from '../../app/state/security-redaction'
import { decodeBase64, buildBrowserPayload, cloneSnapshot, hashPassphrase, loadBrowserSnapshot, saveBrowserSnapshot, updateUiStateLocally } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'

const WORKSPACE_BUNDLE_PASSPHRASE_MIN_LENGTH = 8
const MAX_WORKSPACE_BUNDLE_BYTES = 25 * 1024 * 1024
const EXPORT_KDF = 'pbkdf2-sha256'
const EXPORT_KDF_ITERATIONS = 210_000

export const clientWorkspace = {
  async bootstrapApp(): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      const payload = await invokeDesktop<BootstrapPayload>('bootstrap_app')

      return payload.snapshot.lockState.isLocked
        ? invokeDesktop<BootstrapPayload>('unlock_app')
        : payload
    }

    return buildBrowserPayload(loadBrowserSnapshot())
  },

  async setTheme(theme: WorkspaceSnapshot['preferences']['theme']): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_theme', { theme })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    next.preferences.theme = theme
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async createDiagnosticsReport(): Promise<DiagnosticsReport> {
    if (isTauriRuntime()) {
      return invokeDesktop<DiagnosticsReport>('create_diagnostics_report')
    }

    const snapshot = loadBrowserSnapshot()
    return buildDiagnosticsReport(snapshot, createBrowserPreviewHealth())
  },

  async exportWorkspaceBundle(passphrase: string): Promise<ExportBundle> {
    validateWorkspaceBundlePassphrase(passphrase)

    if (isTauriRuntime()) {
      return invokeDesktop<ExportBundle>('export_workspace_bundle', { passphrase })
    }

    return {
      format: 'datapadplusplus-bundle',
      version: 3,
      encryptedPayload: await encryptBrowserWorkspacePayload(
        passphrase,
        JSON.stringify(migrateWorkspaceSnapshot(loadBrowserSnapshot())),
      ),
    }
  },

  async importWorkspaceBundle(
    passphrase: string,
    encryptedPayload: string,
  ): Promise<BootstrapPayload> {
    validateWorkspaceBundlePassphrase(passphrase)
    validateWorkspaceBundlePayload(encryptedPayload)

    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('import_workspace_bundle', {
        passphrase,
        encryptedPayload,
      })
    }

    try {
      const snapshot = migrateWorkspaceSnapshot(
        await decryptBrowserWorkspacePayload(passphrase, encryptedPayload),
      )
      saveBrowserSnapshot(snapshot)
      return buildBrowserPayload(snapshot)
    } catch (error) {
      const message = redactErrorMessage(
        error,
        'Unable to import the encrypted bundle.',
      )

      // eslint-disable-next-line preserve-caught-error -- The original bundle import error can contain user-provided plaintext; only rethrow the redacted message.
      throw new Error(message)
    }
  },

  async updateUiState(patch: UpdateUiStateRequest): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_ui_state', { patch })
    }

    const snapshot = updateUiStateLocally(loadBrowserSnapshot(), patch)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },
}

function validateWorkspaceBundlePassphrase(passphrase: string) {
  if (passphrase.trim().length < WORKSPACE_BUNDLE_PASSPHRASE_MIN_LENGTH) {
    throw new Error('Use a workspace backup passphrase with at least 8 characters.')
  }
}

function validateWorkspaceBundlePayload(encryptedPayload: string) {
  if (!encryptedPayload.trim()) {
    throw new Error('Choose a workspace bundle before importing.')
  }

  if (encryptedPayload.length > MAX_WORKSPACE_BUNDLE_BYTES) {
    throw new Error('Workspace bundle is too large to import safely.')
  }
}

async function encryptBrowserWorkspacePayload(
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

async function decryptBrowserWorkspacePayload(
  passphrase: string,
  encryptedPayload: string,
): Promise<WorkspaceSnapshot> {
  try {
    const packageText = new TextDecoder().decode(base64ToBytes(encryptedPayload))
    const packageValue = JSON.parse(packageText) as Partial<EncryptedBrowserBundle>

    if ('snapshot' in packageValue || 'passphraseHash' in packageValue) {
      return parseLegacyBrowserPreviewPackage(
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

    return parseWorkspaceSnapshot(new TextDecoder().decode(plaintext))
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

function browserCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('Secure browser crypto is unavailable for workspace backups.')
  }

  return globalThis.crypto
}

function positiveIterations(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Invalid KDF iterations.')
  }

  return value
}

function requiredBase64Bytes(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message)
  }

  return base64ToBytes(value)
}

function parseWorkspaceSnapshot(value: string): WorkspaceSnapshot {
  return JSON.parse(value) as WorkspaceSnapshot
}

function tryParseLegacyBrowserPreviewBundle(
  passphrase: string,
  encryptedPayload: string,
) {
  try {
    return parseLegacyBrowserPreviewPackage(
      passphrase,
      JSON.parse(decodeBase64(encryptedPayload)) as Partial<LegacyBrowserPreviewBundle>,
    )
  } catch {
    return undefined
  }
}

interface LegacyBrowserPreviewBundle {
  snapshot: WorkspaceSnapshot
  passphraseHash?: string
}

function parseLegacyBrowserPreviewPackage(
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

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }

  return globalThis.btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = globalThis.atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
