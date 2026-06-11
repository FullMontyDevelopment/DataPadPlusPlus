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
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
  PlayIcon,
  WarningIcon,
} from '../../icons'
import {
  getDynamoObjectViewDescriptor,
  type DynamoObjectViewDescriptor,
} from './DynamoObjectViewDescriptors'
import {
  dynamoWorkflows,
  type DynamoWorkflowIconName,
} from './DynamoObjectViewWorkflows'
import { DynamoObjectViewInsights } from './DynamoObjectViewInsights'
import { dynamoOperationActions } from './DynamoObjectViewOperations.helpers'
import { ObjectViewHeader } from '../../ObjectViewHeader'
import { WideColumnOperationStrip } from '../common/widecolumn/WideColumnObjectViewOperations'

type JsonRecord = Record<string, unknown>
type DynamoSectionIconName = DynamoWorkflowIconName

interface DynamoObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function DynamoObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
  onPlanOperation,
}: DynamoObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'object')
  const descriptor = getDynamoObjectViewDescriptor(kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => dynamoQueryTargetFromObjectView(tab), [tab])
  const cards = dynamoMetricCards(payload)
  const sections = dynamoSections(kind, payload, descriptor)
  const availableSectionKeys = new Set(sections.map((section) => section.key))
  const workflows = dynamoWorkflows(kind, descriptor, Boolean(queryTarget), availableSectionKeys)
  const operationActions = dynamoOperationActions(connection, tab, kind, payload)
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

      <DynamoWarningList warnings={dynamoWarnings(tab, payload)} />

      <div className="object-view-body" ref={bodyRef}>
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => {
                const chip = (
                  <>
                    <DynamoSectionIcon icon={workflow.icon} />
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

        <WideColumnOperationStrip
          actions={operationActions}
          connection={connection}
          environment={environment}
          onPlanOperation={onPlanOperation}
        />

        <DynamoObjectViewInsights kind={kind} payload={payload} />

        {cards.length ? (
          <section className="object-view-section">
            <DynamoSectionHeading icon="table" title="At a Glance" />
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
            <section
              className="object-view-section"
              key={section.key}
              data-relational-section-key={section.key}
              tabIndex={-1}
            >
              <DynamoSectionHeading icon={section.icon} title={section.title} unit={section.unit} />
              <DynamoObjectViewTable columns={section.columns} rows={section.rows} emptyText={section.emptyText} />
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

function DynamoSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: DynamoSectionIconName
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <DynamoSectionIcon icon={icon} />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function DynamoSectionIcon({ icon }: { icon: DynamoSectionIconName }) {
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

function DynamoObjectViewTable({
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

function dynamoSections(
  kind: string,
  payload: JsonRecord,
  descriptor: DynamoObjectViewDescriptor,
) {
  const sections = dynamoSectionCandidates(kind).flatMap((candidate) => {
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
        icon: 'table' as const,
        unit: `${rows.length} row(s)`,
        columns: preferredColumns(rows, ['name', 'type', 'status', 'detail']),
        rows: tableRows(rows, ['name', 'type', 'status', 'detail']),
        emptyText: descriptor.emptyTitle,
      }]
    }
  }

  return sections
}

function dynamoSectionCandidates(kind: string) {
  const common = [
    section('tables', 'Tables', ['name', 'status', 'billingMode', 'items', 'storage', 'partitionKey', 'sortKey'], 'No tables were returned.'),
    section('items', 'Items', ['partitionKey', 'sortKey', 'status', 'total', 'updatedAt'], 'No preview items were returned.'),
    section('keys', 'Keys', ['attribute', 'type', 'keyRole', 'attributeType'], 'No key schema rows were returned.'),
    section('globalSecondaryIndexes', 'Global Secondary Indexes', ['name', 'partitionKey', 'sortKey', 'projection', 'status', 'items', 'capacity'], 'No GSIs were returned.', 'index' as const),
    section('localSecondaryIndexes', 'Local Secondary Indexes', ['name', 'sortKey', 'projection', 'items', 'storage'], 'No LSIs were returned.', 'index' as const),
    section('streams', 'Streams', ['status', 'viewType', 'arn', 'shards', 'consumers'], 'No stream metadata was returned.', 'job' as const),
    section('ttl', 'TTL', ['attribute', 'status', 'sampleExpiringItems', 'oldestExpiry'], 'No TTL metadata was returned.', 'job' as const),
    section('capacity', 'Capacity', ['resource', 'readUnits', 'writeUnits', 'readThrottleEvents', 'writeThrottleEvents', 'latencyP95'], 'No capacity rows were returned.', 'job' as const),
    section('hotPartitions', 'Hot Partitions', ['partitionKey', 'readPercent', 'writePercent', 'throttles', 'recommendation'], 'No hot partition signals were returned.', 'job' as const),
    section('alarms', 'Alarms', ['name', 'state', 'metric', 'threshold', 'updatedAt'], 'No alarms were returned.', 'job' as const),
    section('backups', 'Backups', ['name', 'type', 'status', 'createdAt', 'size'], 'No backups were returned.', 'job' as const),
    section('permissions', 'Permissions', ['principal', 'action', 'resource', 'effect', 'condition'], 'No permissions were returned.', 'security' as const),
  ]

  if (kind === 'tables') {
    return common.filter((candidate) => candidate.key === 'tables')
  }

  if (kind === 'items') {
    return common.filter((candidate) => ['items', 'keys'].includes(candidate.key))
  }

  if (kind === 'indexes') {
    return common.filter((candidate) => ['globalSecondaryIndexes', 'localSecondaryIndexes'].includes(candidate.key))
  }

  if (kind === 'global-secondary-indexes') {
    return common.filter((candidate) => candidate.key === 'globalSecondaryIndexes')
  }

  if (kind === 'local-secondary-indexes') {
    return common.filter((candidate) => candidate.key === 'localSecondaryIndexes')
  }

  if (kind === 'streams') {
    return common.filter((candidate) => candidate.key === 'streams')
  }

  if (kind === 'ttl') {
    return common.filter((candidate) => candidate.key === 'ttl')
  }

  if (kind === 'capacity') {
    return common.filter((candidate) => ['capacity', 'hotPartitions'].includes(candidate.key))
  }

  if (kind === 'diagnostics') {
    return common.filter((candidate) => ['capacity', 'hotPartitions', 'alarms', 'backups', 'streams'].includes(candidate.key))
  }

  if (kind === 'security' || kind === 'permissions') {
    return common.filter((candidate) => candidate.key === 'permissions')
  }

  return common
}

function section(
  key: string,
  title: string,
  columns: string[],
  emptyText: string,
  icon: DynamoSectionIconName = 'table',
) {
  return { key, title, columns, emptyText, icon }
}

function dynamoMetricCards(payload: JsonRecord) {
  const cards: Array<{ label: string; value: string }> = []
  const entries: Array<[string, string[]]> = [
    ['Region', ['region']],
    ['Table', ['tableName', 'objectName']],
    ['Status', ['status']],
    ['Billing', ['billingMode']],
    ['Items', ['itemCount', 'items']],
    ['Storage', ['storage', 'tableSize']],
    ['Read', ['readCapacity']],
    ['Write', ['writeCapacity']],
  ]

  for (const [label, keys] of entries) {
    const value = keys.map((key) => payload[key]).find((candidate) => hasDisplayValue(candidate))
    if (hasDisplayValue(value)) {
      cards.push({ label, value: displayValue(value) })
    }
  }

  return cards.slice(0, 8)
}

function dynamoQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state?.queryTemplate) {
    return undefined
  }

  return {
    kind: state.kind,
    label: state.label,
    path: state.path,
    queryTemplate: state.queryTemplate,
    preferredBuilder: 'dynamodb-key-condition',
  }
}

function DynamoWarningList({ warnings }: { warnings: string[] }) {
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

function dynamoWarnings(tab: QueryTabState, payload: JsonRecord) {
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
  if (/condition|policy|sample|projection/i.test(column) && value && typeof value === 'object') {
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
