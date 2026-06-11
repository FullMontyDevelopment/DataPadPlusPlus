import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientUpdates } from '../../../src/services/runtime/client-updates'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

describe('client updates', () => {
  afterEach(() => {
    invoke.mockReset()
    window.localStorage.clear()
    delete window.__TAURI_INTERNALS__
  })

  it('keeps browser-preview update settings device-local and unsupported', async () => {
    await expect(clientUpdates.setAppUpdateSettings(true)).resolves.toMatchObject({
      includePrereleases: true,
      supported: false,
    })

    await expect(clientUpdates.getAppUpdateSettings()).resolves.toMatchObject({
      includePrereleases: true,
      supported: false,
    })
  })

  it('returns an unsupported browser-preview check result', async () => {
    await clientUpdates.setAppUpdateSettings(true)

    await expect(clientUpdates.checkAppUpdate()).resolves.toMatchObject({
      status: 'unsupported',
      channel: 'prerelease',
      message: 'Updates are only available in the installed desktop app.',
      settings: expect.objectContaining({
        includePrereleases: true,
        supported: false,
      }),
    })
  })
})
