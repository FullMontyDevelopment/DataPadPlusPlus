import { useCallback, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import {
  ObjectJobIcon,
  ObjectMemoryIcon,
  ObjectMetricIcon,
  ObjectServerIcon,
  RefreshIcon,
  WarningIcon,
} from './icons'
import {
  getMemcachedObjectViewDescriptor,
  type MemcachedObjectViewDescriptor,
} from './MemcachedObjectViewDescriptors'
import { ExplorerNodeIcon } from './SideBar.node-icons'

type JsonRecord = Record<string, unknown>
type MemcachedSectionIconName = 'server' | 'stats' | 'slabs' | 'items' | 'settings' | 'connections' | 'diagnostics'

interface MemcachedObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
}

export function MemcachedObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
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
  const workflows = memcachedWorkflows(kind)

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
      <MemcachedWarningList warnings={memcachedWarnings(tab, payload)} />

      <div className="object-view-body">
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => (
                <span key={workflow.label} className="object-view-action-chip" title={workflow.title}>
                  <MemcachedSectionIcon icon={workflow.icon} />
                  <span>{workflow.label}</span>
                </span>
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

        {sections.length ? (
          sections.map((section) => (
            <section className="object-view-section" key={section.title}>
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

function memcachedWorkflows(kind: string) {
  const workflows: Array<{ label: string; title: string; icon: MemcachedSectionIconName }> = []

  if (['server', 'stats', 'diagnostics'].includes(kind)) {
    workflows.push(
      { label: 'Hit Rate', title: 'Review cache effectiveness from get hits and misses.', icon: 'stats' },
      { label: 'Evictions', title: 'Watch item churn and pressure against max memory.', icon: 'diagnostics' },
      { label: 'Connections', title: 'Check connection pressure and rejected clients.', icon: 'connections' },
    )
  }

  if (['slabs', 'slab', 'items', 'item-class'].includes(kind)) {
    workflows.push(
      { label: 'Allocation', title: 'Review chunk size, used chunks, pages, and item age.', icon: 'slabs' },
      { label: 'Pressure', title: 'Look for evictions, out-of-memory counters, and reclaim behavior.', icon: 'diagnostics' },
    )
  }

  if (kind === 'settings') {
    workflows.push(
      { label: 'Limits', title: 'Review max bytes, max connections, protocols, and LRU flags.', icon: 'settings' },
      { label: 'Safety', title: 'Use operation previews for any future setting changes.', icon: 'diagnostics' },
    )
  }

  return workflows
}

function memcachedSections(
  kind: string,
  payload: JsonRecord,
  descriptor: MemcachedObjectViewDescriptor,
) {
  const sections: Array<{
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

  if (kind === 'server' || kind === 'stats') {
    sections.push({ title: 'Stats', icon: 'stats', columns: ['metric', 'value', 'unit', 'section'], rows: stats, emptyText: descriptor.emptyDescription })
  }

  if (['server', 'slabs', 'slab'].includes(kind)) {
    sections.push({ title: 'Slabs', icon: 'slabs', columns: ['classId', 'chunkSize', 'usedChunks', 'freeChunks', 'totalPages', 'memory'], rows: slabs, emptyText: descriptor.emptyDescription })
  }

  if (['server', 'items', 'item-class'].includes(kind)) {
    sections.push({ title: 'Item Classes', icon: 'items', columns: ['classId', 'number', 'age', 'evicted', 'outOfMemory', 'reclaimed'], rows: items, emptyText: descriptor.emptyDescription })
  }

  if (kind === 'server' || kind === 'settings') {
    sections.push({ title: 'Settings', icon: 'settings', columns: ['name', 'value', 'impact'], rows: settings, emptyText: descriptor.emptyDescription })
  }

  if (kind === 'server' || kind === 'connections') {
    sections.push({ title: 'Connections', icon: 'connections', columns: ['name', 'value', 'unit', 'status'], rows: connections, emptyText: descriptor.emptyDescription })
  }

  if (kind === 'server' || kind === 'diagnostics') {
    sections.push({ title: 'Diagnostics', icon: 'diagnostics', columns: ['signal', 'value', 'status', 'guidance'], rows: diagnostics, emptyText: descriptor.emptyDescription })
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
