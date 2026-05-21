import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
  PlayIcon,
  RefreshIcon,
  WarningIcon,
} from './icons'
import {
  getCockroachObjectViewDescriptor,
  type CockroachObjectViewDescriptor,
} from './CockroachObjectViewDescriptors'
import {
  getPostgresObjectViewDescriptor,
  type PostgresObjectViewDescriptor,
} from './PostgresObjectViewDescriptors'
import {
  getSqlServerObjectViewDescriptor,
  type SqlServerObjectViewDescriptor,
} from './SqlServerObjectViewDescriptors'
import { ExplorerNodeIcon } from './SideBar.node-icons'

type JsonRecord = Record<string, unknown>
type RelationalObjectViewDescriptor =
  | CockroachObjectViewDescriptor
  | PostgresObjectViewDescriptor
  | SqlServerObjectViewDescriptor

interface RelationalObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
}

export function RelationalObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
}: RelationalObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'object')
  const descriptor = descriptorForConnection(connection, kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => relationalQueryTargetFromObjectView(tab), [tab])
  const summary = relationalObjectViewSummary(state?.summary, descriptor)
  const sections = relationalSections(kind, payload, descriptor)
  const cards = metricCardsForPayload(kind, payload, connection)

  return (
    <section className="object-view-workspace" aria-label={`${descriptor.title} object view`}>
      <RelationalObjectViewHeader
        connection={connection}
        environment={environment}
        kind={kind}
        path={state?.path}
        title={descriptor.title}
        refreshing={refreshing}
        onRefresh={refresh}
      >
        {queryTarget && descriptor.primaryQueryLabel ? (
          <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
            <PlayIcon className="panel-inline-icon" />
            {descriptor.primaryQueryLabel}
          </button>
        ) : null}
      </RelationalObjectViewHeader>

      <div className="object-view-purpose">
        <strong>{state?.label && state.label !== descriptor.title ? state.label : descriptor.menuLabel}</strong>
        <span>{descriptor.purpose}</span>
      </div>
      {summary ? <p className="object-view-summary">{summary}</p> : null}
      <WarningList warnings={objectViewWarnings(tab, payload)} />

      <div className="object-view-body">
        {cards.length ? (
          <section className="object-view-section">
            <ObjectViewSectionHeading
              icon={kind.includes('index') ? 'index' : kind.includes('security') ? 'security' : 'table'}
              title="At a Glance"
            />
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
              <ObjectViewSectionHeading
                icon={section.icon}
                title={section.title}
                unit={section.unit}
              />
              <ObjectViewTable
                columns={section.columns}
                rows={section.rows}
                emptyText={section.emptyText}
              />
            </section>
          ))
        ) : (
          <PurposeEmptyState descriptor={descriptor} />
        )}
      </div>
    </section>
  )
}

function RelationalObjectViewHeader({
  children,
  connection,
  environment,
  kind,
  path,
  title,
  refreshing,
  onRefresh,
}: {
  children?: ReactNode
  connection: ConnectionProfile
  environment: EnvironmentProfile
  kind: string
  path?: string[]
  title: string
  refreshing: boolean
  onRefresh(): void
}) {
  return (
    <div className="object-view-toolbar">
      <div className="object-view-heading">
        <ExplorerNodeIcon connection={connection} kind={kind} />
        <div>
          <strong>{title}</strong>
          <span>
            {[connection.name, environment.label, ...(path ?? [])].filter(Boolean).join(' / ')}
          </span>
        </div>
      </div>
      <div className="object-view-actions">
        {children}
        <button type="button" className="drawer-button" disabled={refreshing} onClick={onRefresh}>
          <RefreshIcon className="panel-inline-icon" />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}

function ObjectViewSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: 'table' | 'index' | 'security' | 'job'
  title: string
  unit?: string
}) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'job'
          ? ObjectJobIcon
          : ObjectTableIcon

  return (
    <div className="object-view-section-heading">
      <Icon className="panel-inline-icon" />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function relationalSections(
  kind: string,
  payload: JsonRecord,
  descriptor: RelationalObjectViewDescriptor,
) {
  const candidates = sectionCandidates(kind)
  const sections = candidates.flatMap((candidate) => {
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
    const genericRows = arrayOfRecords(payload.objects)
    if (genericRows.length) {
      return [{
        title: descriptor.title,
        icon: 'table' as const,
        unit: `${genericRows.length} row(s)`,
        columns: preferredColumns(genericRows, ['name', 'type', 'status', 'detail']),
        rows: tableRows(genericRows, ['name', 'type', 'status', 'detail']),
        emptyText: descriptor.emptyTitle,
      }]
    }
  }

  return sections
}

function sectionCandidates(kind: string) {
  const common = [
    section('databases', 'Databases', ['name', 'state', 'owner', 'size', 'readOnly'], 'No databases were returned.'),
    section('schemas', 'Schemas', ['name', 'owner', 'type', 'objectCount'], 'No schemas were returned.'),
    section('tables', 'Tables', ['schema', 'name', 'type', 'rows', 'size', 'owner'], 'No tables were returned.'),
    section('views', 'Views', ['schema', 'name', 'definition', 'status'], 'No views were returned.'),
    section('materializedViews', 'Materialized Views', ['schema', 'name', 'rows', 'size', 'lastRefresh'], 'No materialized views were returned.'),
    section('columns', 'Columns', ['name', 'type', 'nullable', 'default', 'identity', 'collation'], 'No columns were returned.'),
    section('indexes', 'Indexes', ['name', 'type', 'columns', 'unique', 'valid', 'size', 'usage'], 'No indexes were returned.', 'index' as const),
    section('constraints', 'Constraints', ['name', 'type', 'columns', 'status', 'definition'], 'No constraints were returned.'),
    section('triggers', 'Triggers', ['name', 'timing', 'event', 'enabled', 'function'], 'No triggers were returned.'),
    section('functions', 'Functions', ['schema', 'name', 'arguments', 'returns', 'language', 'volatility'], 'No functions were returned.'),
    section('procedures', 'Procedures', ['schema', 'name', 'arguments', 'language', 'security'], 'No procedures were returned.'),
    section('routines', 'Routines', ['schema', 'name', 'type', 'arguments', 'returns', 'language'], 'No routines were returned.'),
    section('sequences', 'Sequences', ['schema', 'name', 'dataType', 'increment', 'cache', 'cycles'], 'No sequences were returned.'),
    section('types', 'Types', ['schema', 'name', 'type', 'owner'], 'No types were returned.'),
    section('extensions', 'Extensions', ['name', 'version', 'schema', 'description'], 'No extensions were returned.'),
    section('statistics', 'Statistics', ['name', 'rows', 'scans', 'lastVacuum', 'lastAnalyze', 'size'], 'No statistics were returned.'),
    section('permissions', 'Permissions', ['principal', 'privilege', 'object', 'state', 'grantor'], 'No permissions were returned.', 'security' as const),
    section('roles', 'Roles', ['name', 'login', 'superuser', 'inherit', 'memberships'], 'No roles were returned.', 'security' as const),
    section('users', 'Users', ['name', 'type', 'defaultSchema', 'authenticationType'], 'No users were returned.', 'security' as const),
    section('nodes', 'Nodes', ['nodeId', 'address', 'locality', 'ranges', 'liveBytes', 'status'], 'No nodes were returned.', 'job' as const),
    section('ranges', 'Ranges', ['rangeId', 'table', 'replicas', 'leaseholder', 'qps', 'size'], 'No ranges were returned.', 'job' as const),
    section('regions', 'Regions / Localities', ['region', 'locality', 'nodes', 'survivalGoal', 'constraints'], 'No regions were returned.', 'job' as const),
    section('jobs', 'Jobs', ['id', 'type', 'status', 'fractionCompleted', 'created', 'modified'], 'No jobs were returned.', 'job' as const),
    section('contention', 'Contention', ['key', 'table', 'waiter', 'durationMs', 'blockingTxn'], 'No contention rows were returned.', 'job' as const),
    section('transactions', 'Transactions', ['id', 'state', 'age', 'priority', 'retries'], 'No transactions were returned.', 'job' as const),
    section('statements', 'Statement Stats', ['query', 'count', 'meanMs', 'p99Ms', 'rows', 'retries'], 'No statement stats were returned.', 'job' as const),
    section('clusterSettings', 'Cluster Settings', ['name', 'value', 'type', 'description'], 'No cluster settings were returned.'),
    section('zoneConfigurations', 'Zone Configurations', ['target', 'numReplicas', 'constraints', 'leasePreferences', 'gcTtlSeconds'], 'No zone configurations were returned.'),
    section('sessions', 'Sessions', ['pid', 'sessionId', 'user', 'database', 'state', 'wait', 'blockedBy'], 'No sessions were returned.', 'job' as const),
    section('locks', 'Locks', ['pid', 'sessionId', 'object', 'mode', 'granted', 'blocking'], 'No locks were returned.', 'job' as const),
    section('queryStore', 'Query Store', ['name', 'status', 'durationMs', 'executions', 'planState'], 'No Query Store rows were returned.', 'job' as const),
    section('files', 'Files', ['name', 'type', 'size', 'growth', 'state'], 'No files were returned.'),
    section('filegroups', 'Filegroups', ['name', 'type', 'default', 'readOnly'], 'No filegroups were returned.'),
  ]

  if (kind === 'cluster') {
    return common.filter((candidate) =>
      ['nodes', 'ranges', 'regions', 'jobs', 'clusterSettings'].includes(candidate.key),
    )
  }

  if (kind === 'diagnostics') {
    return common.filter((candidate) =>
      ['sessions', 'locks', 'statistics', 'queryStore', 'statements', 'transactions', 'contention'].includes(candidate.key),
    )
  }

  if (kind === 'security') {
    return common.filter((candidate) => ['users', 'roles', 'permissions', 'schemas'].includes(candidate.key))
  }

  if (kind === 'storage') {
    return common.filter((candidate) => ['files', 'filegroups', 'statistics'].includes(candidate.key))
  }

  return common
}

function section(
  key: string,
  title: string,
  columns: string[],
  emptyText: string,
  icon: 'table' | 'index' | 'security' | 'job' = 'table',
) {
  return { key, title, columns, emptyText, icon }
}

function metricCardsForPayload(
  kind: string,
  payload: JsonRecord,
  connection: ConnectionProfile,
) {
  const cards: Array<{ label: string; value: string }> = []
  const entries: Array<[string, string[]]> = [
    ['Database', ['database', 'databaseName']],
    ['Schema', ['schema', 'schemaName']],
    ['Object', ['objectName', 'tableName', 'viewName', 'routineName']],
    ['Rows', ['rowCount', 'rows', 'estimatedRows']],
    ['Size', ['size', 'totalSize', 'databaseSize']],
    ['Tables', ['tableCount']],
    ['Indexes', ['indexCount']],
    ['Sessions', ['activeSessions', 'sessionCount']],
    ['Blocked', ['blockedSessions']],
    ['Nodes', ['nodeCount']],
    ['Ranges', ['rangeCount']],
    ['Regions', ['regionCount']],
    ['Jobs', ['jobCount']],
    ['Retries', ['retryCount']],
    ['Engine', ['engine']],
  ]

  for (const [label, keys] of entries) {
    const value = keys.map((key) => payload[key]).find((candidate) => hasDisplayValue(candidate))
    if (hasDisplayValue(value)) {
      cards.push({ label, value: displayValue(value) })
    }
  }

  if (!cards.some((card) => card.label === 'Engine')) {
    cards.push({
      label: 'Engine',
      value: relationalEngineLabel(connection),
    })
  }

  if (!cards.length && kind) {
    cards.push({ label: 'Object Type', value: kind })
  }

  return cards.slice(0, 8)
}

function relationalQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state?.queryTemplate) {
    return undefined
  }

  return {
    kind: state.kind,
    label: state.label,
    path: state.path,
    queryTemplate: state.queryTemplate,
    preferredBuilder: undefined,
  }
}

function descriptorForConnection(
  connection: ConnectionProfile,
  kind: string,
): RelationalObjectViewDescriptor {
  if (connection.engine === 'sqlserver') {
    return getSqlServerObjectViewDescriptor(kind)
  }

  if (connection.engine === 'cockroachdb') {
    return getCockroachObjectViewDescriptor(kind)
  }

  return getPostgresObjectViewDescriptor(kind)
}

function relationalEngineLabel(connection: ConnectionProfile) {
  if (connection.engine === 'sqlserver') {
    return 'SQL Server / Azure SQL'
  }

  if (connection.engine === 'cockroachdb') {
    return 'CockroachDB'
  }

  if (connection.engine === 'timescaledb') {
    return 'TimescaleDB'
  }

  return 'PostgreSQL'
}

function PurposeEmptyState({ descriptor }: { descriptor: RelationalObjectViewDescriptor }) {
  return (
    <div className="object-view-empty-panel">
      <strong>{descriptor.emptyTitle}</strong>
      <span>{descriptor.emptyDescription}</span>
    </div>
  )
}

function ObjectViewTable({
  columns,
  rows,
  emptyText,
}: {
  columns: string[]
  rows: string[][]
  emptyText: string
}) {
  if (!rows.length) {
    return <p className="object-view-empty">{emptyText}</p>
  }

  return (
    <div className="object-view-table-wrap">
      <table className="object-view-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{labelForColumn(column)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}:${row.join('|')}`}>
              {columns.map((column, columnIndex) => (
                <td key={column}>{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) {
    return null
  }

  return (
    <div className="object-view-warning-list">
      {warnings.map((warning) => (
        <div key={warning} className="object-view-warning">
          <WarningIcon className="panel-inline-icon" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  )
}

function preferredColumns(rows: JsonRecord[], preferred: string[]) {
  const available = new Set(rows.flatMap((row) => Object.keys(row)))
  const preferredAvailable = preferred.filter((key) => available.has(key))
  const extras = [...available].filter((key) => !preferredAvailable.includes(key)).slice(0, 4)
  return [...preferredAvailable, ...extras].slice(0, 8)
}

function tableRows(rows: JsonRecord[], preferred: string[]) {
  const columns = preferredColumns(rows, preferred)
  return rows.map((row) => columns.map((column) => displayValue(row[column])))
}

function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function hasDisplayValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString() : String(value)
  }

  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(displayValue).filter(Boolean).join(', ')
  }

  return Object.entries(asRecord(value))
    .map(([key, nested]) => `${key}: ${displayValue(nested)}`)
    .join(', ')
}

function labelForColumn(column: string) {
  return column
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function objectViewWarnings(tab: QueryTabState, payload: JsonRecord) {
  const payloadWarnings = Array.isArray(payload.warnings)
    ? payload.warnings.map(displayValue)
    : []

  return [
    ...(tab.objectViewState?.warnings ?? []),
    ...(tab.error?.message ? [tab.error.message] : []),
    ...(typeof payload.warning === 'string' ? [payload.warning] : []),
    ...payloadWarnings,
  ].filter(Boolean)
}

function relationalObjectViewSummary(
  summary: string | undefined,
  descriptor: RelationalObjectViewDescriptor,
) {
  if (!summary) {
    return ''
  }

  if (/inspection metadata is not available/i.test(summary)) {
    return `${descriptor.emptyTitle}. ${descriptor.emptyDescription}`
  }

  return summary
}

function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
