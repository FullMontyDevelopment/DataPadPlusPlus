import type { LiteDbObjectViewDescriptor } from './LiteDbObjectViewDescriptors'

export type LiteDbWorkflowIconName = 'database' | 'collection' | 'document' | 'index' | 'file' | 'storage' | 'diagnostics'

export type LiteDbWorkflow = {
  label: string
  title: string
  icon: LiteDbWorkflowIconName
  action?: 'query'
  targetSection?: string
}

export function liteDbWorkflows(
  kind: string,
  descriptor: LiteDbObjectViewDescriptor,
  hasQueryTarget: boolean,
  availableSections?: ReadonlySet<string>,
) {
  const workflows: LiteDbWorkflow[] = []

  if (hasQueryTarget && descriptor.primaryQueryLabel) {
    workflows.push({
      label: descriptor.primaryQueryLabel,
      title: 'Open a bounded LiteDB document query for this collection.',
      icon: 'document',
      action: 'query',
    })
  }

  if (['database', 'collections'].includes(kind)) {
    workflows.push(
      { label: 'Collections', title: 'Review collection counts, indexes, and inferred fields.', icon: 'collection', targetSection: 'collections' },
      { label: 'File Storage', title: 'Review LiteDB file storage metadata and chunk health.', icon: 'file', targetSection: 'files' },
      { label: 'Maintenance', title: 'Review checkpoint, shrink, and rebuild guidance before running maintenance.', icon: 'storage', targetSection: 'storage' },
    )
  }

  if (['collection', 'schema', 'indexes', 'index'].includes(kind)) {
    workflows.push(
      { label: 'Schema', title: 'Review sampled field paths and mixed-type warnings.', icon: 'document', targetSection: 'fields' },
      { label: 'Indexes', title: 'Review index expressions, uniqueness, and coverage.', icon: 'index', targetSection: 'indexes' },
    )
  }

  if (['storage', 'settings', 'diagnostics', 'file-storage', 'files', 'chunks'].includes(kind)) {
    workflows.push(
      { label: 'Storage', title: 'Review page allocation, free pages, and file footprint.', icon: 'storage', targetSection: 'storage' },
      { label: 'Health', title: 'Review maintenance warnings and local-file health.', icon: 'diagnostics', targetSection: 'diagnostics' },
    )
  }

  return dedupeWorkflows(workflows)
    .filter((workflow) => isWorkflowAvailable(workflow, availableSections))
    .slice(0, 5)
}

function isWorkflowAvailable(workflow: LiteDbWorkflow, availableSections?: ReadonlySet<string>) {
  return !availableSections || workflow.action === 'query' || !workflow.targetSection || availableSections.has(workflow.targetSection)
}

function dedupeWorkflows<T extends { label: string }>(workflows: T[]) {
  const seen = new Set<string>()
  return workflows.filter((workflow) => {
    if (seen.has(workflow.label)) {
      return false
    }

    seen.add(workflow.label)
    return true
  })
}
