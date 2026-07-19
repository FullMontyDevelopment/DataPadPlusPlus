import { describe, expect, it, vi } from 'vitest'
import { createBlankBootstrapPayload } from '../../../src/app/data/workspace-factory'
import { dispatchBootstrapPayload } from '../../../src/app/state/app-state-payload'

describe('bootstrap payload application', () => {
  it('records persistence warnings without opening Messages', () => {
    const dispatch = vi.fn()
    const payload = createBlankBootstrapPayload()
    payload.persistenceWarning = {
      code: 'workspace-save-blocked',
      message: 'The tab closed, but the workspace file is temporarily in use.',
    }

    dispatchBootstrapPayload(dispatch, payload)

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'COMMAND_SUCCESS', payload })
    expect(dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'WORKBENCH_MESSAGE_ADDED',
      openMessages: false,
      message: expect.objectContaining({
        severity: 'warning',
        message: payload.persistenceWarning.message,
        details: payload.persistenceWarning.code,
      }),
    }))
  })

  it('does not create a warning for ordinary payloads', () => {
    const dispatch = vi.fn()
    const payload = createBlankBootstrapPayload()

    dispatchBootstrapPayload(dispatch, payload)

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith({ type: 'COMMAND_SUCCESS', payload })
  })
})
