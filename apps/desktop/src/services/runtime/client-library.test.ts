import { afterEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

describe('client library local-file saves', () => {
  afterEach(() => {
    invoke.mockReset()
    delete window.__TAURI_INTERNALS__
    window.localStorage.clear()
    vi.resetModules()
  })

  it('lets desktop local saves reach Tauri without a path so the OS dialog can open', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValue({
      health: { status: 'ok', message: 'ready' },
      snapshot: { schemaVersion: 1 },
      diagnostics: [],
    })

    const { clientLibrary } = await import('./client-library')
    await clientLibrary.saveQueryTabToLocalFile({ tabId: 'tab-1' })

    expect(invoke).toHaveBeenCalledWith('save_query_tab_to_local_file', {
      request: { tabId: 'tab-1' },
    })
  })

  it('rejects invalid supplied desktop local-save paths before invoking Tauri', async () => {
    window.__TAURI_INTERNALS__ = {}
    const { clientLibrary } = await import('./client-library')

    await expect(
      clientLibrary.saveQueryTabToLocalFile({
        tabId: 'tab-1',
        path: '..\\orders.sql',
      }),
    ).rejects.toThrow(/absolute file path/)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects invalid library item ids before invoking Tauri', async () => {
    window.__TAURI_INTERNALS__ = {}
    const { clientLibrary } = await import('./client-library')

    await expect(clientLibrary.openLibraryItem('../secret')).rejects.toThrow(
      /unsupported characters/,
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  it('still validates browser-preview local saves before mutating storage', async () => {
    const { clientLibrary } = await import('./client-library')

    await expect(
      clientLibrary.saveQueryTabToLocalFile({ tabId: 'tab-1' }),
    ).rejects.toThrow('Local file path is required.')
  })
})
