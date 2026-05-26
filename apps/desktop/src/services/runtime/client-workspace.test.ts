import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientWorkspace } from './client-workspace'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

describe('client workspace import validation', () => {
  afterEach(() => {
    invoke.mockReset()
    window.localStorage.clear()
    delete window.__TAURI_INTERNALS__
  })

  it('rejects empty or oversized browser-preview bundles before parsing', async () => {
    await expect(
      clientWorkspace.importWorkspaceBundle('long-enough', ''),
    ).rejects.toThrow('Choose a workspace bundle before importing.')

    await expect(
      clientWorkspace.importWorkspaceBundle(
        'long-enough',
        'x'.repeat(25 * 1024 * 1024 + 1),
      ),
    ).rejects.toThrow('Workspace bundle is too large to import safely.')
  })

  it('rejects common workspace backup passphrases without requiring a minimum length', async () => {
    await expect(clientWorkspace.exportWorkspaceBundle('password')).rejects.toThrow(
      'Choose a less common workspace backup passphrase.',
    )
    await expect(clientWorkspace.importWorkspaceBundle('12345', 'encrypted')).rejects.toThrow(
      'Choose a less common workspace backup passphrase.',
    )
  })

  it('uses a desktop compatibility passphrase for short allowed passphrases', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValue({
      format: 'datapadplusplus-bundle',
      version: 3,
      encryptedPayload: 'encrypted',
    })

    await expect(clientWorkspace.exportWorkspaceBundle('x', true)).resolves.toMatchObject({
      encryptedPayload: 'encrypted',
    })

    expect(invoke).toHaveBeenCalledWith(
      'export_workspace_bundle',
      expect.objectContaining({
        passphrase: expect.stringMatching(
          /^datapadplusplus-workspace-backup-short-passphrase-v2:x$/,
        ),
        includeSecrets: true,
      }),
    )
  })

  it('falls back to the raw short passphrase when importing older short-passphrase bundles', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke
      .mockRejectedValueOnce(new Error('Unable to decrypt workspace bundle.'))
      .mockResolvedValueOnce({ snapshot: { schemaVersion: 3 } })

    await expect(clientWorkspace.importWorkspaceBundle('x', 'encrypted')).resolves.toMatchObject({
      snapshot: { schemaVersion: 3 },
    })

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'import_workspace_bundle',
      expect.objectContaining({
        passphrase: expect.stringMatching(
          /^datapadplusplus-workspace-backup-short-passphrase-v2:x$/,
        ),
      }),
    )
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'import_workspace_bundle',
      expect.objectContaining({
        passphrase: 'x',
      }),
    )
  })

  it.runIf(globalThis.crypto?.subtle)('encrypts browser-preview workspace bundles with AES-GCM envelopes', async () => {
    const bundle = await clientWorkspace.exportWorkspaceBundle('correct horse')
    const decoded = JSON.parse(globalThis.atob(bundle.encryptedPayload)) as {
      kdf?: string
      iterations?: number
      salt?: string
      nonce?: string
      ciphertext?: string
      snapshot?: unknown
    }

    expect(decoded).toMatchObject({
      kdf: 'pbkdf2-sha256',
      iterations: 210_000,
      salt: expect.any(String),
      nonce: expect.any(String),
      ciphertext: expect.any(String),
    })
    expect(decoded.snapshot).toBeUndefined()
    expect(bundle.encryptedPayload).not.toContain('connections')

    await expect(
      clientWorkspace.importWorkspaceBundle('correct horse', bundle.encryptedPayload),
    ).resolves.toMatchObject({
      snapshot: expect.objectContaining({
        schemaVersion: expect.any(Number),
      }),
    })
  })
})
