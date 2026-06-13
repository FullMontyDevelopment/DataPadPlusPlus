import { useCallback, useRef, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import {
  ObjectJobIcon,
  ObjectKeyIcon,
  ObjectMemoryIcon,
  ObjectMetricIcon,
  ObjectServerIcon,
  WarningIcon,
} from '../../icons'
import {
  getMemcachedObjectViewDescriptor,
  type MemcachedObjectViewDescriptor,
} from './MemcachedObjectViewDescriptors'
import {
  memcachedWorkflows,
  type MemcachedWorkflowIconName,
} from './MemcachedObjectViewWorkflows'
import { memcachedOperationActions } from './MemcachedObjectViewOperations.helpers'
import { ObjectViewOperationStrip } from '../../ObjectViewOperationStrip'
import { ObjectViewHeader } from '../../ObjectViewHeader'
import { MemcachedObjectViewInsights } from './MemcachedObjectViewInsights'

type JsonRecord = Record<string, unknown>
type MemcachedSectionIconName = MemcachedWorkflowIconName

interface MemcachedObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function MemcachedObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onPlanOperation,
}: MemcachedObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'server')
  const descriptor = getMemcachedObjectViewDescriptor(kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const cards = memcachedMetricCards(payload)
  const sections = memcachedSections(kind, payload, descriptor)
  const availableSectionKeys = new Set(sections.map((section) => section.key))
  const workflows = memcachedWorkflows(kind, availableSectionKeys)
  const operationActions = memcachedOperationActions(connection, tab, kind, payload)
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
      />

      <MemcachedWarningList warnings={memcachedWarnings(tab, payload)} />

      <div className="object-view-body" ref={bodyRef}>
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => (
                <button
                  key={workflow.label}
                  type="button"
                  className="object-view-action-chip object-view-action-chip--button"
                  title={workflow.title}
                  onClick={() => workflow.targetSection && focusSection(workflow.targetSection)}
                >
                  <MemcachedSectionIcon icon={workflow.icon} />
                  <span>{workflow.label}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {cards.length ? (
          <section className="object-view-section">
            <MemcachedSectionHeading icon="stats" title="At a Glance" />
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

        <ObjectViewOperationStrip
          actions={operationActions}
          ariaLabel="Guarded Memcached operations"
          connection={connection}
          environment={environment}
          onPlanOperation={onPlanOperation}
        />

        <MemcachedObjectViewInsights kind={kind} payload={payload} />

        {sections.length ? (
          sections.map((section) => (
            <section
              className="object-view-section"
              key={section.key}
              data-relational-section-key={section.key}
              tabIndex={-1}
            >
              <MemcachedSectionHeading icon={section.icon} title={section.title} unit={section.unit} />
              <MemcachedObjectViewTable columns={section.columns} rows={section.rows} emptyText={section.emptyText} />
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

function MemcachedSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: MemcachedSectionIconName
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <MemcachedSectionIcon icon={icon} />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function MemcachedSectionIcon({ icon }: { icon: MemcachedSectionIconName }) {
  const Icon =
    icon === 'server'
      ? ObjectServerIcon
      : icon === 'known-key'
        ? ObjectKeyIcon
        : icon === 'slabs' || icon === 'settings'
        ? ObjectMemoryIcon
        : icon === 'connections'
          ? ObjectJobIcon
          : ObjectMetricIcon

  return <Icon className="panel-inline-icon" />
}

function MemcachedObjectViewTable({
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

function memcachedSections(
  kind: string,
  payload: JsonRecord,
  descriptor: MemcachedObjectViewDescriptor,
) {
  const sections: Array<{
    key: string
    title: string
    icon: MemcachedSectionIconName
    unit?: string
    columns: string[]
    rows: string[][]
    emptyText: string
  }> = []
  const stats = rowsFromRecords(payload.stats, ['metric', 'value', 'unit', 'section'])
  const slabs = rowsFromRecords(payload.slabs, ['classId', 'chunkSize', 'usedChunks', 'freeChunks', 'totalPages', 'memory'])
  const items = rowsFromRecords(payload.items, ['classId', 'number', 'age', 'evicted', 'outOfMemory', 'reclaimed'])
  const settings = rowsFromRecords(payload.settings, ['name', 'value', 'impact'])
  const connections = rowsFromRecords(payload.connections, ['name', 'value', 'unit', 'status'])
  const diagnostics = rowsFromRecords(payload.diagnostics, ['signal', 'value', 'status', 'guidance'])
  const keyActions = rowsFromRecords(payload.keyActions, ['action', 'command', 'mode', 'risk', 'status'])

  if (kind === 'server' || kind === 'stats') {
    sections.push({ key: 'stats', title: 'Stats', icon: 'stats', columns: ['metric', 'value', 'unit', 'section'], rows: stats, emptyText: descriptor.emptyDescription })
  }

  if (['server', 'slabs', 'slab'].includes(kind)) {
    sections.push({ key: 'slabs', title: 'Slabs', icon: 'slabs', columns: ['classId', 'chunkSize', 'usedChunks', 'freeChunks', 'totalPages', 'memory'], rows: slabs, emptyText: descriptor.emptyDescription })
  }

  if (['server', 'items', 'item-class'].includes(kind)) {
    sections.push({ key: 'items', title: 'Item Classes', icon: 'items', columns: ['classId', 'number', 'age', 'evicted', 'outOfMemory', 'reclaimed'], rows: items, emptyText: descriptor.emptyDescription })
  }

  if (kind === 'server' || kind === 'settings') {
    sections.push({ key: 'settings', title: 'Settings', icon: 'settings', columns: ['name', 'value', 'impact'], rows: settings, emptyText: descriptor.emptyDescription })
  }

  if (kind === 'server' || kind === 'known-key') {
    sections.push({ key: 'key-actions', title: 'Known Key Actions', icon: 'known-key', columns: ['action', 'command', 'mode', 'risk', 'status'], rows: keyActions, emptyText: descriptor.emptyDescription })
  }

  if (kind === 'server' || kind === 'connections') {
    sections.push({ key: 'connections', title: 'Connections', icon: 'connections', columns: ['name', 'value', 'unit', 'status'], rows: connections, emptyText: descriptor.emptyDescription })
  }

  if (kind === 'server' || kind === 'diagnostics') {
    sections.push({ key: 'diagnostics', title: 'Diagnostics', icon: 'diagnostics', columns: ['signal', 'value', 'status', 'guidance'], rows: diagnostics, emptyText: descriptor.emptyDescription })
  }

  return sections.filter((section) => section.rows.length || kind === section.icon)
}

function memcachedMetricCards(payload: JsonRecord) {
  const stats = recordsFromUnknown(payload.stats)
  const diagnostics = recordsFromUnknown(payload.diagnostics)
  const statValue = (metric: string) =>
    stats.find((row) => String(row.metric ?? '').toLowerCase() === metric)?.value
  const diagnosticValue = (signal: string) =>
    diagnostics.find((row) => String(row.signal ?? '').toLowerCase() === signal)?.value

  return [
    { label: 'Hit Rate', value: formatValue(diagnosticValue('hit rate') ?? payload.hitRate) },
    { label: 'Items', value: formatValue(statValue('curr_items') ?? payload.currentItems) },
    { label: 'Memory', value: formatValue(statValue('bytes') ?? payload.bytesUsed) },
    { label: 'Evictions', value: formatValue(statValue('evictions') ?? payload.evictions) },
    { label: 'Connections', value: formatValue(statValue('curr_connections') ?? payload.currentConnections) },
  ].filter((card) => card.value !== '-')
}

function MemcachedWarningList({ warnings }: { warnings: string[] }) {
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

function memcachedWarnings(tab: QueryTabState, payload: JsonRecord) {
  const warnings = [
    ...(tab.objectViewState?.warnings ?? []),
    ...stringArray(payload.warnings),
  ]

  return Array.from(new Set(warnings))
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
