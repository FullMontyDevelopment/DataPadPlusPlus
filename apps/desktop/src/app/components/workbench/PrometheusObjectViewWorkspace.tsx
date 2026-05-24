import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  ObjectJobIcon,
  ObjectMetricIcon,
  ObjectSearchIcon,
  ObjectSeriesIcon,
  ObjectStageIcon,
  PlayIcon,
  RefreshIcon,
  WarningIcon,
} from './icons'
import {
  getPrometheusObjectViewDescriptor,
  type PrometheusObjectViewDescriptor,
} from './PrometheusObjectViewDescriptors'
import { ExplorerNodeIcon } from './SideBar.node-icons'

type JsonRecord = Record<string, unknown>
type PrometheusSectionIconName = 'metric' | 'series' | 'target' | 'rule' | 'alert' | 'storage'

interface PrometheusObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
}

export function PrometheusObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
}: PrometheusObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'object')
  const descriptor = getPrometheusObjectViewDescriptor(kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => prometheusQueryTargetFromObjectView(tab), [tab])
  const workflows = prometheusWorkflows(kind, descriptor, Boolean(queryTarget))
  const cards = prometheusMetricCards(payload)
  const sections = prometheusSections(kind, payload, descriptor)

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
      <PrometheusWarningList warnings={prometheusWarnings(tab, payload)} />

      <div className="object-view-body">
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => {
                const chip = (
                  <>
                    <PrometheusSectionIcon icon={workflow.icon} />
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
            <PrometheusSectionHeading icon="metric" title="At a Glance" />
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
              <PrometheusSectionHeading icon={section.icon} title={section.title} unit={section.unit} />
              <PrometheusObjectViewTable columns={section.columns} rows={section.rows} emptyText={section.emptyText} />
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

function PrometheusSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: PrometheusSectionIconName
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <PrometheusSectionIcon icon={icon} />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function PrometheusSectionIcon({ icon }: { icon: PrometheusSectionIconName }) {
  const Icon =
    icon === 'series'
      ? ObjectSeriesIcon
      : icon === 'target'
        ? ObjectSearchIcon
        : icon === 'rule' || icon === 'alert'
          ? ObjectJobIcon
          : icon === 'storage'
            ? ObjectStageIcon
            : ObjectMetricIcon

  return <Icon className="panel-inline-icon" />
}

function PrometheusObjectViewTable({
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

function prometheusWorkflows(
  kind: string,
  descriptor: PrometheusObjectViewDescriptor,
  hasQueryTarget: boolean,
) {
  const workflows: Array<{
    label: string
    title: string
    icon: PrometheusSectionIconName
    action?: 'query'
  }> = []

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
      { label: 'Series', title: 'Review bounded label sets before broad queries.', icon: 'series' },
      { label: 'Labels', title: 'Check cardinality and useful dimensions.', icon: 'metric' },
    )
  }

  if (['targets', 'target', 'service-discovery'].includes(kind)) {
    workflows.push(
      { label: 'Health', title: 'Review scrape health and last errors.', icon: 'target' },
      { label: 'Discovery', title: 'Review discovered and dropped target metadata.', icon: 'target' },
    )
  }

  if (['rules', 'rule-group', 'rule', 'alerts', 'alert'].includes(kind)) {
    workflows.push(
      { label: 'Evaluate', title: 'Review rule expression health and evaluation timings.', icon: 'rule' },
      { label: 'Alerts', title: 'Review firing and pending alert instances.', icon: 'alert' },
    )
  }

  if (['tsdb', 'storage', 'diagnostics', 'status'].includes(kind)) {
    workflows.push(
      { label: 'TSDB', title: 'Review head series, chunks, WAL, and block status.', icon: 'storage' },
      { label: 'Cardinality', title: 'Review high-cardinality labels and metric families.', icon: 'series' },
    )
  }

  return workflows
}

function prometheusSections(
  kind: string,
  payload: JsonRecord,
  descriptor: PrometheusObjectViewDescriptor,
) {
  const sections: Array<{
    title: string
    icon: PrometheusSectionIconName
    columns: string[]
    rows: string[][]
    emptyText: string
    unit?: string
  }> = []

  for (const candidate of prometheusSectionCandidates(kind)) {
    const rows = arrayOfRecords(payload[candidate.key])
    if (!rows.length) {
      continue
    }

    sections.push({
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
        title: descriptor.title,
        icon: 'metric',
        unit: `${rows.length} row(s)`,
        columns: preferredColumns(rows, ['name', 'type', 'status', 'detail']),
        rows: tableRows(rows, ['name', 'type', 'status', 'detail']),
        emptyText: descriptor.emptyTitle,
      })
    }
  }

  return sections
}

function prometheusSectionCandidates(kind: string) {
  const common = [
    section('metrics', 'Metrics', ['name', 'type', 'help', 'series', 'samples', 'cardinality'], 'No metric metadata is available.'),
    section('series', 'Series', ['metric', 'labels', 'lastSample', 'sampleRate', 'cardinality'], 'No series metadata is available.', 'series' as const),
    section('labels', 'Labels', ['name', 'valueCount', 'metricCount', 'cardinality', 'risk'], 'No label metadata is available.'),
    section('labelValues', 'Label Values', ['label', 'value', 'series', 'exampleMetric'], 'No label values are available.'),
    section('targets', 'Targets', ['job', 'instance', 'health', 'lastScrape', 'scrapeDuration', 'lastError'], 'No targets are available.', 'target' as const),
    section('rules', 'Rules', ['group', 'name', 'type', 'health', 'evaluationTime', 'lastError'], 'No rules are available.', 'rule' as const),
    section('alerts', 'Alerts', ['name', 'state', 'severity', 'activeAt', 'summary'], 'No alerts are firing or pending.', 'alert' as const),
    section('serviceDiscovery', 'Service Discovery', ['job', 'discovered', 'active', 'dropped', 'lastSync'], 'No service discovery metadata is available.', 'target' as const),
    section('tsdb', 'TSDB', ['name', 'value', 'unit', 'status'], 'No TSDB metadata is available.', 'storage' as const),
    section('storage', 'Storage', ['block', 'mint', 'maxt', 'samples', 'series', 'size'], 'No storage block metadata is available.', 'storage' as const),
    section('remoteWrite', 'Remote Write', ['endpoint', 'shards', 'pendingSamples', 'failedSamples', 'status'], 'No remote write queues are configured.', 'target' as const),
    section('diagnostics', 'Diagnostics', ['signal', 'value', 'status', 'guidance'], 'No diagnostics are available.', 'rule' as const),
  ]

  if (kind === 'metric' || kind === 'metrics' || kind === 'series') {
    return common.filter((candidate) => ['metrics', 'series', 'labels', 'labelValues', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'labels' || kind === 'label') {
    return common.filter((candidate) => ['labels', 'labelValues', 'metrics', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'targets' || kind === 'target') {
    return common.filter((candidate) => ['targets', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'rules' || kind === 'rule' || kind === 'rule-group') {
    return common.filter((candidate) => ['rules', 'alerts', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'alerts' || kind === 'alert') {
    return common.filter((candidate) => ['alerts', 'rules', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'service-discovery') {
    return common.filter((candidate) => ['serviceDiscovery', 'targets', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'tsdb' || kind === 'storage') {
    return common.filter((candidate) => ['tsdb', 'storage', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'remote-write') {
    return common.filter((candidate) => ['remoteWrite', 'diagnostics'].includes(candidate.key))
  }

  return common
}

function section(
  key: string,
  title: string,
  columns: string[],
  emptyText: string,
  icon: PrometheusSectionIconName = 'metric',
) {
  return { key, title, columns, emptyText, icon }
}

function prometheusMetricCards(payload: JsonRecord) {
  const cards: Array<{ label: string; value: string }> = []
  const entries: Array<[string, string[]]> = [
    ['Metrics', ['metricCount']],
    ['Series', ['seriesCount', 'headSeries']],
    ['Samples', ['sampleCount']],
    ['Targets Up', ['upTargets']],
    ['Targets Down', ['downTargets']],
    ['Rules', ['ruleCount']],
    ['Alerts', ['alertCount']],
    ['Retention', ['retention']],
  ]

  for (const [label, keys] of entries) {
    const value = keys.map((key) => payload[key]).find((candidate) => hasDisplayValue(candidate))
    if (hasDisplayValue(value)) {
      cards.push({ label, value: displayValue(value) })
    }
  }

  return cards.slice(0, 8)
}

function prometheusQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
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

function PrometheusWarningList({ warnings }: { warnings: string[] }) {
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

function prometheusWarnings(tab: QueryTabState, payload: JsonRecord) {
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
  if (isLongStructuredColumn(column) && value && typeof value === 'object') {
    return Array.isArray(value)
      ? `JSON array (${value.length} item${value.length === 1 ? '' : 's'})`
      : `JSON object (${Object.keys(value as JsonRecord).length} field${Object.keys(value as JsonRecord).length === 1 ? '' : 's'})`
  }

  return displayValue(value)
}

function isLongStructuredColumn(column: string) {
  return /labels|annotations|blocks|query|config|metadata|target/i.test(column)
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
