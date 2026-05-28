import type { InfluxObjectViewDescriptor } from './InfluxObjectViewDescriptors'

export type InfluxWorkflowIconName = 'bucket' | 'measurement' | 'tag' | 'field' | 'task' | 'security' | 'storage'

export type InfluxWorkflow = {
  label: string
  title: string
  icon: InfluxWorkflowIconName
  action?: 'query'
  targetSection?: string
}

export function influxWorkflows(
  kind: string,
  descriptor: InfluxObjectViewDescriptor,
  hasQueryTarget: boolean,
  availableSections?: ReadonlySet<string>,
) {
  const workflows: InfluxWorkflow[] = []

  if (hasQueryTarget && descriptor.primaryQueryLabel) {
    workflows.push({
      label: descriptor.primaryQueryLabel,
      title: 'Open a time-bound Flux or InfluxQL query for this object.',
      icon: 'measurement',
      action: 'query',
    })
  }

  if (['bucket', 'buckets'].includes(kind)) {
    workflows.push(
      { label: 'Measurements', title: 'Review schema and series shape.', icon: 'measurement', targetSection: 'measurements' },
      { label: 'Retention', title: 'Review retention and shard group settings.', icon: 'storage', targetSection: 'retentionPolicies' },
      { label: 'Tasks', title: 'Review scheduled Flux tasks.', icon: 'task', targetSection: 'tasks' },
    )
  }

  if (['measurement', 'measurements'].includes(kind)) {
    workflows.push(
      { label: 'Tags', title: 'Review indexed dimensions and cardinality.', icon: 'tag', targetSection: 'tags' },
      { label: 'Fields', title: 'Review value fields and types.', icon: 'field', targetSection: 'fields' },
    )
  }

  if (['security', 'tasks', 'task', 'diagnostics'].includes(kind)) {
    workflows.push({ label: 'Guardrails', title: 'Review token scopes and risky write paths.', icon: 'security', targetSection: 'diagnostics' })
  }

  return workflows.filter((workflow) => isWorkflowAvailable(workflow, availableSections))
}

function isWorkflowAvailable(workflow: InfluxWorkflow, availableSections?: ReadonlySet<string>) {
  return !availableSections || workflow.action === 'query' || !workflow.targetSection || availableSections.has(workflow.targetSection)
}
