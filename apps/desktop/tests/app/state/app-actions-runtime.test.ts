import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EXECUTION_ACTIVITY_MINIMUM_MS,
  RESULT_RENDER_ACK_FALLBACK_MS,
  scheduleResultRenderAckFallback,
  waitForMinimumExecutionActivity,
} from '../../../src/app/state/app-actions-runtime'

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

describe('runtime action minimum activity feedback', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps fast executions active for at least 200 ms', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    let settled = false
    const activity = waitForMinimumExecutionActivity(Date.now()).then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(EXECUTION_ACTIVITY_MINIMUM_MS - 1)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await activity
    expect(settled).toBe(true)
  })

  it('does not delay an execution that already exceeded the minimum', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))

    await expect(
      waitForMinimumExecutionActivity(Date.now() - EXECUTION_ACTIVITY_MINIMUM_MS),
    ).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
