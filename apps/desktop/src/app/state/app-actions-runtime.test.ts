import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RESULT_RENDER_ACK_FALLBACK_MS,
  scheduleResultRenderAckFallback,
} from './app-actions-runtime'

describe('runtime action render acknowledgement fallback', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks only the matching tab execution as displayed when the result view misses its ack', () => {
    vi.useFakeTimers()
    const dispatch = vi.fn()

    scheduleResultRenderAckFallback(dispatch, 'tab-mongo', 'execution-1')

    expect(dispatch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(RESULT_RENDER_ACK_FALLBACK_MS)

    expect(dispatch).toHaveBeenCalledWith({
      type: 'EXECUTION_DISPLAYED',
      tabId: 'tab-mongo',
      executionId: 'execution-1',
    })
  })
})
