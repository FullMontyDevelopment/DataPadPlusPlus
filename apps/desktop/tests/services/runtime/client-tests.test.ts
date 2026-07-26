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
    const { clientTests } = await import('../../../src/services/runtime/client-tests')

    await expect(
      clientTests.openTestSuiteTemplate({
        templateId: '../template',
        connectionId: 'conn-1',
        environmentId: 'env-dev',
        scopedTarget: {
          kind: 'table',
          label: 'orders',
        },
      }),
    ).rejects.toThrow(/Test template id contains unsupported characters/)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects oversized raw test suite text before invoking desktop commands', async () => {
    window.__TAURI_INTERNALS__ = {}
    const { clientTests } = await import('../../../src/services/runtime/client-tests')

    await expect(
      clientTests.updateTestSuiteTab({
        tabId: 'tab-1',
        rawText: 'x'.repeat(1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/Test suite JSON is too large/)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('preserves additive plan and confirmation fields in desktop commands', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValueOnce({
      planId: 'test-plan-1',
      suiteRevision: 'revision-1',
      connectionId: 'conn-1',
      environmentId: 'env-dev',
      scopedTarget: { kind: 'table', label: 'orders' },
      inferredLanguage: 'sql',
      status: 'confirm',
      expiresAt: '2026-07-24T12:00:00Z',
      requiredConfirmationText: 'CONFIRM TEST RUN suite-1',
      steps: [],
      blockers: [],
      warnings: [],
    })
    const { clientTests } = await import('../../../src/services/runtime/client-tests')

    await clientTests.planTestSuiteRun({
      tabId: 'test-tab-1',
      caseId: 'case-1',
    })
    expect(invoke).toHaveBeenLastCalledWith('plan_test_suite_run', {
      request: {
        tabId: 'test-tab-1',
        caseId: 'case-1',
      },
    })

    invoke.mockResolvedValueOnce({ tab: {}, run: {}, diagnostics: [] })
    await clientTests.executeTestSuite({
      tabId: 'test-tab-1',
      caseId: 'case-1',
      runId: 'test-run-1',
      planId: 'test-plan-1',
      confirmationText: 'CONFIRM TEST RUN suite-1',
    })
    expect(invoke).toHaveBeenLastCalledWith('execute_test_suite', {
      request: {
        tabId: 'test-tab-1',
        caseId: 'case-1',
        runId: 'test-run-1',
        planId: 'test-plan-1',
        confirmationText: 'CONFIRM TEST RUN suite-1',
      },
    })
  })
})
