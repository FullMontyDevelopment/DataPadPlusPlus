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
  ObjectBucketIcon,
  ObjectColumnIcon,
  ObjectJobIcon,
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectSeriesIcon,
  ObjectStageIcon,
  PlayIcon,
  WarningIcon,
} from '../../icons'
import {
  getInfluxObjectViewDescriptor,
  type InfluxObjectViewDescriptor,
} from './InfluxObjectViewDescriptors'
import {
  influxWorkflows,
  type InfluxWorkflowIconName,
} from './InfluxObjectViewWorkflows'
import { ObjectViewHeader } from '../../ObjectViewHeader'
import { TimeSeriesOperationStrip } from '../common/timeseries/TimeSeriesObjectViewOperations'
import { timeSeriesOperationActions } from '../common/timeseries/TimeSeriesObjectViewOperations.helpers'
import { TimeSeriesObjectViewInsights } from '../common/timeseries/TimeSeriesObjectViewInsights'

type JsonRecord = Record<string, unknown>
type InfluxSectionIconName = InfluxWorkflowIconName

interface InfluxObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function InfluxObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
  onPlanOperation,
}: InfluxObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'object')
  const descriptor = getInfluxObjectViewDescriptor(kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => influxQueryTargetFromObjectView(tab), [tab])
  const cards = influxMetricCards(payload)
  const sections = influxSections(kind, payload, descriptor)
  const availableSectionKeys = new Set(sections.map((section) => section.key))
  const workflows = influxWorkflows(kind, descriptor, Boolean(queryTarget), availableSectionKeys)
  const operationActions = timeSeriesOperationActions(connection, tab, kind, payload)
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

      <InfluxWarningList warnings={influxWarnings(tab, payload)} />

      <div className="object-view-body" ref={bodyRef}>
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => {
                const chip = (
                  <>
                    <InfluxSectionIcon icon={workflow.icon} />
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

        <TimeSeriesOperationStrip
          actions={operationActions}
          connection={connection}
          environment={environment}
          onPlanOperation={onPlanOperation}
        />

        <TimeSeriesObjectViewInsights engine={connection.engine} kind={kind} payload={payload} />

        {cards.length ? (
          <section className="object-view-section">
            <InfluxSectionHeading icon="bucket" title="At a Glance" />
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
              <InfluxSectionHeading icon={section.icon} title={section.title} unit={section.unit} />
              <InfluxObjectViewTable columns={section.columns} rows={section.rows} emptyText={section.emptyText} />
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

function InfluxSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: InfluxSectionIconName
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <InfluxSectionIcon icon={icon} />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function InfluxSectionIcon({ icon }: { icon: InfluxSectionIconName }) {
  const Icon =
    icon === 'measurement'
      ? ObjectSeriesIcon
      : icon === 'tag'
        ? ObjectMetricIcon
        : icon === 'field'
          ? ObjectColumnIcon
          : icon === 'task'
            ? ObjectJobIcon
            : icon === 'security'
              ? ObjectSecurityIcon
              : icon === 'storage'
                ? ObjectStageIcon
                : ObjectBucketIcon

  return <Icon className="panel-inline-icon" />
}

function InfluxObjectViewTable({
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

function influxSections(
  kind: string,
  payload: JsonRecord,
  descriptor: InfluxObjectViewDescriptor,
) {
  const sections: Array<{
    key: string
    title: string
    icon: InfluxSectionIconName
    columns: string[]
    rows: string[][]
    emptyText: string
    unit?: string
  }> = []

  for (const candidate of influxSectionCandidates(kind)) {
    const rows = arrayOfRecords(payload[candidate.key])
    if (!rows.length) {
      continue
    }

    sections.push({
      key: candidate.key,
      title: candidate.title,
      icon: candidate.icon,
      unit: `${rows.length} row(s)`,
      columns: preferredColumns(rows, candidate.columns),
      rows: tableRows(rows, candidate.columns),
      emptyText: candidate.emptyText,
    })
  }

  if (!sections.length) {
    const rows = arrayOfRecords(payload.objects)
    if (rows.length) {
      sections.push({
        key: 'objects',
        title: descriptor.title,
        icon: 'bucket',
        unit: `${rows.length} row(s)`,
        columns: preferredColumns(rows, ['name', 'type', 'status', 'detail']),
        rows: tableRows(rows, ['name', 'type', 'status', 'detail']),
        emptyText: descriptor.emptyTitle,
      })
    }
  }

  return sections
}

function influxSectionCandidates(kind: string) {
  const common = [
    section('buckets', 'Buckets', ['name', 'org', 'retention', 'measurements', 'series', 'storage'], 'No buckets are available.'),
    section('measurements', 'Measurements', ['name', 'bucket', 'tagCount', 'fieldCount', 'series', 'lastWrite'], 'No measurements are available.', 'measurement' as const),
    section('tags', 'Tags', ['name', 'valueCount', 'series', 'cardinality', 'risk'], 'No tags are available.', 'tag' as const),
    section('tagValues', 'Tag Values', ['tag', 'value', 'series', 'measurement'], 'No tag values are available.', 'tag' as const),
    section('fields', 'Fields', ['name', 'type', 'unit', 'measurements', 'lastValue'], 'No fields are available.', 'field' as const),
    section('retentionPolicies', 'Retention', ['name', 'duration', 'shardGroupDuration', 'replication', 'status'], 'No retention policies are available.', 'storage' as const),
    section('tasks', 'Tasks', ['name', 'status', 'schedule', 'lastRun', 'lastError'], 'No tasks are available.', 'task' as const),
    section('tokens', 'Tokens', ['name', 'scopes', 'status', 'expiresAt'], 'No token metadata is available.', 'security' as const),
    section('diagnostics', 'Diagnostics', ['signal', 'value', 'status', 'guidance'], 'No diagnostics are available.', 'task' as const),
  ]

  if (kind === 'bucket' || kind === 'buckets') {
    return common.filter((candidate) => ['buckets', 'measurements', 'retentionPolicies', 'tasks', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'measurement' || kind === 'measurements') {
    return common.filter((candidate) => ['measurements', 'tags', 'fields', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'tag' || kind === 'tags') {
    return common.filter((candidate) => ['tags', 'tagValues', 'measurements', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'field' || kind === 'fields') {
    return common.filter((candidate) => ['fields', 'measurements', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'retention' || kind === 'retention-policies') {
    return common.filter((candidate) => ['retentionPolicies', 'buckets', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'task' || kind === 'tasks') {
    return common.filter((candidate) => ['tasks', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'security') {
    return common.filter((candidate) => ['tokens', 'diagnostics'].includes(candidate.key))
  }

  return common
}

function section(
  key: string,
  title: string,
  columns: string[],
  emptyText: string,
  icon: InfluxSectionIconName = 'bucket',
) {
  return { key, title, columns, emptyText, icon }
}

function influxMetricCards(payload: JsonRecord) {
  const cards: Array<{ label: string; value: string }> = []
  const entries: Array<[string, string[]]> = [
    ['Bucket', ['bucket']],
    ['Measurements', ['measurementCount']],
    ['Series', ['seriesCount']],
    ['Retention', ['retention']],
    ['Storage', ['storage']],
    ['Tasks', ['taskCount']],
    ['Version', ['version']],
  ]

  for (const [label, keys] of entries) {
    const value = keys.map((key) => payload[key]).find((candidate) => hasDisplayValue(candidate))
    if (hasDisplayValue(value)) {
      cards.push({ label, value: displayValue(value) })
    }
  }

  return cards.slice(0, 8)
}

function influxQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
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

function InfluxWarningList({ warnings }: { warnings: string[] }) {
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

function influxWarnings(tab: QueryTabState, payload: JsonRecord) {
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
  if (/scopes|labels|query|script|definition/i.test(column) && value && typeof value === 'object') {
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
