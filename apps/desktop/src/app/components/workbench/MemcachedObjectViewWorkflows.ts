export type MemcachedWorkflowIconName = 'server' | 'stats' | 'slabs' | 'items' | 'settings' | 'connections' | 'diagnostics'

export type MemcachedWorkflow = {
  label: string
  title: string
  icon: MemcachedWorkflowIconName
  targetSection?: string
}

export function memcachedWorkflows(kind: string, availableSections?: ReadonlySet<string>) {
  const workflows: MemcachedWorkflow[] = []

  if (['server', 'stats', 'diagnostics'].includes(kind)) {
    workflows.push(
      { label: 'Hit Rate', title: 'Review cache effectiveness from get hits and misses.', icon: 'stats', targetSection: 'diagnostics' },
      { label: 'Evictions', title: 'Watch item churn and pressure against max memory.', icon: 'diagnostics', targetSection: 'items' },
      { label: 'Connections', title: 'Check connection pressure and rejected clients.', icon: 'connections', targetSection: 'connections' },
    )
  }

  if (['slabs', 'slab', 'items', 'item-class'].includes(kind)) {
    workflows.push(
      { label: 'Allocation', title: 'Review chunk size, used chunks, pages, and item age.', icon: 'slabs', targetSection: 'slabs' },
      { label: 'Pressure', title: 'Look for evictions, out-of-memory counters, and reclaim behavior.', icon: 'diagnostics', targetSection: 'diagnostics' },
    )
  }

  if (kind === 'settings') {
    workflows.push(
      { label: 'Limits', title: 'Review max bytes, max connections, protocols, and LRU flags.', icon: 'settings', targetSection: 'settings' },
      { label: 'Safety', title: 'Use operation previews for any future setting changes.', icon: 'diagnostics', targetSection: 'diagnostics' },
    )
  }

  return workflows.filter((workflow) => !availableSections || !workflow.targetSection || availableSections.has(workflow.targetSection))
}
