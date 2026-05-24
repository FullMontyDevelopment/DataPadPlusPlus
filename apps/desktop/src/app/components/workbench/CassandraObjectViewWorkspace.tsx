import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  ObjectDatabaseIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
  PlayIcon,
  RefreshIcon,
  WarningIcon,
} from './icons'
import {
  getCassandraObjectViewDescriptor,
  type CassandraObjectViewDescriptor,
} from './CassandraObjectViewDescriptors'
import { ExplorerNodeIcon } from './SideBar.node-icons'

type JsonRecord = Record<string, unknown>
type CassandraSectionIconName = 'database' | 'table' | 'index' | 'security' | 'job'

interface CassandraObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
}

export function CassandraObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
}: CassandraObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'object')
  const descriptor = getCassandraObjectViewDescriptor(kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => cassandraQueryTargetFromObjectView(tab), [tab])
  const workflows = cassandraWorkflows(kind, descriptor, Boolean(queryTarget))
  const cards = cassandraMetricCards(payload)
  const sections = cassandraSections(kind, payload, descriptor)

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
      <CassandraWarningList warnings={cassandraWarnings(tab, payload)} />

      <div className="object-view-body">
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => {
                const chip = (
                  <>
                    <CassandraSectionIcon icon={workflow.icon} />
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
            <CassandraSectionHeading icon="database" title="At a Glance" />
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
              <CassandraSectionHeading icon={section.icon} title={section.title} unit={section.unit} />
              <CassandraObjectViewTable columns={section.columns} rows={section.rows} emptyText={section.emptyText} />
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

function CassandraSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: CassandraSectionIconName
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <CassandraSectionIcon icon={icon} />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function CassandraSectionIcon({ icon }: { icon: CassandraSectionIconName }) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'job'
          ? ObjectJobIcon
          : icon === 'database'
            ? ObjectDatabaseIcon
            : ObjectTableIcon

  return <Icon className="panel-inline-icon" />
}

function CassandraObjectViewTable({
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

function cassandraWorkflows(
  kind: string,
  descriptor: CassandraObjectViewDescriptor,
  hasQueryTarget: boolean,
) {
  const workflows: Array<{
    label: string
    title: string
    icon: CassandraSectionIconName
    action?: 'query'
  }> = []

  if (hasQueryTarget && descriptor.primaryQueryLabel) {
    workflows.push({
      label: descriptor.primaryQueryLabel,
      title: 'Open a CQL partition-key query builder for this object.',
      icon: 'table',
      action: 'query',
    })
  }

  if (['table', 'columns', 'primary-key', 'statistics', 'compaction'].includes(kind)) {
    workflows.push(
      { label: 'Review Keys', title: 'Check partition and clustering key order before querying.', icon: 'index' },
      { label: 'Preview Edits', title: 'Safe row edits require complete primary-key predicates.', icon: 'security' },
    )
  }

  if (['keyspace', 'security', 'permissions'].includes(kind)) {
    workflows.push({ label: 'Review Grants', title: 'Inspect roles and grants visible to this connection.', icon: 'security' })
  }

  if (['diagnostics', 'cluster', 'tracing', 'repairs'].includes(kind)) {
    workflows.push({ label: 'Check Health', title: 'Inspect latency, repair, and node-level warning signals.', icon: 'job' })
  }

  return workflows
}

function cassandraSections(
  kind: string,
  payload: JsonRecord,
  descriptor: CassandraObjectViewDescriptor,
) {
  const sections: Array<{
    title: string
    icon: CassandraSectionIconName
    columns: string[]
    rows: string[][]
    emptyText: string
    unit?: string
  }> = []

  addRows(sections, 'Tables', 'table', ['name', 'partitionKey', 'clusteringKey', 'readPath'], payload.tables, descriptor.emptyDescription)
  addRows(sections, 'Columns', 'table', ['name', 'role', 'type', 'clusteringOrder'], payload.columns, 'No column metadata is available.')
  addRows(sections, 'Primary Key', 'index', ['role', 'name', 'position', 'type'], payload.primaryKey, 'No primary-key metadata is available.')
  addRows(sections, 'Indexes', 'index', ['name', 'kind', 'target', 'options'], payload.indexes, 'No index metadata is available.')
  addRows(sections, 'Materialized Views', 'table', ['name', 'baseTable', 'primaryKey', 'includedColumns'], payload.materializedViews, 'No materialized views are available.')
  addRows(sections, 'Types', 'table', ['name', 'fields'], payload.types, 'No user-defined types are available.')
  addRows(sections, 'Functions', 'job', ['name', 'signature', 'language', 'returnType'], payload.functions, 'No functions are available.')
  addRows(sections, 'Aggregates', 'job', ['name', 'stateFunction', 'finalFunction', 'returnType'], payload.aggregates, 'No aggregates are available.')
  addRows(sections, 'Table Options', 'table', ['option', 'value', 'guidance'], payload.options, 'No table options were returned.')
  addRows(sections, 'Permissions', 'security', ['role', 'resource', 'permission'], payload.permissions, 'No permissions were returned.')
  addRows(sections, 'Cluster Nodes', 'database', ['node', 'datacenter', 'status', 'tokens', 'load'], payload.nodes, 'No cluster nodes were returned.')
  addRows(sections, 'Diagnostics', 'job', ['signal', 'value', 'status', 'guidance'], payload.diagnostics, 'No diagnostics were returned.')
  addRows(sections, 'Warnings', 'security', ['warning', 'scope', 'guidance'], payload.warningRows, 'No warnings were returned.')

  if (!sections.length && Object.keys(payload).length > 0) {
    sections.push({
      title: descriptor.title,
      icon: kind.includes('security') ? 'security' : 'table',
      columns: ['field', 'summary'],
      rows: Object.entries(payload).map(([field, value]) => [field, summarizeValue(value)]),
      emptyText: descriptor.emptyDescription,
    })
  }

  return sections
}

function addRows(
  sections: Array<{
    title: string
    icon: CassandraSectionIconName
    columns: string[]
    rows: string[][]
    emptyText: string
    unit?: string
  }>,
  title: string,
  icon: CassandraSectionIconName,
  columns: string[],
  value: unknown,
  emptyText: string,
) {
  const rows = arrayOfRecords(value).map((row) =>
    columns.map((column) => summarizeValue(row[column])),
  )

  if (rows.length) {
    sections.push({ title, icon, columns, rows, emptyText })
  }
}

function cassandraMetricCards(payload: JsonRecord) {
  return [
    metricCard('Tables', payload.tableCount, 'tables'),
    metricCard('Partitions', payload.partitionCount, 'partitions'),
    metricCard('SSTables', payload.sstableCount, 'sstables'),
    metricCard('Indexes', payload.indexCount, 'indexes'),
    metricCard('Replication', payload.replication, undefined),
    metricCard('P95 Read', payload.p95ReadMs, 'ms'),
    metricCard('Tombstones', payload.tombstoneWarningCount, 'warnings'),
  ].filter((card): card is { label: string; value: string } => Boolean(card))
}

function metricCard(label: string, value: unknown, unit?: string) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return {
    label,
    value: unit ? `${summarizeValue(value)} ${unit}` : summarizeValue(value),
  }
}

function cassandraQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state || !['table', 'data', 'materialized-view'].includes(normalizeKind(state.kind))) {
    return undefined
  }

  const { keyspace, table } = cassandraTargetParts(state)
  if (!table) {
    return undefined
  }

  return {
    kind: state.kind,
    label: table,
    path: state.path,
    scope: `table:${keyspace}.${table}`,
    queryTemplate: state.queryTemplate ?? `select * from "${keyspace}"."${table}" limit 20;`,
    preferredBuilder: 'cql-partition',
  }
}

function cassandraTargetParts(state: NonNullable<QueryTabState['objectViewState']>) {
  const [kind, keyspaceFromNode, tableFromNode] = state.nodeId.split(':')
  const path = state.path ?? []
  const table =
    tableFromNode ||
    (kind === 'table' || state.kind === 'table' || state.kind === 'data' || state.kind === 'materialized-view'
      ? state.label
      : undefined)
  const keyspace = keyspaceFromNode || path.find((segment) => segment !== state.label && segment !== 'Keyspaces') || 'app'

  return { keyspace, table }
}

function CassandraWarningList({ warnings }: { warnings: string[] }) {
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

function cassandraWarnings(tab: QueryTabState, payload: JsonRecord) {
  return [
    ...(tab.objectViewState?.warnings ?? []),
    ...arrayOfStrings(payload.warnings),
  ]
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function humanizeColumn(column: string) {
  return column.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toUpperCase()
}

function summarizeValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-'
  }

  if (Array.isArray(value)) {
    return value.map(summarizeValue).join(', ')
  }

  if (typeof value === 'object') {
    const count = Object.keys(value as JsonRecord).length
    return `JSON object (${count} field${count === 1 ? '' : 's'})`
  }

  return String(value)
}

function normalizeKind(kind: string | undefined) {
  return (kind ?? 'object').trim().toLowerCase().replace(/_/g, '-')
}
