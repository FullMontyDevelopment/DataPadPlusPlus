export interface TabMutationTicket {
  epoch: number
  tabId: string
}

export class TabMutationCoordinator {
  private readonly closingTabIds = new Set<string>()
  private readonly mutationEpochs = new Map<string, number>()

  beginMutation(tabId: string): TabMutationTicket | undefined {
    if (this.closingTabIds.has(tabId)) {
      return undefined
    }
    return {
      tabId,
      epoch: this.mutationEpochs.get(tabId) ?? 0,
    }
  }

  canApply(ticket: TabMutationTicket) {
    return (
      !this.closingTabIds.has(ticket.tabId) &&
      (this.mutationEpochs.get(ticket.tabId) ?? 0) === ticket.epoch
    )
  }

  beginClose(tabIds: string[]) {
    const acceptedTabIds = [...new Set(tabIds)].filter(
      (tabId) => !this.closingTabIds.has(tabId),
    )
    acceptedTabIds.forEach((tabId) => this.closingTabIds.add(tabId))
    return acceptedTabIds
  }

  acceptClosed(tabIds: string[]) {
    for (const tabId of tabIds) {
      this.mutationEpochs.set(tabId, (this.mutationEpochs.get(tabId) ?? 0) + 1)
    }
  }

  finishClose(tabIds: string[]) {
    tabIds.forEach((tabId) => this.closingTabIds.delete(tabId))
  }
}
