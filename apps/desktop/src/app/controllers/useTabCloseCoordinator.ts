import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CloseQueryTabsResponse,
  QueryTabActiveExecution,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { isQueryTabExecutionLocked } from '../state/query-execution-lock'

export interface PendingTabCloseReview {
  remainingTabs: QueryTabState[]
  tab: QueryTabState
}

interface TabCloseCoordinatorOptions {
  tabs: QueryTabState[]
  executionsByTab: Record<string, QueryTabActiveExecution>
  hasUnsavedChanges(tab: QueryTabState): boolean
  closeTabs(tabIds: string[]): Promise<CloseQueryTabsResponse | undefined>
  saveAndCloseTab(tab: QueryTabState): Promise<CloseQueryTabsResponse | undefined>
  discardTab(tab: QueryTabState): Promise<void> | void
  disposeClosedTabs(tabIds: string[]): void
  reportLockedTabs(tabIds: string[]): void
}

export function useTabCloseCoordinator(options: TabCloseCoordinatorOptions) {
  const optionsRef = useRef(options)
  const [pendingReview, setPendingReview] = useState<PendingTabCloseReview>()

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const acceptResponse = useCallback((response: CloseQueryTabsResponse | undefined) => {
    if (!response) {
      return false
    }
    const current = optionsRef.current
    if (response.closedTabIds.length > 0) {
      current.disposeClosedTabs(response.closedTabIds)
    }
    if (response.lockedTabIds.length > 0) {
      current.reportLockedTabs(response.lockedTabIds)
    }
    return true
  }, [])

  const showNextReview = useCallback((tabs: QueryTabState[]) => {
    const [tab, ...remainingTabs] = tabs
    setPendingReview(tab ? { tab, remainingTabs } : undefined)
  }, [])

  const requestCloseTabs = useCallback(async (tabIds: string[]) => {
    const current = optionsRef.current
    const uniqueTabIds = [...new Set(tabIds)]
    const tabById = new Map(current.tabs.map((tab) => [tab.id, tab]))
    const immediateTabIds: string[] = []
    const dirtyTabs: QueryTabState[] = []

    for (const tabId of uniqueTabIds) {
      const tab = tabById.get(tabId)
      if (
        tab &&
        !isQueryTabExecutionLocked(tab, current.executionsByTab[tabId]) &&
        current.hasUnsavedChanges(tab)
      ) {
        dirtyTabs.push(tab)
      } else {
        immediateTabIds.push(tabId)
      }
    }

    if (immediateTabIds.length > 0) {
      const response = await current.closeTabs(immediateTabIds)
      if (!acceptResponse(response)) {
        return
      }
    }
    showNextReview(dirtyTabs)
  }, [acceptResponse, showNextReview])

  const requestCloseTab = useCallback((tabId: string) => {
    void requestCloseTabs([tabId])
  }, [requestCloseTabs])

  const cancelReview = useCallback(() => {
    setPendingReview(undefined)
  }, [])

  const discardAndContinue = useCallback(() => {
    const review = pendingReview
    if (!review) {
      return
    }
    setPendingReview(undefined)
    void (async () => {
      const current = optionsRef.current
      await current.discardTab(review.tab)
      const response = await current.closeTabs([review.tab.id])
      if (acceptResponse(response)) {
        showNextReview(review.remainingTabs)
      } else {
        setPendingReview(review)
      }
    })()
  }, [acceptResponse, pendingReview, showNextReview])

  const saveAndContinue = useCallback(() => {
    const review = pendingReview
    if (!review) {
      return
    }
    setPendingReview(undefined)
    void (async () => {
      const response = await optionsRef.current.saveAndCloseTab(review.tab)
      if (acceptResponse(response)) {
        showNextReview(review.remainingTabs)
      } else {
        setPendingReview(review)
      }
    })()
  }, [acceptResponse, pendingReview, showNextReview])

  return {
    cancelReview,
    discardAndContinue,
    pendingReview,
    requestCloseTab,
    requestCloseTabs,
    saveAndContinue,
  }
}
