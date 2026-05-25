import { afterEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

describe('client test-suite command validation', () => {
  afterEach(() => {
    invoke.mockReset()
    delete window.__TAURI_INTERNALS__
    vi.resetModules()
  })

  it('rejects invalid template ids before invoking desktop commands', async () => {
    window.__TAURI_INTERNALS__ = {}
    const { clientTests } = await import('./client-tests')

    await expect(
      clientTests.openTestSuiteTemplate({
        templateId: '../template',
        connectionId: 'conn-1',
      }),
    ).rejects.toThrow(/Test template id contains unsupported characters/)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects oversized raw test suite text before invoking desktop commands', async () => {
    window.__TAURI_INTERNALS__ = {}
    const { clientTests } = await import('./client-tests')

    await expect(
      clientTests.updateTestSuiteTab({
        tabId: 'tab-1',
        rawText: 'x'.repeat(1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/Test suite JSON is too large/)
    expect(invoke).not.toHaveBeenCalled()
  })
})
