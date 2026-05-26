import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  ObjectBinaryIcon,
  ObjectCollectionIcon,
  ObjectDatabaseIcon,
  ObjectDocumentIcon,
  ObjectIndexIcon,
  ObjectMetricIcon,
  ObjectStageIcon,
  PlayIcon,
  RefreshIcon,
  WarningIcon,
} from './icons'
import {
  getLiteDbObjectViewDescriptor,
  type LiteDbObjectViewDescriptor,
} from './LiteDbObjectViewDescriptors'
import { ExplorerNodeIcon } from './SideBar.node-icons'

type JsonRecord = Record<string, unknown>
type LiteDbSectionIconName = 'database' | 'collection' | 'document' | 'index' | 'file' | 'storage' | 'diagnostics'

interface LiteDbObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
}

export function LiteDbObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
}: LiteDbObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'database')
  const descriptor = getLiteDbObjectViewDescriptor(kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => liteDbQueryTargetFromObjectView(tab), [tab])
  const workflows = liteDbWorkflows(kind, descriptor, Boolean(queryTarget))
  const cards = liteDbMetricCards(payload, connection)
  const sections = liteDbSections(kind, payload, descriptor)

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

      <LiteDbWarningList warnings={liteDbWarnings(tab, payload)} />

      <div className="object-view-body">
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => {
                const chip = (
                  <>
                    <LiteDbSectionIcon icon={workflow.icon} />
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
            <LiteDbSectionHeading icon="database" title="At a Glance" />
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
              <LiteDbSectionHeading icon={section.icon} title={section.title} unit={section.unit} />
              <LiteDbObjectViewTable columns={section.columns} rows={section.rows} emptyText={section.emptyText} />
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

function LiteDbSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: LiteDbSectionIconName
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <LiteDbSectionIcon icon={icon} />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function LiteDbSectionIcon({ icon }: { icon: LiteDbSectionIconName }) {
  const Icon =
    icon === 'database'
      ? ObjectDatabaseIcon
      : icon === 'collection'
        ? ObjectCollectionIcon
        : icon === 'document'
          ? ObjectDocumentIcon
          : icon === 'index'
            ? ObjectIndexIcon
            : icon === 'file'
              ? ObjectBinaryIcon
              : icon === 'storage'
                ? ObjectStageIcon
                : ObjectMetricIcon

  return <Icon className="panel-inline-icon" />
}

function LiteDbObjectViewTable({
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

function liteDbWorkflows(
  kind: string,
  descriptor: LiteDbObjectViewDescriptor,
  hasQueryTarget: boolean,
) {
  const workflows: Array<{
    label: string
    title: string
    icon: LiteDbSectionIconName
    action?: 'query'
  }> = []

  if (hasQueryTarget && descriptor.primaryQueryLabel) {
    workflows.push({
      label: descriptor.primaryQueryLabel,
      title: 'Open a bounded LiteDB document query for this collection.',
      icon: 'document',
      action: 'query',
    })
  }

  if (['database', 'collections'].includes(kind)) {
    workflows.push(
      { label: 'Collections', title: 'Review collection counts, indexes, and inferred fields.', icon: 'collection' },
      { label: 'File Storage', title: 'Review LiteDB file storage metadata and chunk health.', icon: 'file' },
      { label: 'Maintenance', title: 'Review checkpoint, shrink, and rebuild guidance before running maintenance.', icon: 'storage' },
    )
  }

  if (['collection', 'schema', 'indexes', 'index'].includes(kind)) {
    workflows.push(
      { label: 'Schema', title: 'Review sampled field paths and mixed-type warnings.', icon: 'document' },
      { label: 'Indexes', title: 'Review index expressions, uniqueness, and coverage.', icon: 'index' },
    )
  }

  if (['storage', 'settings', 'diagnostics', 'file-storage', 'files', 'chunks'].includes(kind)) {
    workflows.push(
      { label: 'Storage', title: 'Review page allocation, free pages, and file footprint.', icon: 'storage' },
      { label: 'Health', title: 'Review maintenance warnings and local-file health.', icon: 'diagnostics' },
    )
  }

  return dedupeWorkflows(workflows).slice(0, 5)
}

function liteDbSections(
  kind: string,
  payload: JsonRecord,
  descriptor: LiteDbObjectViewDescriptor,
) {
  const sections: Array<{
    title: string
    icon: LiteDbSectionIconName
    unit?: string
    columns: string[]
    rows: string[][]
    emptyText: string
  }> = []
  const collections = rowsFromRecords(payload.collections, ['name', 'documentCount', 'indexes', 'avgDocumentSize'])
  const fields = rowsFromRecords(payload.fields, ['path', 'types', 'presence', 'example', 'warning'])
  const indexes = rowsFromRecords(payload.indexes, ['collection', 'name', 'expression', 'unique', 'status'])
  const files = rowsFromRecords(payload.files, ['id', 'filename', 'length', 'uploadDate', 'chunks'])
  const chunks = rowsFromRecords(payload.chunks, ['fileId', 'chunk', 'size', 'status'])
  const storage = rowsFromRecords(payload.storage, ['name', 'value', 'status', 'guidance'])
  const settings = rowsFromRecords(payload.settings, ['name', 'value', 'scope'])
  const diagnostics = rowsFromRecords(payload.diagnostics, ['signal', 'value', 'status', 'guidance'])

  if (['database', 'collections'].includes(kind)) {
    sections.push({ title: 'Collections', icon: 'collection', columns: ['name', 'documentCount', 'indexes', 'avgDocumentSize'], rows: collections, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'collection', 'schema'].includes(kind)) {
    sections.push({ title: 'Schema Preview', icon: 'document', columns: ['path', 'types', 'presence', 'example', 'warning'], rows: fields, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'collection', 'indexes', 'index'].includes(kind)) {
    sections.push({ title: 'Indexes', icon: 'index', columns: ['collection', 'name', 'expression', 'unique', 'status'], rows: indexes, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'file-storage', 'files'].includes(kind)) {
    sections.push({ title: 'Files', icon: 'file', columns: ['id', 'filename', 'length', 'uploadDate', 'chunks'], rows: files, emptyText: descriptor.emptyDescription })
  }

  if (['file-storage', 'chunks'].includes(kind)) {
    sections.push({ title: 'Chunks', icon: 'file', columns: ['fileId', 'chunk', 'size', 'status'], rows: chunks, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'storage'].includes(kind)) {
    sections.push({ title: 'Storage Health', icon: 'storage', columns: ['name', 'value', 'status', 'guidance'], rows: storage, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'settings'].includes(kind)) {
    sections.push({ title: 'Settings', icon: 'storage', columns: ['name', 'value', 'scope'], rows: settings, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'diagnostics'].includes(kind)) {
    sections.push({ title: 'Diagnostics', icon: 'diagnostics', columns: ['signal', 'value', 'status', 'guidance'], rows: diagnostics, emptyText: descriptor.emptyDescription })
  }

  return sections.filter((section) => section.rows.length || kind === section.icon)
}

function liteDbQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  const kind = normalizeKind(state?.kind ?? '')

  if (!state || !['collection', 'documents'].includes(kind)) {
    return undefined
  }

  return {
    kind,
    label: state.label,
    path: state.path,
    scope: state.nodeId,
    queryTemplate: state.queryTemplate,
  }
}

function liteDbMetricCards(payload: JsonRecord, connection: ConnectionProfile) {
  return [
    { label: 'File', value: fileName(connection.database || connection.host || connection.name) },
    { label: 'Collections', value: payload.collectionCount },
    { label: 'Documents', value: payload.documentCount },
    { label: 'Indexes', value: payload.indexCount },
    { label: 'Size', value: payload.fileSize },
  ].map((card) => ({ label: card.label, value: formatValue(card.value) }))
    .filter((card) => card.value !== '-')
}

function LiteDbWarningList({ warnings }: { warnings: string[] }) {
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

function liteDbWarnings(tab: QueryTabState, payload: JsonRecord) {
  return Array.from(new Set([
    ...(tab.objectViewState?.warnings ?? []),
    ...stringArray(payload.warnings),
  ]))
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

function fileName(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
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
