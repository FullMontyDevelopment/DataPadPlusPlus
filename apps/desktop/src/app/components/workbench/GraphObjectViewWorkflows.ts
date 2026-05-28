import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type { GraphObjectViewDescriptor } from './GraphObjectViewDescriptors'

export type GraphWorkflowIconName =
  | 'graph'
  | 'label'
  | 'relationship'
  | 'index'
  | 'constraint'
  | 'security'
  | 'diagnostics'

export type GraphWorkflow = {
  label: string
  title: string
  icon: GraphWorkflowIconName
  action?: 'query'
  targetSection?: string
}

export function graphWorkflows(
  kind: string,
  descriptor: GraphObjectViewDescriptor,
  hasQueryTarget: boolean,
  engine: ConnectionProfile['engine'],
  availableSections?: ReadonlySet<string>,
) {
  const queryLanguage = engine === 'arango' ? 'AQL' : engine === 'neptune' || engine === 'janusgraph' ? 'Gremlin' : 'Cypher'
  const workflows: GraphWorkflow[] = []

  if (hasQueryTarget && descriptor.primaryQueryLabel) {
    workflows.push({
      label: descriptor.primaryQueryLabel,
      title: `Open a scoped ${queryLanguage} query for this graph object.`,
      icon: 'graph',
      action: 'query',
    })
  }

  if (['graph', 'graphs'].includes(kind)) {
    workflows.push(
      { label: 'Schema', title: 'Review labels, relationship types, and properties.', icon: 'label', targetSection: 'nodeLabels' },
      { label: 'Indexes', title: 'Review lookup coverage before expensive traversals.', icon: 'index', targetSection: 'indexes' },
      { label: 'Diagnostics', title: 'Review query, storage, and transaction health.', icon: 'diagnostics', targetSection: 'diagnostics' },
    )
  }

  if (['node-label', 'node-labels'].includes(kind)) {
    workflows.push(
      { label: 'Properties', title: 'Review property types and required fields.', icon: 'label', targetSection: 'propertyKeys' },
      { label: 'Relationships', title: 'Review connected relationship types.', icon: 'relationship', targetSection: 'relationshipTypes' },
      { label: 'Indexes', title: 'Review index and constraint coverage.', icon: 'index', targetSection: 'indexes' },
    )
  }

  if (['relationship', 'relationship-types'].includes(kind)) {
    workflows.push(
      { label: 'Endpoints', title: 'Review start/end labels and direction.', icon: 'relationship', targetSection: 'relationshipTypes' },
      { label: 'Properties', title: 'Review relationship property keys.', icon: 'label', targetSection: 'propertyKeys' },
    )
  }

  if (['indexes', 'index', 'constraints', 'constraint'].includes(kind)) {
    workflows.push(
      { label: 'Coverage', title: 'Review labels and properties covered by schema objects.', icon: 'index', targetSection: kind.includes('constraint') ? 'constraints' : 'indexes' },
      { label: 'Preview Changes', title: 'Generate guarded schema-management previews.', icon: 'constraint', targetSection: kind.includes('constraint') ? 'constraints' : 'indexes' },
    )
  }

  if (['security', 'procedures', 'diagnostics'].includes(kind)) {
    workflows.push(
      { label: 'Permissions', title: 'Review visible roles and disabled actions.', icon: 'security', targetSection: 'security' },
      { label: 'Health', title: 'Review runtime and query health signals.', icon: 'diagnostics', targetSection: 'diagnostics' },
    )
  }

  return dedupeWorkflows(workflows)
    .filter((workflow) => isWorkflowAvailable(workflow, availableSections))
    .slice(0, 5)
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

function isWorkflowAvailable(workflow: GraphWorkflow, availableSections?: ReadonlySet<string>) {
  return !availableSections || workflow.action === 'query' || !workflow.targetSection || availableSections.has(workflow.targetSection)
}
