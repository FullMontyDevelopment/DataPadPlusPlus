import type { PrometheusObjectViewDescriptor } from './PrometheusObjectViewDescriptors'

export type PrometheusWorkflowIconName = 'metric' | 'series' | 'target' | 'rule' | 'alert' | 'storage'

export type PrometheusWorkflow = {
  label: string
  title: string
  icon: PrometheusWorkflowIconName
  action?: 'query'
  targetSection?: string
}

export function prometheusWorkflows(
  kind: string,
  descriptor: PrometheusObjectViewDescriptor,
  hasQueryTarget: boolean,
  availableSections?: ReadonlySet<string>,
) {
  const workflows: PrometheusWorkflow[] = []

  if (hasQueryTarget && descriptor.primaryQueryLabel) {
    workflows.push({
      label: descriptor.primaryQueryLabel,
      title: 'Open a PromQL query seeded from this object.',
      icon: 'metric',
      action: 'query',
    })
  }

  if (['metric', 'metrics', 'series'].includes(kind)) {
    workflows.push(
      { label: 'Series', title: 'Review bounded label sets before broad queries.', icon: 'series', targetSection: 'series' },
      { label: 'Labels', title: 'Check cardinality and useful dimensions.', icon: 'metric', targetSection: 'labels' },
    )
  }

  if (['targets', 'target', 'service-discovery'].includes(kind)) {
    workflows.push(
      { label: 'Health', title: 'Review scrape health and last errors.', icon: 'target', targetSection: 'targets' },
      { label: 'Discovery', title: 'Review discovered and dropped target metadata.', icon: 'target', targetSection: 'serviceDiscovery' },
    )
  }

  if (['rules', 'rule-group', 'rule', 'alerts', 'alert'].includes(kind)) {
    workflows.push(
      { label: 'Evaluate', title: 'Review rule expression health and evaluation timings.', icon: 'rule', targetSection: 'rules' },
      { label: 'Alerts', title: 'Review firing and pending alert instances.', icon: 'alert', targetSection: 'alerts' },
    )
  }

  if (['tsdb', 'storage', 'diagnostics', 'status'].includes(kind)) {
    workflows.push(
      { label: 'TSDB', title: 'Review head series, chunks, WAL, and block status.', icon: 'storage', targetSection: 'tsdb' },
      { label: 'Cardinality', title: 'Review high-cardinality labels and metric families.', icon: 'series', targetSection: 'diagnostics' },
    )
  }

  return workflows.filter((workflow) => isWorkflowAvailable(workflow, availableSections))
}

function isWorkflowAvailable(workflow: PrometheusWorkflow, availableSections?: ReadonlySet<string>) {
  return !availableSections || workflow.action === 'query' || !workflow.targetSection || availableSections.has(workflow.targetSection)
}
