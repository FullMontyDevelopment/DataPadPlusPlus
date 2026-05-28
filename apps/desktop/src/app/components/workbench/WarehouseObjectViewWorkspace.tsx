import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  ObjectDatabaseIcon,
  ObjectJobIcon,
  ObjectSecurityIcon,
  ObjectStageIcon,
  ObjectTableIcon,
  ObjectWarehouseIcon,
  PlayIcon,
  WarningIcon,
} from './icons'
import {
  getWarehouseObjectViewDescriptor,
  type WarehouseObjectViewDescriptor,
} from './WarehouseObjectViewDescriptors'
import {
  warehouseWorkflows,
  type WarehouseWorkflowIconName,
} from './WarehouseObjectViewWorkflows'
import { WarehouseOperationStrip } from './WarehouseObjectViewOperations'
import { ObjectViewHeader } from './ObjectViewHeader'
import { WarehouseObjectViewInsights } from './WarehouseObjectViewInsights'
import { ClickHouseObjectViewInsights } from './ClickHouseObjectViewInsights'
import { CloudWarehouseObjectViewInsights } from './CloudWarehouseObjectViewInsights'

type JsonRecord = Record<string, unknown>
type WarehouseSectionIconName = WarehouseWorkflowIconName

interface WarehouseObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function WarehouseObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
  onPlanOperation,
}: WarehouseObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'object')
  const descriptor = getWarehouseObjectViewDescriptor(kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => warehouseQueryTargetFromObjectView(tab), [tab])
  const cards = warehouseMetricCards(payload, connection)
  const sections = warehouseSections(kind, payload, descriptor)
  const availableSectionKeys = new Set(sections.map((section) => section.key))
  const workflows = warehouseWorkflows(kind, descriptor, Boolean(queryTarget), connection.engine, availableSectionKeys)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const focusSection = useCallback((sectionKey: string) => {
    const section = bodyRef.current?.querySelector<HTMLElement>(`[data-relational-section-key="${sectionKey}"]`)
    section?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    section?.focus({ preventScroll: true })
  }, [])

  return (
    <section className="object-view-workspace" aria-label={`${descriptor.title} object view`}>
      <ObjectViewHeader
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
      </ObjectViewHeader>

      <WarehouseWarningList warnings={warehouseWarnings(tab, payload)} />

      <div className="object-view-body" ref={bodyRef}>
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => {
                const chip = (
                  <>
                    <WarehouseSectionIcon icon={workflow.icon} />
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
                ) : workflow.targetSection ? (
                  <button
                    key={workflow.label}
                    type="button"
                    className="object-view-action-chip object-view-action-chip--button"
                    title={workflow.title}
                    onClick={() => focusSection(workflow.targetSection!)}
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
            <WarehouseSectionHeading icon="warehouse" title="At a Glance" />
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

        <WarehouseOperationStrip
          connection={connection}
          environment={environment}
          tab={tab}
          kind={kind}
          payload={payload}
          onPlanOperation={onPlanOperation}
        />

        <WarehouseObjectViewInsights engine={connection.engine} kind={kind} payload={payload} />
        <CloudWarehouseObjectViewInsights engine={connection.engine} kind={kind} payload={payload} />
        {connection.engine === 'clickhouse' ? (
          <ClickHouseObjectViewInsights kind={kind} payload={payload} />
        ) : null}

        {sections.length ? (
          sections.map((section) => (
            <section
              className="object-view-section"
              key={section.key}
              data-relational-section-key={section.key}
              tabIndex={-1}
            >
              <WarehouseSectionHeading icon={section.icon} title={section.title} unit={section.unit} />
              <WarehouseObjectViewTable columns={section.columns} rows={section.rows} emptyText={section.emptyText} />
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

function WarehouseSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: WarehouseSectionIconName
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <WarehouseSectionIcon icon={icon} />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function WarehouseSectionIcon({ icon }: { icon: WarehouseSectionIconName }) {
  const Icon =
    icon === 'database'
      ? ObjectDatabaseIcon
      : icon === 'table'
        ? ObjectTableIcon
        : icon === 'stage'
          ? ObjectStageIcon
          : icon === 'job' || icon === 'diagnostics'
            ? ObjectJobIcon
            : icon === 'security'
              ? ObjectSecurityIcon
              : ObjectWarehouseIcon

  return <Icon className="panel-inline-icon" />
}

function WarehouseObjectViewTable({
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

function warehouseSections(
  kind: string,
  payload: JsonRecord,
  descriptor: WarehouseObjectViewDescriptor,
) {
  const sections = warehouseSectionCandidates(kind).flatMap((candidate) => {
    const rows = arrayOfRecords(payload[candidate.key])
    if (!rows.length) {
      return []
    }

    return [{
      key: candidate.key,
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
        key: 'objects',
        title: descriptor.title,
        icon: 'warehouse' as const,
        unit: `${rows.length} row(s)`,
        columns: preferredColumns(rows, ['name', 'type', 'status', 'detail']),
        rows: tableRows(rows, ['name', 'type', 'status', 'detail']),
        emptyText: descriptor.emptyTitle,
      }]
    }
  }

  return sections
}

function warehouseSectionCandidates(kind: string) {
  const common = [
    section('databases', 'Databases', ['name', 'schemas', 'tables', 'owner', 'retention', 'region'], 'No databases were returned.', 'database' as const),
    section('datasets', 'Datasets', ['name', 'location', 'tables', 'views', 'defaultTtl', 'owner'], 'No datasets were returned.', 'database' as const),
    section('schemas', 'Schemas', ['name', 'database', 'tables', 'views', 'owner', 'grants'], 'No schemas were returned.', 'database' as const),
    section('tables', 'Tables', ['name', 'schema', 'rows', 'size', 'partitioning', 'clustering', 'freshness'], 'No tables were returned.', 'table' as const),
    section('columns', 'Columns', ['name', 'type', 'mode', 'nullable', 'description'], 'No columns were returned.', 'table' as const),
    section('views', 'Views', ['name', 'schema', 'owner', 'dependencies', 'stale'], 'No views were returned.', 'table' as const),
    section('materializedViews', 'Materialized Views', ['name', 'schema', 'refreshStatus', 'lastRefresh', 'size'], 'No materialized views were returned.', 'table' as const),
    section('stages', 'Stages', ['name', 'type', 'url', 'fileFormat', 'encryption', 'owner'], 'No stages were returned.', 'stage' as const),
    section('warehouses', 'Compute Warehouses', ['name', 'size', 'state', 'queued', 'running', 'credits'], 'No compute warehouses were returned.', 'warehouse' as const),
    section('jobs', 'Jobs', ['id', 'type', 'status', 'duration', 'bytesScanned', 'cost'], 'No jobs were returned.', 'job' as const),
    section('tasks', 'Tasks', ['name', 'schedule', 'state', 'lastRun', 'owner'], 'No tasks were returned.', 'job' as const),
    section('security', 'Access', ['principal', 'role', 'privilege', 'object', 'effect'], 'No access metadata was returned.', 'security' as const),
    section('diagnostics', 'Diagnostics', ['signal', 'value', 'status', 'guidance'], 'No diagnostics were returned.', 'diagnostics' as const),
    section('queryHistory', 'Query History', ['queryId', 'warehouse', 'status', 'duration', 'bytesScanned', 'credits'], 'No query history was returned.', 'job' as const),
    section('warehouseLoad', 'Warehouse Load', ['warehouse', 'state', 'queued', 'running', 'credits', 'load'], 'No warehouse load was returned.', 'warehouse' as const),
    section('credits', 'Credits', ['warehouse', 'window', 'credits', 'queries'], 'No credit usage was returned.', 'diagnostics' as const),
    section('streams', 'Streams', ['name', 'table', 'stale', 'mode'], 'No streams were returned.', 'table' as const),
    section('shares', 'Shares', ['name', 'kind', 'objects', 'status'], 'No shares were returned.', 'security' as const),
    section('jobTimeline', 'Job Timeline', ['jobId', 'state', 'duration', 'bytesProcessed', 'slotMs'], 'No job timeline was returned.', 'job' as const),
    section('reservations', 'Reservations', ['name', 'slots', 'assignedProjects', 'idleSlots', 'autoscale'], 'No reservations were returned.', 'warehouse' as const),
    section('slotUsage', 'Slot Usage', ['reservation', 'window', 'slotMs', 'utilization'], 'No slot usage was returned.', 'diagnostics' as const),
    section('scheduledQueries', 'Scheduled Queries', ['name', 'schedule', 'state', 'lastRun'], 'No scheduled queries were returned.', 'job' as const),
    section('tableStorage', 'Table Storage', ['table', 'bytes', 'longTermBytes', 'partitions', 'clustering'], 'No table storage was returned.', 'table' as const),
    section('iamBindings', 'IAM Bindings', ['principal', 'role', 'resource', 'status'], 'No IAM bindings were returned.', 'security' as const),
    section('queryLog', 'Query Log', ['queryId', 'type', 'duration', 'readRows', 'readBytes', 'memoryUsage'], 'No query log events were returned.', 'job' as const),
    section('parts', 'Parts', ['name', 'partition', 'active', 'rows', 'compressedBytes', 'marks'], 'No MergeTree parts were returned.', 'table' as const),
    section('partitions', 'Partitions', ['partition', 'parts', 'rows', 'bytes', 'minDate', 'maxDate'], 'No partitions were returned.', 'table' as const),
    section('clusters', 'Cluster Nodes', ['cluster', 'shard', 'replica', 'host', 'port', 'health'], 'No cluster nodes were returned.', 'warehouse' as const),
    section('replicas', 'Replicas', ['database', 'table', 'replica', 'status', 'queueSize', 'absoluteDelay'], 'No replica metadata was returned.', 'warehouse' as const),
    section('merges', 'Merges', ['database', 'table', 'partition', 'progress', 'elapsed'], 'No active merges were returned.', 'diagnostics' as const),
    section('mutations', 'Mutations', ['mutationId', 'table', 'command', 'status', 'partsToDo'], 'No mutations were returned.', 'diagnostics' as const),
  ]

  if (['databases', 'database', 'datasets', 'dataset'].includes(kind)) {
    return common.filter((candidate) => ['databases', 'datasets', 'schemas', 'tables', 'views', 'warehouses', 'jobs', 'queryHistory', 'jobTimeline', 'warehouseLoad', 'reservations', 'slotUsage', 'tableStorage', 'diagnostics'].includes(candidate.key))
  }
  if (['schemas', 'schema'].includes(kind)) {
    return common.filter((candidate) => ['schemas', 'tables', 'views', 'materializedViews', 'stages', 'tasks', 'scheduledQueries', 'streams', 'security', 'iamBindings', 'diagnostics'].includes(candidate.key))
  }
  if (['tables', 'table'].includes(kind)) {
    return common.filter((candidate) => ['tables', 'columns', 'tableStorage', 'parts', 'partitions', 'merges', 'mutations', 'diagnostics', 'security', 'iamBindings'].includes(candidate.key))
  }
  if (['views', 'view', 'materialized-views', 'materialized-view'].includes(kind)) {
    return common.filter((candidate) => ['views', 'materializedViews', 'columns', 'diagnostics', 'security'].includes(candidate.key))
  }
  if (['stages', 'stage'].includes(kind)) {
    return common.filter((candidate) => ['stages', 'jobs', 'diagnostics'].includes(candidate.key))
  }
  if (['warehouses', 'warehouse'].includes(kind)) {
    return common.filter((candidate) => ['warehouses', 'warehouseLoad', 'credits', 'reservations', 'slotUsage', 'jobs', 'queryHistory', 'jobTimeline', 'diagnostics'].includes(candidate.key))
  }
  if (['jobs', 'job', 'tasks', 'task'].includes(kind)) {
    return common.filter((candidate) => ['jobs', 'tasks', 'queryHistory', 'jobTimeline', 'scheduledQueries', 'diagnostics'].includes(candidate.key))
  }
  if (kind === 'security') {
    return common.filter((candidate) => ['security', 'iamBindings', 'shares'].includes(candidate.key))
  }
  if (kind === 'diagnostics') {
    return common.filter((candidate) => ['diagnostics', 'jobs', 'queryHistory', 'jobTimeline', 'warehouseLoad', 'credits', 'reservations', 'slotUsage', 'tableStorage', 'queryLog', 'warehouses', 'clusters', 'replicas', 'merges', 'mutations'].includes(candidate.key))
  }

  return common
}

function section(
  key: string,
  title: string,
  columns: string[],
  emptyText: string,
  icon: WarehouseSectionIconName = 'warehouse',
) {
  return { key, title, columns, emptyText, icon }
}

function warehouseMetricCards(payload: JsonRecord, connection: ConnectionProfile) {
  const cards: Array<{ label: string; value: string }> = []
  const entries: Array<[string, string[]]> = [
    ['Database', ['database', 'dataset', 'project']],
    ['Tables', ['tableCount']],
    ['Views', ['viewCount']],
    ['Storage', ['storageSize', 'bytesStored']],
    ['Recent Jobs', ['jobCount']],
    ['Failed Jobs', ['failedJobCount']],
    ['Scanned', ['bytesScanned']],
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

function warehouseQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
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

function WarehouseWarningList({ warnings }: { warnings: string[] }) {
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

function warehouseWarnings(tab: QueryTabState, payload: JsonRecord) {
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
  return selected.length ? selected : Array.from(available).slice(0, 5)
}

function displayCell(value: unknown, column: string) {
  if (/query|definition|policy|labels|grants|dependencies|options/i.test(column) && value && typeof value === 'object') {
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
