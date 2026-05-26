import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  ObjectCollectionIcon,
  ObjectDatabaseIcon,
  ObjectDocumentIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectStageIcon,
  PlayIcon,
  RefreshIcon,
  WarningIcon,
} from './icons'
import {
  getCosmosObjectViewDescriptor,
  type CosmosObjectViewDescriptor,
} from './CosmosObjectViewDescriptors'
import { ExplorerNodeIcon } from './SideBar.node-icons'

type JsonRecord = Record<string, unknown>
type CosmosSectionIconName =
  | 'account'
  | 'collection'
  | 'document'
  | 'index'
  | 'throughput'
  | 'security'
  | 'diagnostics'
  | 'region'

interface CosmosObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
}

export function CosmosObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
}: CosmosObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'account')
  const descriptor = getCosmosObjectViewDescriptor(kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => cosmosQueryTargetFromObjectView(tab), [tab])
  const workflows = cosmosWorkflows(kind, descriptor, Boolean(queryTarget))
  const cards = cosmosMetricCards(payload, connection)
  const sections = cosmosSections(kind, payload, descriptor)

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

      <CosmosWarningList warnings={cosmosWarnings(tab, payload)} />

      <div className="object-view-body">
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => {
                const chip = (
                  <>
                    <CosmosSectionIcon icon={workflow.icon} />
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
            <CosmosSectionHeading icon="account" title="At a Glance" />
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
              <CosmosSectionHeading icon={section.icon} title={section.title} unit={section.unit} />
              <CosmosObjectViewTable columns={section.columns} rows={section.rows} emptyText={section.emptyText} />
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

function CosmosSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: CosmosSectionIconName
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <CosmosSectionIcon icon={icon} />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function CosmosSectionIcon({ icon }: { icon: CosmosSectionIconName }) {
  const Icon =
    icon === 'collection'
      ? ObjectCollectionIcon
      : icon === 'document'
        ? ObjectDocumentIcon
        : icon === 'index'
          ? ObjectIndexIcon
          : icon === 'throughput'
            ? ObjectJobIcon
            : icon === 'security'
              ? ObjectSecurityIcon
              : icon === 'region'
                ? ObjectStageIcon
                : icon === 'diagnostics'
                  ? ObjectMetricIcon
                  : ObjectDatabaseIcon

  return <Icon className="panel-inline-icon" />
}

function CosmosObjectViewTable({
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

function cosmosWorkflows(
  kind: string,
  descriptor: CosmosObjectViewDescriptor,
  hasQueryTarget: boolean,
) {
  const workflows: Array<{
    label: string
    title: string
    icon: CosmosSectionIconName
    action?: 'query'
  }> = []

  if (hasQueryTarget && descriptor.primaryQueryLabel) {
    workflows.push({
      label: descriptor.primaryQueryLabel,
      title: 'Open a bounded Cosmos DB item query for this container.',
      icon: 'document',
      action: 'query',
    })
  }

  if (['account', 'databases', 'database'].includes(kind)) {
    workflows.push(
      { label: 'Databases', title: 'Review database and container inventory.', icon: 'account' },
      { label: 'Regions', title: 'Review read and write region posture.', icon: 'region' },
      { label: 'Consistency', title: 'Review default consistency and session behavior.', icon: 'throughput' },
    )
  }

  if (['container', 'containers', 'items'].includes(kind)) {
    workflows.push(
      { label: 'Partition Key', title: 'Review partition routing and hot key hints.', icon: 'collection' },
      { label: 'Indexing', title: 'Review included, excluded, and composite index paths.', icon: 'index' },
      { label: 'Throughput', title: 'Review RU/s, throttles, and cost-risk hints.', icon: 'throughput' },
    )
  }

  if (['stored-procedures', 'triggers', 'udfs'].includes(kind)) {
    workflows.push(
      { label: 'Scripts', title: 'Review server-side JavaScript assets.', icon: 'document' },
      { label: 'Guarded Preview', title: 'Create, replace, and delete actions stay preview-first.', icon: 'security' },
    )
  }

  if (['diagnostics', 'throughput', 'regions'].includes(kind)) {
    workflows.push(
      { label: 'RU Usage', title: 'Review request-unit consumption and throttles.', icon: 'throughput' },
      { label: 'Latency', title: 'Review region and operation latency signals.', icon: 'diagnostics' },
    )
  }

  return dedupeWorkflows(workflows).slice(0, 5)
}

function cosmosSections(
  kind: string,
  payload: JsonRecord,
  descriptor: CosmosObjectViewDescriptor,
) {
  const sections: Array<{
    title: string
    icon: CosmosSectionIconName
    unit?: string
    columns: string[]
    rows: string[][]
    emptyText: string
  }> = []
  const databases = rowsFromRecords(payload.databases, ['name', 'containers', 'throughput', 'storage'])
  const containers = rowsFromRecords(payload.containers, ['name', 'partitionKey', 'throughput', 'items', 'ttl'])
  const partitionKeys = rowsFromRecords(payload.partitionKeys, ['path', 'kind', 'hotPartitionRisk', 'guidance'])
  const indexing = rowsFromRecords(payload.indexingPolicy, ['path', 'mode', 'kind', 'precision'])
  const throughput = rowsFromRecords(payload.throughput, ['scope', 'mode', 'ruPerSecond', 'throttles'])
  const regions = rowsFromRecords(payload.regions, ['name', 'role', 'priority', 'status'])
  const consistency = rowsFromRecords(payload.consistency, ['setting', 'value', 'guidance'])
  const scripts = rowsFromRecords(payload.scripts, ['type', 'name', 'operation', 'status'])
  const security = rowsFromRecords(payload.security, ['name', 'kind', 'scope', 'status'])
  const diagnostics = rowsFromRecords(payload.diagnostics, ['signal', 'value', 'status', 'guidance'])

  if (['account', 'databases'].includes(kind)) {
    sections.push({ title: 'Databases', icon: 'account', columns: ['name', 'containers', 'throughput', 'storage'], rows: databases, emptyText: descriptor.emptyDescription })
  }

  if (['account', 'database', 'containers', 'container'].includes(kind)) {
    sections.push({ title: 'Containers', icon: 'collection', columns: ['name', 'partitionKey', 'throughput', 'items', 'ttl'], rows: containers, emptyText: descriptor.emptyDescription })
  }

  if (['container', 'items', 'partition-key'].includes(kind)) {
    sections.push({ title: 'Partition Key', icon: 'collection', columns: ['path', 'kind', 'hotPartitionRisk', 'guidance'], rows: partitionKeys, emptyText: descriptor.emptyDescription })
  }

  if (['container', 'indexing-policy'].includes(kind)) {
    sections.push({ title: 'Indexing Policy', icon: 'index', columns: ['path', 'mode', 'kind', 'precision'], rows: indexing, emptyText: descriptor.emptyDescription })
  }

  if (['account', 'database', 'container', 'throughput'].includes(kind)) {
    sections.push({ title: 'Throughput', icon: 'throughput', columns: ['scope', 'mode', 'ruPerSecond', 'throttles'], rows: throughput, emptyText: descriptor.emptyDescription })
  }

  if (['account', 'regions'].includes(kind)) {
    sections.push({ title: 'Regions', icon: 'region', columns: ['name', 'role', 'priority', 'status'], rows: regions, emptyText: descriptor.emptyDescription })
  }

  if (['account', 'consistency'].includes(kind)) {
    sections.push({ title: 'Consistency', icon: 'throughput', columns: ['setting', 'value', 'guidance'], rows: consistency, emptyText: descriptor.emptyDescription })
  }

  if (['container', 'stored-procedures', 'triggers', 'udfs'].includes(kind)) {
    sections.push({ title: 'Server-Side Scripts', icon: 'document', columns: ['type', 'name', 'operation', 'status'], rows: scripts, emptyText: descriptor.emptyDescription })
  }

  if (['account', 'database', 'container', 'security'].includes(kind)) {
    sections.push({ title: 'Security', icon: 'security', columns: ['name', 'kind', 'scope', 'status'], rows: security, emptyText: descriptor.emptyDescription })
  }

  if (['account', 'database', 'container', 'diagnostics', 'change-feed', 'conflicts'].includes(kind)) {
    sections.push({ title: 'Diagnostics', icon: 'diagnostics', columns: ['signal', 'value', 'status', 'guidance'], rows: diagnostics, emptyText: descriptor.emptyDescription })
  }

  return sections.filter((section) => section.rows.length || kind === section.icon)
}

function cosmosQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  const kind = normalizeKind(state?.kind ?? '')

  if (!state || !['container', 'items'].includes(kind)) {
    return undefined
  }

  return {
    kind: 'collection',
    label: state.label,
    path: state.path,
    scope: state.nodeId,
    queryTemplate: state.queryTemplate,
  }
}

function cosmosMetricCards(payload: JsonRecord, connection: ConnectionProfile) {
  return [
    { label: 'Account', value: payload.accountName ?? connection.host ?? connection.name },
    { label: 'API', value: payload.api ?? 'NoSQL' },
    { label: 'Databases', value: payload.databaseCount },
    { label: 'Containers', value: payload.containerCount },
    { label: 'RU/s', value: payload.totalThroughput },
    { label: 'Region', value: payload.writeRegion },
  ].map((card) => ({ label: card.label, value: formatValue(card.value) }))
    .filter((card) => card.value !== '-')
}

function CosmosWarningList({ warnings }: { warnings: string[] }) {
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

function cosmosWarnings(tab: QueryTabState, payload: JsonRecord) {
  return Array.from(new Set([
    ...(tab.objectViewState?.warnings ?? []),
    ...stringArray(payload.warnings),
  ]))
}

function rowsFromRecords(value: unknown, columns: string[]) {
  return recordsFromUnknown(value).map((record) =>
    columns.map((column) => formatValue(record[column])),
  )
}

function recordsFromUnknown(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : typeof value === 'string' && value.trim()
      ? [value.trim()]
      : []
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

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-'
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatValue(item)).join(', ')
  }

  if (typeof value === 'object') {
    return Object.entries(value as JsonRecord)
      .map(([key, item]) => `${key}: ${formatValue(item)}`)
      .join(', ')
  }

  return String(value)
}

function humanizeColumn(column: string) {
  return column
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
