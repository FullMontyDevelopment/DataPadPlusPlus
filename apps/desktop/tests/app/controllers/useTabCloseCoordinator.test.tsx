import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CloseQueryTabsResponse, QueryTabState } from '@datapadplusplus/shared-types'
import { useTabCloseCoordinator } from '../../../src/app/controllers/useTabCloseCoordinator'
import { createSeedSnapshot } from '../../fixtures/seed-workspace'

function closeResponse(
  closedTabIds: string[],
  lockedTabIds: string[] = [],
): CloseQueryTabsResponse {
  return {
    payload: {} as CloseQueryTabsResponse['payload'],
    closedTabIds,
    lockedTabIds,
    missingTabIds: [],
  }
}

describe('tab close coordinator', () => {
  it('closes all clean targets in one batch and reviews dirty tabs individually', async () => {
    const tabs = createSeedSnapshot().tabs.slice(0, 4)
    const dirtyTab = tabs[1] as QueryTabState
    dirtyTab.savedQueryId = 'saved-query'
    dirtyTab.dirty = true
    const lockedTab = tabs[2] as QueryTabState
    lockedTab.status = 'queued'
    const cleanTabIds = [tabs[0]!.id, tabs[3]!.id]
    const closeTabs = vi.fn()
      .mockResolvedValueOnce(closeResponse(cleanTabIds, [lockedTab.id]))
      .mockResolvedValueOnce(closeResponse([dirtyTab.id]))
    const disposeClosedTabs = vi.fn()
    const reportLockedTabs = vi.fn()
    const discardTab = vi.fn()

    const { result } = renderHook(() => useTabCloseCoordinator({
      tabs,
      executionsByTab: {},
      hasUnsavedChanges: (tab) => Boolean(tab.dirty && tab.savedQueryId),
      closeTabs,
      saveAndCloseTab: vi.fn(),
      discardTab,
      disposeClosedTabs,
      reportLockedTabs,
    }))

    await act(async () => {
      await result.current.requestCloseTabs(tabs.map((tab) => tab.id))
    })

    expect(closeTabs).toHaveBeenCalledTimes(1)
    expect(closeTabs).toHaveBeenCalledWith([
      tabs[0]!.id,
      lockedTab.id,
      tabs[3]!.id,
    ])
    expect(disposeClosedTabs).toHaveBeenCalledWith(cleanTabIds)
    expect(reportLockedTabs).toHaveBeenCalledWith([lockedTab.id])
    expect(result.current.pendingReview?.tab.id).toBe(dirtyTab.id)

    act(() => result.current.discardAndContinue())

    await waitFor(() => expect(closeTabs).toHaveBeenCalledTimes(2))
    expect(discardTab).toHaveBeenCalledWith(dirtyTab)
    expect(disposeClosedTabs).toHaveBeenLastCalledWith([dirtyTab.id])
    expect(result.current.pendingReview).toBeUndefined()
  })

  it('stops the remaining dirty-tab review on cancel without reopening clean tabs', async () => {
    const tabs = createSeedSnapshot().tabs.slice(0, 3)
    for (const tab of tabs.slice(1)) {
      tab.savedQueryId = `saved-${tab.id}`
      tab.dirty = true
    }
    const closeTabs = vi.fn().mockResolvedValue(closeResponse([tabs[0]!.id]))
    const disposeClosedTabs = vi.fn()

    const { result } = renderHook(() => useTabCloseCoordinator({
      tabs,
      executionsByTab: {},
      hasUnsavedChanges: (tab) => Boolean(tab.dirty && tab.savedQueryId),
      closeTabs,
      saveAndCloseTab: vi.fn(),
      discardTab: vi.fn(),
      disposeClosedTabs,
      reportLockedTabs: vi.fn(),
    }))

    await act(async () => {
      await result.current.requestCloseTabs(tabs.map((tab) => tab.id))
    })
    expect(disposeClosedTabs).toHaveBeenCalledWith([tabs[0]!.id])
    expect(result.current.pendingReview?.tab.id).toBe(tabs[1]!.id)

    act(() => result.current.cancelReview())

    expect(result.current.pendingReview).toBeUndefined()
    expect(closeTabs).toHaveBeenCalledTimes(1)
  })
})
