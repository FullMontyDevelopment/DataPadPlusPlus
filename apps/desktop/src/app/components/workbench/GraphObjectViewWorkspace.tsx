import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  ObjectConstraintIcon,
  ObjectGraphIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectRelationshipIcon,
  ObjectSecurityIcon,
  PlayIcon,
  RefreshIcon,
  WarningIcon,
} from './icons'
import {
  getGraphObjectViewDescriptor,
  type GraphObjectViewDescriptor,
} from './GraphObjectViewDescriptors'
import { ExplorerNodeIcon } from './SideBar.node-icons'

type JsonRecord = Record<string, unknown>
type GraphSectionIconName = 'graph' | 'label' | 'relationship' | 'index' | 'constraint' | 'security' | 'diagnostics'

interface GraphObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
}

export function GraphObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
}: GraphObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'object')
  const descriptor = getGraphObjectViewDescriptor(kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => graphQueryTargetFromObjectView(tab), [tab])
  const workflows = graphWorkflows(kind, descriptor, Boolean(queryTarget), connection.engine)
  const cards = graphMetricCards(payload, connection)
  const sections = graphSections(kind, payload, descriptor)

  return (
    <section className="object-view-workspace" aria-label={`${descriptor.title} object view`}>
      <div className="object-view-toolbar">
        <div className="object-view-heading">
          <ExplorerNodeIcon connection={connection} kind={kind} />
          <div>
            <strong>{descriptor.title}</strong>
            <span>
              {[connection.name, environment.label, ...(state?.path ?? [])].filter(Boolean).join(' / ')}
            </span>
          </div>
        </div>
        <div className="object-view-actions">
          {queryTarget && descriptor.primaryQueryLabel ? (
            <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
              <PlayIcon className="panel-inline-icon" />
              {descriptor.primaryQueryLabel}
            </button>
          ) : null}
          <button type="button" className="drawer-button" disabled={refreshing} onClick={refresh}>
            <RefreshIcon className="panel-inline-icon" />
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="object-view-purpose">
        <strong>{state?.label && state.label !== descriptor.title ? state.label : descriptor.menuLabel}</strong>
        <span>{descriptor.purpose}</span>
      </div>
      <GraphWarningList warnings={graphWarnings(tab, payload)} />

      <div className="object-view-body">
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => {
                const chip = (
                  <>
                    <GraphSectionIcon icon={workflow.icon} />
                    <span>{workflow.label}</span>
                  </>
                )

                return workflow.action === 'query' && queryTarget ? (
                  <button
                    key={workflow.label}
                    type="button"
                    className="object-view-action-chip object-view-action-chip--button"
                    title={workflow.title}
                    onClick={() => onOpenQuery(queryTarget)}
                  >
                    {chip}
                  </button>
                ) : (
                  <span key={workflow.label} className="object-view-action-chip" title={workflow.title}>
                    {chip}
                  </span>
                )
              })}
            </div>
          </section>
        ) : null}

        {cards.length ? (
          <section className="object-view-section">
            <GraphSectionHeading icon="graph" title="At a Glance" />
            <div className="object-view-card-grid">
              {cards.map((card) => (
                <div className="object-view-card" key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {sections.length ? (
          sections.map((section) => (
            <section className="object-view-section" key={section.title}>
              <GraphSectionHeading icon={section.icon} title={section.title} unit={section.unit} />
              <GraphObjectViewTable columns={section.columns} rows={section.rows} emptyText={section.emptyText} />
            </section>
          ))
        ) : (
          <div className="object-view-empty-panel">
            <strong>{descriptor.emptyTitle}</strong>
            <span>{descriptor.emptyDescription}</span>
          </div>
        )}
      </div>
    </section>
  )
}

function GraphSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: GraphSectionIconName
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <GraphSectionIcon icon={icon} />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function GraphSectionIcon({ icon }: { icon: GraphSectionIconName }) {
  const Icon =
    icon === 'relationship'
      ? ObjectRelationshipIcon
      : icon === 'index'
        ? ObjectIndexIcon
        : icon === 'constraint'
          ? ObjectConstraintIcon
          : icon === 'security'
            ? ObjectSecurityIcon
            : icon === 'diagnostics'
              ? ObjectJobIcon
              : ObjectGraphIcon

  return <Icon className="panel-inline-icon" />
}

function GraphObjectViewTable({
  columns,
  rows,
  emptyText,
}: {
  columns: string[]
  rows: string[][]
  emptyText: string
}) {
  if (!rows.length) {
    return <p className="object-view-empty-row">{emptyText}</p>
  }

  return (
    <div className="object-view-table" role="table">
      <div className="object-view-table-row object-view-table-row--head" role="row">
        {columns.map((column) => (
          <span key={column} role="columnheader">{humanizeColumn(column)}</span>
        ))}
      </div>
      {rows.map((row, index) => (
        <div className="object-view-table-row" role="row" key={`${row.join('|')}-${index}`}>
          {row.map((cell, cellIndex) => (
            <span key={`${columns[cellIndex]}-${cellIndex}`} role="cell">{cell}</span>
          ))}
        </div>
      ))}
    </div>
  )
}

function graphWorkflows(
  kind: string,
  descriptor: GraphObjectViewDescriptor,
  hasQueryTarget: boolean,
  engine: ConnectionProfile['engine'],
) {
  const queryLanguage = engine === 'arango' ? 'AQL' : engine === 'neptune' || engine === 'janusgraph' ? 'Gremlin' : 'Cypher'
  const workflows: Array<{
    label: string
    title: string
    icon: GraphSectionIconName
    action?: 'query'
  }> = []

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
      { label: 'Schema', title: 'Review labels, relationship types, and properties.', icon: 'label' },
      { label: 'Indexes', title: 'Review lookup coverage before expensive traversals.', icon: 'index' },
      { label: 'Diagnostics', title: 'Review query, storage, and transaction health.', icon: 'diagnostics' },
    )
  }

  if (['node-label', 'node-labels'].includes(kind)) {
    workflows.push(
      { label: 'Properties', title: 'Review property types and required fields.', icon: 'label' },
      { label: 'Relationships', title: 'Review connected relationship types.', icon: 'relationship' },
      { label: 'Indexes', title: 'Review index and constraint coverage.', icon: 'index' },
    )
  }

  if (['relationship', 'relationship-types'].includes(kind)) {
    workflows.push(
      { label: 'Endpoints', title: 'Review start/end labels and direction.', icon: 'relationship' },
      { label: 'Properties', title: 'Review relationship property keys.', icon: 'label' },
    )
  }

  if (['indexes', 'index', 'constraints', 'constraint'].includes(kind)) {
    workflows.push(
      { label: 'Coverage', title: 'Review labels and properties covered by schema objects.', icon: 'index' },
      { label: 'Preview Changes', title: 'Generate guarded schema-management previews.', icon: 'constraint' },
    )
  }

  if (['security', 'procedures', 'diagnostics'].includes(kind)) {
    workflows.push(
      { label: 'Permissions', title: 'Review visible roles and disabled actions.', icon: 'security' },
      { label: 'Health', title: 'Review runtime and query health signals.', icon: 'diagnostics' },
    )
  }

  return dedupeWorkflows(workflows).slice(0, 5)
}

function graphSections(
  kind: string,
  payload: JsonRecord,
  descriptor: GraphObjectViewDescriptor,
) {
  const sections = graphSectionCandidates(kind).flatMap((candidate) => {
    const rows = arrayOfRecords(payload[candidate.key])
    if (!rows.length) {
      return []
    }

    return [{
      title: candidate.title,
      icon: candidate.icon,
      unit: `${rows.length} row(s)`,
      columns: preferredColumns(rows, candidate.columns),
      rows: tableRows(rows, candidate.columns),
      emptyText: candidate.emptyText,
    }]
  })

  if (!sections.length) {
    const rows = arrayOfRecords(payload.objects)
    if (rows.length) {
      return [{
        title: descriptor.title,
        icon: 'graph' as const,
        unit: `${rows.length} row(s)`,
        columns: preferredColumns(rows, ['name', 'type', 'status', 'detail']),
        rows: tableRows(rows, ['name', 'type', 'status', 'detail']),
        emptyText: descriptor.emptyTitle,
      }]
    }
  }

  return sections
}

function graphSectionCandidates(kind: string) {
  const common = [
    section('graphs', 'Graphs', ['name', 'database', 'nodes', 'relationships', 'labels', 'relationshipTypes'], 'No graphs were returned.'),
    section('nodeLabels', 'Node Labels', ['label', 'count', 'properties', 'indexedProperties', 'constraints'], 'No node labels were returned.', 'label' as const),
    section('relationshipTypes', 'Relationship Types', ['type', 'count', 'from', 'to', 'properties'], 'No relationship types were returned.', 'relationship' as const),
    section('propertyKeys', 'Property Keys', ['name', 'types', 'labels', 'relationshipTypes', 'indexed'], 'No property keys were returned.', 'label' as const),
    section('indexes', 'Indexes', ['name', 'type', 'target', 'properties', 'state', 'provider'], 'No indexes were returned.', 'index' as const),
    section('constraints', 'Constraints', ['name', 'type', 'target', 'properties', 'state'], 'No constraints were returned.', 'constraint' as const),
    section('procedures', 'Procedures', ['name', 'mode', 'signature', 'description', 'requiresAdmin'], 'No procedures were returned.', 'diagnostics' as const),
    section('security', 'Security', ['principal', 'role', 'privilege', 'scope', 'effect'], 'No security metadata was returned.', 'security' as const),
    section('diagnostics', 'Diagnostics', ['signal', 'value', 'status', 'guidance'], 'No diagnostics were returned.', 'diagnostics' as const),
  ]

  if (kind === 'graphs' || kind === 'graph') {
    return common.filter((candidate) => ['graphs', 'nodeLabels', 'relationshipTypes', 'indexes', 'constraints', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'node-label' || kind === 'node-labels') {
    return common.filter((candidate) => ['nodeLabels', 'propertyKeys', 'relationshipTypes', 'indexes', 'constraints', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'relationship' || kind === 'relationship-types') {
    return common.filter((candidate) => ['relationshipTypes', 'propertyKeys', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'property-key' || kind === 'property-keys') {
    return common.filter((candidate) => ['propertyKeys', 'nodeLabels', 'relationshipTypes', 'indexes'].includes(candidate.key))
  }

  if (kind === 'indexes' || kind === 'index') {
    return common.filter((candidate) => candidate.key === 'indexes')
  }

  if (kind === 'constraints' || kind === 'constraint') {
    return common.filter((candidate) => candidate.key === 'constraints')
  }

  if (kind === 'procedures') {
    return common.filter((candidate) => candidate.key === 'procedures')
  }

  if (kind === 'security') {
    return common.filter((candidate) => candidate.key === 'security')
  }

  if (kind === 'diagnostics') {
    return common.filter((candidate) => ['diagnostics', 'procedures'].includes(candidate.key))
  }

  return common
}

function section(
  key: string,
  title: string,
  columns: string[],
  emptyText: string,
  icon: GraphSectionIconName = 'graph',
) {
  return { key, title, columns, emptyText, icon }
}

function graphMetricCards(payload: JsonRecord, connection: ConnectionProfile) {
  const cards: Array<{ label: string; value: string }> = []
  const entries: Array<[string, string[]]> = [
    ['Graph', ['graphName', 'database', 'graph']],
    ['Nodes', ['nodeCount', 'nodes']],
    ['Relationships', ['relationshipCount', 'relationships']],
    ['Labels', ['labelCount']],
    ['Types', ['relationshipTypeCount']],
    ['Indexes', ['indexCount']],
    ['Constraints', ['constraintCount']],
    ['Engine', ['engine']],
  ]

  for (const [label, keys] of entries) {
    const value = keys.map((key) => payload[key]).find((candidate) => hasDisplayValue(candidate))
    if (hasDisplayValue(value)) {
      cards.push({ label, value: displayValue(value) })
    }
  }

  if (!cards.some((card) => card.label === 'Engine')) {
    cards.push({ label: 'Engine', value: connection.engine })
  }

  return cards.slice(0, 8)
}

function graphQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state?.queryTemplate) {
    return undefined
  }

  return {
    kind: state.kind,
    label: state.label,
    path: state.path,
    queryTemplate: state.queryTemplate,
  }
}

function GraphWarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) {
    return null
  }

  return (
    <div className="object-view-warning-list">
      {warnings.map((warning) => (
        <div className="object-view-warning" key={warning}>
          <WarningIcon className="panel-inline-icon" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  )
}

function graphWarnings(tab: QueryTabState, payload: JsonRecord) {
  const warnings = [
    ...(tab.objectViewState?.warnings ?? []),
    ...arrayOfStrings(payload.warnings),
    ...arrayOfRecords(payload.permissionWarnings).map((warning) => displayValue(warning.message ?? warning.reason ?? warning)),
  ]

  return [...new Set(warnings.filter(Boolean))]
}

function tableRows(rows: JsonRecord[], columns: string[]) {
  return rows.map((row) => columns.map((column) => displayCell(row[column], column)))
}

function preferredColumns(rows: JsonRecord[], preferred: string[]) {
  const available = new Set(rows.flatMap((row) => Object.keys(row)))
  const selected = preferred.filter((column) => available.has(column))
  if (selected.length) {
    return selected
  }

  return Array.from(available).slice(0, 5)
}

function displayCell(value: unknown, column: string) {
  if (/signature|properties|labels|relationshipTypes|query|definition/i.test(column) && value && typeof value === 'object') {
    return Array.isArray(value)
      ? `JSON array (${value.length} item${value.length === 1 ? '' : 's'})`
      : `JSON object (${Object.keys(value as JsonRecord).length} field${Object.keys(value as JsonRecord).length === 1 ? '' : 's'})`
  }

  return displayValue(value)
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-'
  }

  if (Array.isArray(value)) {
    return value.map(displayValue).join(', ')
  }

  if (typeof value === 'object') {
    return objectSummary(value)
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }

  return String(value)
}

function objectSummary(value: object) {
  const keys = Object.keys(value as JsonRecord)
  return keys.length
    ? `${keys.length} field${keys.length === 1 ? '' : 's'}: ${keys.slice(0, 4).map(humanizeColumn).join(', ')}`
    : 'Object'
}

function hasDisplayValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

function humanizeColumn(column: string) {
  return column
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
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
