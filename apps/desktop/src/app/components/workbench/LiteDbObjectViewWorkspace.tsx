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
  ObjectBinaryIcon,
  ObjectCollectionIcon,
  ObjectDatabaseIcon,
  ObjectDocumentIcon,
  ObjectIndexIcon,
  ObjectMetricIcon,
  ObjectStageIcon,
  PlayIcon,
  WarningIcon,
} from './icons'
import {
  getLiteDbObjectViewDescriptor,
  type LiteDbObjectViewDescriptor,
} from './LiteDbObjectViewDescriptors'
import {
  liteDbWorkflows,
  type LiteDbWorkflowIconName,
} from './LiteDbObjectViewWorkflows'
import { liteDbOperationActions } from './LiteDbObjectViewOperations.helpers'
import { ObjectViewOperationStrip } from './ObjectViewOperationStrip'
import { ObjectViewHeader } from './ObjectViewHeader'
import { LiteDbObjectViewInsights } from './LiteDbObjectViewInsights'

type JsonRecord = Record<string, unknown>
type LiteDbSectionIconName = LiteDbWorkflowIconName

interface LiteDbObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function LiteDbObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
  onPlanOperation,
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
  const cards = liteDbMetricCards(payload, connection)
  const sections = liteDbSections(kind, payload, descriptor)
  const availableSectionKeys = new Set(sections.map((section) => section.key))
  const workflows = liteDbWorkflows(kind, descriptor, Boolean(queryTarget), availableSectionKeys)
  const operationActions = liteDbOperationActions(connection, tab, kind, payload)
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

      <LiteDbWarningList warnings={liteDbWarnings(tab, payload)} />

      <div className="object-view-body" ref={bodyRef}>
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

        <ObjectViewOperationStrip
          actions={operationActions}
          ariaLabel="Guarded LiteDB operation previews"
          connection={connection}
          environment={environment}
          onPlanOperation={onPlanOperation}
        />

        <LiteDbObjectViewInsights kind={kind} payload={payload} />

        {sections.length ? (
          sections.map((section) => (
            <section
              className="object-view-section"
              key={section.key}
              data-relational-section-key={section.key}
              tabIndex={-1}
            >
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

function liteDbSections(
  kind: string,
  payload: JsonRecord,
  descriptor: LiteDbObjectViewDescriptor,
) {
  const sections: Array<{
    key: string
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
  const statistics = rowsFromRecords(payload.statistics, ['name', 'value', 'scope'])
  const pragmas = rowsFromRecords(payload.pragmas, ['name', 'value', 'source', 'status'])
  const settings = rowsFromRecords(payload.settings, ['name', 'value', 'scope'])
  const maintenance = rowsFromRecords(payload.maintenance, ['name', 'effect', 'risk', 'status'])
  const diagnostics = rowsFromRecords(payload.diagnostics, ['signal', 'value', 'status', 'guidance'])

  if (['database', 'collections'].includes(kind)) {
    sections.push({ key: 'collections', title: 'Collections', icon: 'collection', columns: ['name', 'documentCount', 'indexes', 'avgDocumentSize'], rows: collections, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'collection', 'schema'].includes(kind)) {
    sections.push({ key: 'fields', title: 'Schema Preview', icon: 'document', columns: ['path', 'types', 'presence', 'example', 'warning'], rows: fields, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'collection', 'indexes', 'index'].includes(kind)) {
    sections.push({ key: 'indexes', title: 'Indexes', icon: 'index', columns: ['collection', 'name', 'expression', 'unique', 'status'], rows: indexes, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'file-storage', 'files'].includes(kind)) {
    sections.push({ key: 'files', title: 'Files', icon: 'file', columns: ['id', 'filename', 'length', 'uploadDate', 'chunks'], rows: files, emptyText: descriptor.emptyDescription })
  }

  if (['file-storage', 'chunks'].includes(kind)) {
    sections.push({ key: 'chunks', title: 'Chunks', icon: 'file', columns: ['fileId', 'chunk', 'size', 'status'], rows: chunks, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'collection', 'statistics'].includes(kind)) {
    sections.push({ key: 'statistics', title: 'Statistics', icon: 'diagnostics', columns: ['name', 'value', 'scope'], rows: statistics, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'storage', 'maintenance'].includes(kind)) {
    sections.push({ key: 'storage', title: 'Storage Health', icon: 'storage', columns: ['name', 'value', 'status', 'guidance'], rows: storage, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'pragmas'].includes(kind)) {
    sections.push({ key: 'pragmas', title: 'Pragmas', icon: 'storage', columns: ['name', 'value', 'source', 'status'], rows: pragmas, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'settings', 'pragmas'].includes(kind)) {
    sections.push({ key: 'settings', title: 'Settings', icon: 'storage', columns: ['name', 'value', 'scope'], rows: settings, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'maintenance'].includes(kind)) {
    sections.push({ key: 'maintenance', title: 'Maintenance', icon: 'storage', columns: ['name', 'effect', 'risk', 'status'], rows: maintenance, emptyText: descriptor.emptyDescription })
  }

  if (['database', 'diagnostics', 'maintenance'].includes(kind)) {
    sections.push({ key: 'diagnostics', title: 'Diagnostics', icon: 'diagnostics', columns: ['signal', 'value', 'status', 'guidance'], rows: diagnostics, emptyText: descriptor.emptyDescription })
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
