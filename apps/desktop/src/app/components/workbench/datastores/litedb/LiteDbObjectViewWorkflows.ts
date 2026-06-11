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
      { label: 'Pragmas', title: 'Review LiteDB file pragmas and local runtime options.', icon: 'storage', targetSection: 'pragmas' },
      { label: 'Maintenance', title: 'Review checkpoint, compact, rebuild, and backup workflows.', icon: 'storage', targetSection: 'maintenance' },
    )
  }

  if (['collection', 'schema', 'indexes', 'index', 'statistics'].includes(kind)) {
    workflows.push(
      { label: 'Schema', title: 'Review sampled field paths and mixed-type warnings.', icon: 'document', targetSection: 'fields' },
      { label: 'Indexes', title: 'Review index expressions, uniqueness, and coverage.', icon: 'index', targetSection: 'indexes' },
      { label: 'Statistics', title: 'Review collection counts and storage signals.', icon: 'diagnostics', targetSection: 'statistics' },
    )
  }

  if (['storage', 'settings', 'pragmas', 'maintenance', 'diagnostics', 'file-storage', 'files', 'chunks'].includes(kind)) {
    workflows.push(
      { label: 'Storage', title: 'Review page allocation, free pages, and file footprint.', icon: 'storage', targetSection: 'storage' },
      { label: 'Maintenance', title: 'Review checkpoint, compact, rebuild, and backup workflows.', icon: 'storage', targetSection: 'maintenance' },
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
