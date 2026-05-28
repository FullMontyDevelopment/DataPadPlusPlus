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
  ObjectJobIcon,
  ObjectMetricIcon,
  ObjectRelationshipIcon,
  ObjectSeriesIcon,
  ObjectStageIcon,
  PlayIcon,
  WarningIcon,
} from './icons'
import {
  getOpenTsdbObjectViewDescriptor,
  type OpenTsdbObjectViewDescriptor,
} from './OpenTsdbObjectViewDescriptors'
import {
  openTsdbWorkflows,
  type OpenTsdbWorkflowIconName,
} from './OpenTsdbObjectViewWorkflows'
import { ObjectViewHeader } from './ObjectViewHeader'
import { TimeSeriesOperationStrip } from './TimeSeriesObjectViewOperations'
import { timeSeriesOperationActions } from './TimeSeriesObjectViewOperations.helpers'
import { TimeSeriesObjectViewInsights } from './TimeSeriesObjectViewInsights'

type JsonRecord = Record<string, unknown>
type OpenTsdbSectionIconName = OpenTsdbWorkflowIconName

interface OpenTsdbObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function OpenTsdbObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
  onPlanOperation,
}: OpenTsdbObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'object')
  const descriptor = getOpenTsdbObjectViewDescriptor(kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => openTsdbQueryTargetFromObjectView(tab), [tab])
  const cards = openTsdbMetricCards(payload)
  const sections = openTsdbSections(kind, payload, descriptor)
  const availableSectionKeys = new Set(sections.map((section) => section.key))
  const workflows = openTsdbWorkflows(kind, descriptor, Boolean(queryTarget), availableSectionKeys)
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

      <OpenTsdbWarningList warnings={openTsdbWarnings(tab, payload)} />

      <div className="object-view-body" ref={bodyRef}>
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => {
                const chip = (
                  <>
                    <OpenTsdbSectionIcon icon={workflow.icon} />
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
            <OpenTsdbSectionHeading icon="stats" title="At a Glance" />
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
              <OpenTsdbSectionHeading icon={section.icon} title={section.title} unit={section.unit} />
              <OpenTsdbObjectViewTable columns={section.columns} rows={section.rows} emptyText={section.emptyText} />
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

function OpenTsdbSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: OpenTsdbSectionIconName
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <OpenTsdbSectionIcon icon={icon} />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function OpenTsdbSectionIcon({ icon }: { icon: OpenTsdbSectionIconName }) {
  const Icon =
    icon === 'tag'
      ? ObjectSeriesIcon
      : icon === 'aggregation'
        ? ObjectJobIcon
        : icon === 'uid'
          ? ObjectRelationshipIcon
          : icon === 'tree'
            ? ObjectStageIcon
            : icon === 'stats'
              ? ObjectStageIcon
              : ObjectMetricIcon

  return <Icon className="panel-inline-icon" />
}

function OpenTsdbObjectViewTable({
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

function openTsdbSections(
  kind: string,
  payload: JsonRecord,
  descriptor: OpenTsdbObjectViewDescriptor,
) {
  const sections: Array<{
    key: string
    title: string
    icon: OpenTsdbSectionIconName
    columns: string[]
    rows: string[][]
    emptyText: string
    unit?: string
  }> = []

  for (const candidate of openTsdbSectionCandidates(kind)) {
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

function openTsdbSectionCandidates(kind: string) {
  const common = [
    section('metrics', 'Metrics', ['name', 'tags', 'lastWrite', 'pointsPerMinute', 'cardinality', 'uid'], 'No metrics are available.'),
    section('tags', 'Tags', ['name', 'valueCount', 'metricCount', 'cardinality', 'risk'], 'No tag keys are available.', 'tag' as const),
    section('tagValues', 'Tag Values', ['tag', 'value', 'metrics', 'series', 'exampleMetric'], 'No tag values are available.', 'tag' as const),
    section('aggregators', 'Aggregators', ['name', 'description', 'interpolation', 'bestFor'], 'No aggregators are available.', 'aggregation' as const),
    section('downsampling', 'Downsampling', ['expression', 'interval', 'aggregator', 'fillPolicy', 'bestFor'], 'No downsampling profiles are available.', 'aggregation' as const),
    section('uidMetadata', 'UID Metadata', ['kind', 'name', 'uid', 'displayName', 'description', 'notes'], 'No UID metadata is available.', 'uid' as const),
    section('trees', 'Trees', ['name', 'enabled', 'rules', 'collisions', 'description'], 'No OpenTSDB trees are configured.', 'tree' as const),
    section('stats', 'Stats', ['name', 'value', 'unit', 'status'], 'No stats are available.', 'stats' as const),
    section('diagnostics', 'Diagnostics', ['signal', 'value', 'status', 'guidance'], 'No diagnostics are available.', 'stats' as const),
  ]

  if (kind === 'metric' || kind === 'metrics') {
    return common.filter((candidate) => ['metrics', 'tags', 'uidMetadata', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'tag' || kind === 'tags') {
    return common.filter((candidate) => ['tags', 'tagValues', 'metrics', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'aggregators' || kind === 'aggregator') {
    return common.filter((candidate) => ['aggregators', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'downsampling' || kind === 'downsampler') {
    return common.filter((candidate) => ['downsampling', 'aggregators', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'uid-metadata' || kind === 'uid') {
    return common.filter((candidate) => ['uidMetadata', 'metrics', 'tags', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'trees' || kind === 'tree') {
    return common.filter((candidate) => ['trees', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'stats' || kind === 'diagnostics') {
    return common.filter((candidate) => ['stats', 'diagnostics'].includes(candidate.key))
  }

  return common
}

function section(
  key: string,
  title: string,
  columns: string[],
  emptyText: string,
  icon: OpenTsdbSectionIconName = 'metric',
) {
  return { key, title, columns, emptyText, icon }
}

function openTsdbMetricCards(payload: JsonRecord) {
  const cards: Array<{ label: string; value: string }> = []
  const entries: Array<[string, string[]]> = [
    ['Metrics', ['metricCount']],
    ['Tag Keys', ['tagKeyCount']],
    ['UIDs', ['uidCount']],
    ['Writes', ['writesPerSecond']],
    ['Queries', ['queriesPerSecond']],
    ['Storage', ['storage']],
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

function openTsdbQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
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

function OpenTsdbWarningList({ warnings }: { warnings: string[] }) {
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

function openTsdbWarnings(tab: QueryTabState, payload: JsonRecord) {
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
  if (/tags|metadata|query|rules|notes/i.test(column) && value && typeof value === 'object') {
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
