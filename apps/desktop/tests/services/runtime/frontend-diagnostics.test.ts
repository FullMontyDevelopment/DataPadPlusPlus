import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

const { invokeDesktop } = vi.hoisted(() => ({
  invokeDesktop: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../src/services/runtime/desktop-bridge', () => ({
  invokeDesktop,
  isTauriRuntime: () => true,
}))

import {
  describeUnknownError,
  installFrontendDiagnostics,
  reportFrontendDiagnostic,
} from '../../../src/services/runtime/frontend-diagnostics'

let uninstallDiagnostics: (() => void) | undefined

afterEach(() => {
  uninstallDiagnostics?.()
  uninstallDiagnostics = undefined
  invokeDesktop.mockClear()
})

describe('frontend diagnostics', () => {
  it('serializes Error and non-Error rejection values safely', () => {
    const error = new Error('renderer failed')

    expect(describeUnknownError(error)).toMatchObject({
      message: 'renderer failed',
      stack: expect.stringContaining('renderer failed'),
    })
    expect(describeUnknownError({ reason: 'bad state' })).toEqual({
      message: '{"reason":"bad state"}',
    })
  })

  it('records global renderer errors with source coordinates and stack evidence', async () => {
    uninstallDiagnostics = installFrontendDiagnostics()
    invokeDesktop.mockClear()
    const error = new Error('window exploded')

    window.dispatchEvent(new ErrorEvent('error', {
      error,
      filename: 'app.js',
      lineno: 41,
      colno: 7,
      message: error.message,
    }))

    await waitFor(() => expect(invokeDesktop).toHaveBeenCalledWith(
      'record_frontend_diagnostic',
      expect.objectContaining({
        request: expect.objectContaining({
          event: 'window-error',
          level: 'error',
          message: 'window exploded',
          stack: expect.stringContaining('window exploded'),
          context: expect.objectContaining({
            column: '7',
            file: 'app.js',
            line: '41',
          }),
        }),
      }),
    ))
  })

  it('records explicit lifecycle phases with a renderer session and sequence', async () => {
    await reportFrontendDiagnostic('window-ready-request', {
      context: { role: 'editor' },
      message: 'Editor window is announcing readiness.',
    })

    expect(invokeDesktop).toHaveBeenCalledWith(
      'record_frontend_diagnostic',
      expect.objectContaining({
        request: expect.objectContaining({
          event: 'window-ready-request',
          sequence: expect.any(Number),
          sessionId: expect.stringMatching(/^renderer-/),
          context: { role: 'editor' },
        }),
      }),
    )
  })
})
