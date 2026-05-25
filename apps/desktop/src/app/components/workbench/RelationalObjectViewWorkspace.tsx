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
  getDuckDbObjectViewDescriptor,
  type DuckDbObjectViewDescriptor,
} from './DuckDbObjectViewDescriptors'
import {
  getPostgresObjectViewDescriptor,
  type PostgresObjectViewDescriptor,
} from './PostgresObjectViewDescriptors'
import {
  getMysqlObjectViewDescriptor,
  type MysqlObjectViewDescriptor,
} from './MysqlObjectViewDescriptors'
import {
  getSqlServerObjectViewDescriptor,
  type SqlServerObjectViewDescriptor,
} from './SqlServerObjectViewDescriptors'
import {
  getSqliteObjectViewDescriptor,
  type SqliteObjectViewDescriptor,
} from './SqliteObjectViewDescriptors'
import { RelationalSourcePreview } from './RelationalSourcePreview'
import { ExplorerNodeIcon } from './SideBar.node-icons'

type JsonRecord = Record<string, unknown>
type RelationalObjectViewDescriptor =
  | CockroachObjectViewDescriptor
  | DuckDbObjectViewDescriptor
  | MysqlObjectViewDescriptor
  | PostgresObjectViewDescriptor
  | SqlServerObjectViewDescriptor
  | SqliteObjectViewDescriptor

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
        <RelationalWorkflowStrip
          connection={connection}
          kind={kind}
          queryTarget={queryTarget}
          descriptor={descriptor}
          onOpenQuery={onOpenQuery}
        />

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

        <RelationalSourcePreview
          connection={connection}
          kind={kind}
          payload={payload}
        />

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

function RelationalWorkflowStrip({
  connection,
  kind,
  queryTarget,
  descriptor,
  onOpenQuery,
}: {
  connection: ConnectionProfile
  kind: string
  queryTarget?: ScopedQueryTarget
  descriptor: RelationalObjectViewDescriptor
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const workflows = relationalWorkflows(connection, kind, descriptor, Boolean(queryTarget))
  if (!workflows.length) {
    return null
  }

  return (
    <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
      <div className="object-view-action-chips">
        {workflows.map((workflow) => {
          const chip = (
            <>
              <ObjectViewSectionHeadingIcon icon={workflow.icon} />
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
            <span
              key={workflow.label}
              className="object-view-action-chip"
              title={workflow.title}
            >
              {chip}
            </span>
          )
        })}
      </div>
    </section>
  )
}

function ObjectViewSectionHeadingIcon({ icon }: { icon: 'table' | 'index' | 'security' | 'job' }) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'job'
          ? ObjectJobIcon
          : ObjectTableIcon

  return <Icon className="panel-inline-icon" />
}

function relationalWorkflows(
  connection: ConnectionProfile,
  kind: string,
  descriptor: RelationalObjectViewDescriptor,
  hasQueryTarget: boolean,
) {
  const workflows: Array<{
    label: string
    title: string
    icon: 'table' | 'index' | 'security' | 'job'
    action?: 'query'
  }> = []

  if (hasQueryTarget) {
    workflows.push({
      label: 'Data',
      title: descriptor.primaryQueryLabel ?? 'Open a bounded data query',
      icon: 'table',
      action: 'query',
    })
  }

  if (['table', 'view', 'materialized-view', 'hypertable'].includes(kind)) {
    workflows.push(
      { label: 'Columns', title: 'Review columns and types', icon: 'table' },
      { label: 'Indexes', title: 'Review access paths and index health', icon: 'index' },
      { label: 'Grants', title: 'Review object permissions', icon: 'security' },
    )
  }

  if (['procedure', 'function', 'stored-procedures', 'functions'].includes(kind)) {
    workflows.push(
      { label: connection.engine === 'sqlserver' ? 'T-SQL' : 'Source', title: 'Review routine source summary', icon: 'table' },
      { label: 'Params', title: 'Review parameters and signatures', icon: 'table' },
      { label: 'Grants', title: 'Review execute permissions', icon: 'security' },
    )
  }

  if (['security', 'roles', 'users', 'permissions', 'schemas'].includes(kind)) {
    workflows.push(
      { label: 'Users', title: 'Review users and principals', icon: 'security' },
      { label: 'Roles', title: 'Review role membership', icon: 'security' },
      { label: 'Grants', title: 'Review effective permissions', icon: 'security' },
    )
  }

  if (['diagnostics', 'query-store', 'query-store-view', 'cluster'].includes(kind)) {
    workflows.push(
      { label: 'Sessions', title: 'Review active sessions', icon: 'job' },
      { label: 'Waits', title: 'Review waits and blocking signals', icon: 'job' },
      { label: connection.engine === 'cockroachdb' ? 'Jobs' : 'Plans', title: 'Review workload health signals', icon: 'job' },
    )
  }

  if (['indexes', 'index'].includes(kind)) {
    workflows.push(
      { label: 'Usage', title: 'Review index usage', icon: 'index' },
      { label: 'Health', title: 'Review validity and fragmentation hints', icon: 'job' },
      { label: 'Preview', title: 'Plan guarded index maintenance', icon: 'security' },
    )
  }

  return dedupeWorkflows(workflows).slice(0, 5)
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
    section('pragmas', 'Pragmas', ['name', 'value', 'status', 'detail'], 'No PRAGMA rows were returned.'),
    section('attachedDatabases', 'Attached Databases', ['seq', 'name', 'file', 'status'], 'No attached databases were returned.'),
    section('schemaObjects', 'Schema Objects', ['type', 'name', 'tableName', 'definition'], 'No schema objects were returned.'),
    section('virtualTables', 'Virtual Tables', ['schema', 'name', 'module', 'detail'], 'No virtual tables were returned.'),
    section('generatedColumns', 'Generated Columns', ['table', 'name', 'type', 'generated', 'hidden'], 'No generated columns were returned.'),
    section('materializedViews', 'Materialized Views', ['schema', 'name', 'rows', 'size', 'lastRefresh'], 'No materialized views were returned.'),
    section('columns', 'Columns', ['name', 'type', 'nullable', 'default', 'identity', 'collation'], 'No columns were returned.'),
    section('indexes', 'Indexes', ['name', 'type', 'columns', 'unique', 'valid', 'size', 'usage'], 'No indexes were returned.', 'index' as const),
    section('constraints', 'Constraints', ['name', 'type', 'columns', 'status', 'definition'], 'No constraints were returned.'),
    section('triggers', 'Triggers', ['name', 'timing', 'event', 'enabled', 'function'], 'No triggers were returned.'),
    section('foreignKeys', 'Foreign Keys', ['id', 'from', 'table', 'to', 'onUpdate', 'onDelete'], 'No foreign keys were returned.'),
    section('parameters', 'Parameters', ['name', 'type', 'mode', 'default', 'ordinal'], 'No parameters were returned.'),
    section('dependencies', 'Dependencies', ['name', 'type', 'referencedName', 'referencedType', 'direction'], 'No dependencies were returned.'),
    section('partitions', 'Partitions', ['name', 'number', 'rows', 'range', 'compression', 'size'], 'No partitions were returned.'),
    section('functions', 'Functions', ['schema', 'name', 'arguments', 'returns', 'language', 'volatility'], 'No functions were returned.'),
    section('procedures', 'Procedures', ['schema', 'name', 'arguments', 'language', 'security'], 'No procedures were returned.'),
    section('routines', 'Routines', ['schema', 'name', 'type', 'arguments', 'returns', 'language'], 'No routines were returned.'),
    section('events', 'Events', ['schema', 'name', 'status', 'schedule', 'lastExecuted', 'definer'], 'No events were returned.', 'job' as const),
    section('sequences', 'Sequences', ['schema', 'name', 'dataType', 'increment', 'cache', 'cycles'], 'No sequences were returned.'),
    section('types', 'Types', ['schema', 'name', 'type', 'owner'], 'No types were returned.'),
    section('extensions', 'Extensions', ['name', 'version', 'schema', 'description'], 'No extensions were returned.'),
    section('files', 'Files', ['name', 'type', 'path', 'format', 'rows', 'size'], 'No external file metadata was returned.'),
    section('statistics', 'Statistics', ['name', 'rows', 'scans', 'lastVacuum', 'lastAnalyze', 'size'], 'No statistics were returned.'),
    section('checks', 'Checks', ['name', 'status', 'detail'], 'No checks were returned.'),
    section('histograms', 'Histograms', ['name', 'step', 'rangeHiKey', 'equalRows', 'rangeRows', 'distinctRangeRows'], 'No histogram rows were returned.'),
    section('permissions', 'Permissions', ['principal', 'privilege', 'object', 'state', 'grantor'], 'No permissions were returned.', 'security' as const),
    section('grants', 'Grants', ['principal', 'privilege', 'object', 'state', 'grantor'], 'No grants were returned.', 'security' as const),
    section('roles', 'Roles', ['name', 'login', 'superuser', 'inherit', 'memberships'], 'No roles were returned.', 'security' as const),
    section('users', 'Users', ['name', 'type', 'defaultSchema', 'authenticationType'], 'No users were returned.', 'security' as const),
    section('replication', 'Replication', ['channel', 'role', 'state', 'lagSeconds', 'sourceHost', 'gtid'], 'No replication rows were returned.', 'job' as const),
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
    section('waits', 'Waits', ['waitType', 'waitingTasks', 'waitMs', 'signalWaitMs', 'resource'], 'No wait stats were returned.', 'job' as const),
    section('missingIndexes', 'Missing Indexes', ['table', 'equalityColumns', 'inequalityColumns', 'includedColumns', 'impact'], 'No missing-index hints were returned.', 'index' as const),
    section('files', 'Files', ['name', 'type', 'size', 'growth', 'state'], 'No files were returned.'),
    section('filegroups', 'Filegroups', ['name', 'type', 'default', 'readOnly'], 'No filegroups were returned.'),
    section('engines', 'Storage Engines', ['name', 'support', 'transactions', 'xa', 'savepoints'], 'No storage engines were returned.'),
  ]

  if (kind === 'cluster') {
    return common.filter((candidate) =>
      ['nodes', 'ranges', 'regions', 'jobs', 'clusterSettings'].includes(candidate.key),
    )
  }

  if (kind === 'diagnostics') {
    return common.filter((candidate) =>
      ['sessions', 'locks', 'statistics', 'queryStore', 'statements', 'transactions', 'contention', 'waits', 'missingIndexes'].includes(candidate.key),
    )
  }

  if (kind === 'security') {
    return common.filter((candidate) => ['users', 'roles', 'permissions', 'schemas'].includes(candidate.key))
  }

  if (kind === 'storage') {
    return common.filter((candidate) => ['files', 'filegroups', 'statistics', 'engines'].includes(candidate.key))
  }

  if (kind === 'database') {
    return common.filter((candidate) =>
      ['attachedDatabases', 'tables', 'views', 'indexes', 'triggers', 'pragmas', 'schemaObjects', 'procedures', 'functions', 'events', 'permissions', 'statistics'].includes(candidate.key),
    )
  }

  if (kind === 'pragmas' || kind === 'pragma') {
    return common.filter((candidate) => ['pragmas', 'checks', 'attachedDatabases', 'extensions'].includes(candidate.key))
  }

  if (kind === 'schema') {
    return common.filter((candidate) => ['schemaObjects'].includes(candidate.key))
  }

  if (kind === 'virtual-tables' || kind === 'fts-tables' || kind === 'rtree-tables') {
    return common.filter((candidate) => ['virtualTables'].includes(candidate.key))
  }

  if (kind === 'generated-columns') {
    return common.filter((candidate) => ['generatedColumns', 'columns'].includes(candidate.key))
  }

  if (kind === 'events' || kind === 'event') {
    return common.filter((candidate) => ['events'].includes(candidate.key))
  }

  if (kind === 'extensions' || kind === 'extension') {
    return common.filter((candidate) => ['extensions', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'files') {
    return common.filter((candidate) => ['files', 'tables', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'replication') {
    return common.filter((candidate) => ['replication'].includes(candidate.key))
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

  if (connection.engine === 'sqlite') {
    return getSqliteObjectViewDescriptor(kind)
  }

  if (connection.engine === 'duckdb') {
    return getDuckDbObjectViewDescriptor(kind)
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return getMysqlObjectViewDescriptor(kind)
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

  if (connection.engine === 'mysql') {
    return 'MySQL'
  }

  if (connection.engine === 'mariadb') {
    return 'MariaDB'
  }

  if (connection.engine === 'sqlite') {
    return 'SQLite'
  }

  if (connection.engine === 'duckdb') {
    return 'DuckDB'
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
  return rows.map((row) => columns.map((column) => displayCellValue(column, row[column])))
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

function displayCellValue(column: string, value: unknown) {
  if (isSqlTextColumn(column)) {
    return sqlTextSummary(value)
  }

  return displayValue(value)
}

function isSqlTextColumn(column: string) {
  return /definition|sql|query|text/i.test(column)
}

function sqlTextSummary(value: unknown) {
  const text = displayValue(value).replace(/\s+/g, ' ').trim()
  if (!text) {
    return ''
  }

  const keyword = text.match(/\b(select|insert|update|delete|merge|create|alter|drop|exec|execute|with)\b/i)?.[1]
  const label = keyword ? `${keyword.toUpperCase()} statement` : 'SQL text'
  return `${label} (${text.length.toLocaleString()} chars)`
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
