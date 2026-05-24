import { afterEach, describe, expect, it } from 'vitest'
import { clientWorkspace } from './client-workspace'

describe('client workspace import validation', () => {
  afterEach(() => {
    window.localStorage.clear()
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
