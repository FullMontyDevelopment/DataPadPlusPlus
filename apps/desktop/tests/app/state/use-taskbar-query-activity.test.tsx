import { render, waitFor } from '@testing-library/react'
import type { QueryTabActiveExecution } from '@datapadplusplus/shared-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setTaskbarQueryActivity } from '../../../src/services/runtime/desktop-bridge'
import { useTaskbarQueryActivity } from '../../../src/app/state/use-taskbar-query-activity'

vi.mock('../../../src/services/runtime/desktop-bridge', () => ({
  setTaskbarQueryActivity: vi.fn().mockResolvedValue(undefined),
}))

const setTaskbarQueryActivityMock = vi.mocked(setTaskbarQueryActivity)

function execution(executionId: string, phase: QueryTabActiveExecution['phase'] = 'server') {
  return {
    executionId,
    phase,
    startedAt: '2026-07-16T08:00:00.000Z',
  } satisfies QueryTabActiveExecution
}

function ActivityProbe({
  executionsByTab,
}: {
  executionsByTab: Record<string, QueryTabActiveExecution>
}) {
  useTaskbarQueryActivity(executionsByTab)
  return null
}

describe('useTaskbarQueryActivity', () => {
  beforeEach(() => {
    setTaskbarQueryActivityMock.mockClear()
  })

  it('tracks all tabs without flickering while any query remains active', async () => {
    const { rerender } = render(<ActivityProbe executionsByTab={{}} />)
    await waitFor(() => expect(setTaskbarQueryActivityMock).toHaveBeenLastCalledWith(0))

    rerender(
      <ActivityProbe executionsByTab={{ 'inactive-tab': execution('execution-a') }} />,
    )
    await waitFor(() => expect(setTaskbarQueryActivityMock).toHaveBeenLastCalledWith(1))

    rerender(
      <ActivityProbe
        executionsByTab={{
          'inactive-tab': execution('execution-a', 'rendering'),
          'active-tab': execution('execution-b', 'paging'),
        }}
      />,
    )
    rerender(
      <ActivityProbe
        executionsByTab={{ 'active-tab': execution('execution-b', 'paging') }}
      />,
    )

    expect(setTaskbarQueryActivityMock).toHaveBeenCalledTimes(2)

    rerender(<ActivityProbe executionsByTab={{}} />)
    await waitFor(() => expect(setTaskbarQueryActivityMock).toHaveBeenLastCalledWith(0))
    expect(setTaskbarQueryActivityMock).toHaveBeenCalledTimes(3)
  })

  it('clears active taskbar state when the workspace unmounts', async () => {
    const { unmount } = render(
      <ActivityProbe executionsByTab={{ tab: execution('execution-a') }} />,
    )
    await waitFor(() => expect(setTaskbarQueryActivityMock).toHaveBeenLastCalledWith(1))

    unmount()

    expect(setTaskbarQueryActivityMock).toHaveBeenLastCalledWith(0)
  })
})
