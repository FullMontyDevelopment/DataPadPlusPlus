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
  ObjectSearchIcon,
  ObjectSecurityIcon,
  PlayIcon,
  WarningIcon,
} from './icons'
import {
  getSearchObjectViewDescriptor,
  type SearchObjectViewDescriptor,
} from './SearchObjectViewDescriptors'
import {
  searchWorkflows,
  type SearchWorkflowIconName,
} from './SearchObjectViewWorkflows'
import { SearchObjectViewInsights } from './SearchObjectViewInsights'
import { SearchOperationStrip } from './SearchObjectViewOperations'
import { ObjectViewHeader } from './ObjectViewHeader'

type JsonRecord = Record<string, unknown>

interface SearchObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function SearchObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
  onPlanOperation,
}: SearchObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'object')
  const descriptor = getSearchObjectViewDescriptor(kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => searchQueryTargetFromObjectView(tab), [tab])
  const sections = searchSections(kind, payload, descriptor)
  const cards = searchMetricCards(payload, connection)
  const availableSectionKeys = new Set(sections.map((section) => section.key))
  const workflows = searchWorkflows(kind, descriptor, Boolean(queryTarget), availableSectionKeys)
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

      <SearchWarningList warnings={searchWarnings(tab, payload)} />

      <div className="object-view-body" ref={bodyRef}>
        {workflows.length ? (
          <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
            <div className="object-view-action-chips">
              {workflows.map((workflow) => {
                const chip = (
                  <>
                    <SearchSectionIcon icon={workflow.icon} />
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

        <SearchOperationStrip
          connection={connection}
          environment={environment}
          tab={tab}
          kind={kind}
          payload={payload}
          onPlanOperation={onPlanOperation}
        />

        <SearchObjectViewInsights
          connection={connection}
          kind={kind}
          payload={payload}
        />

        {cards.length ? (
          <section className="object-view-section">
            <SearchSectionHeading icon="search" title="At a Glance" />
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
              <SearchSectionHeading icon={section.icon} title={section.title} unit={section.unit} />
              <SearchObjectViewTable columns={section.columns} rows={section.rows} emptyText={section.emptyText} />
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

function SearchSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: SearchSectionIconName
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <SearchSectionIcon icon={icon} />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

type SearchSectionIconName = SearchWorkflowIconName

function SearchSectionIcon({ icon }: { icon: SearchSectionIconName }) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'job'
          ? ObjectJobIcon
          : ObjectSearchIcon

  return <Icon className="panel-inline-icon" />
}

function SearchObjectViewTable({
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

function searchSections(
  kind: string,
  payload: JsonRecord,
  descriptor: SearchObjectViewDescriptor,
) {
  const candidates = searchSectionCandidates(kind)
  const sections = candidates.flatMap((candidate) => {
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
        icon: 'search' as const,
        unit: `${rows.length} row(s)`,
        columns: preferredColumns(rows, ['name', 'type', 'status', 'detail']),
        rows: tableRows(rows, ['name', 'type', 'status', 'detail']),
        emptyText: descriptor.emptyTitle,
      }]
    }
  }

  return sections
}

function searchSectionCandidates(kind: string) {
  const common = [
    section('indices', 'Indices', ['name', 'health', 'status', 'documents', 'primaryShards', 'replicaShards', 'storage', 'lifecycle'], 'No indices were returned.', 'index' as const),
    section('dataStreams', 'Data Streams', ['name', 'generation', 'status', 'template', 'backingIndices', 'documents', 'storage'], 'No data streams were returned.', 'index' as const),
    section('aliases', 'Aliases', ['name', 'indices', 'writeIndex', 'routing', 'filter'], 'No aliases were returned.'),
    section('fields', 'Fields', ['path', 'type', 'searchable', 'aggregatable', 'analyzer', 'normalizer'], 'No fields were returned.'),
    section('mappings', 'Mappings', ['path', 'type', 'searchable', 'aggregatable', 'analyzer', 'normalizer'], 'No mappings were returned.'),
    section('settings', 'Settings', ['name', 'value', 'scope'], 'No settings were returned.'),
    section('templates', 'Templates', ['name', 'type', 'patterns', 'priority', 'components', 'lifecycle'], 'No templates were returned.'),
    section('pipelines', 'Pipelines', ['name', 'description', 'processors', 'onFailure', 'usedBy'], 'No pipelines were returned.'),
    section('nodes', 'Nodes', ['name', 'roles', 'heapUsed', 'diskUsed', 'cpu', 'status'], 'No nodes were returned.', 'job' as const),
    section('shards', 'Shards', ['index', 'shard', 'primary', 'state', 'node', 'documents', 'storage'], 'No shards were returned.', 'index' as const),
    section('segments', 'Segments', ['index', 'shard', 'segments', 'deletedDocs', 'memory'], 'No segments were returned.', 'index' as const),
    section('tasks', 'Tasks', ['action', 'description', 'runningTime', 'cancellable', 'node'], 'No tasks were returned.', 'job' as const),
    section('snapshots', 'Snapshots', ['repository', 'snapshot', 'state', 'indices', 'startedAt'], 'No snapshots were returned.', 'job' as const),
    section('lifecyclePolicies', 'Lifecycle Policies', ['name', 'type', 'phase', 'managedIndices', 'status'], 'No lifecycle policies were returned.', 'job' as const),
    section('slowLogs', 'Slow Logs', ['index', 'kind', 'level', 'threshold', 'observed', 'source'], 'No slow-log settings or samples were returned.', 'job' as const),
    section('allocationDecisions', 'Allocation Decisions', ['index', 'shard', 'node', 'decision', 'reason'], 'No allocation decisions were returned.', 'index' as const),
    section('statistics', 'Statistics', ['name', 'value', 'unit', 'source'], 'No statistics were returned.', 'job' as const),
    section('users', 'Users', ['name', 'realm', 'roles', 'enabled'], 'No users were returned.', 'security' as const),
    section('roles', 'Roles', ['name', 'clusterPrivileges', 'indexPrivileges', 'applicationPrivileges'], 'No roles were returned.', 'security' as const),
    section('apiKeys', 'API Keys', ['name', 'owner', 'status', 'expiresAt'], 'No API keys were returned.', 'security' as const),
  ]

  if (kind === 'cluster' || kind === 'health') {
    return common.filter((candidate) => ['nodes', 'indices', 'shards', 'statistics'].includes(candidate.key))
  }

  if (kind === 'diagnostics') {
    return common.filter((candidate) => ['nodes', 'shards', 'segments', 'tasks', 'snapshots', 'lifecyclePolicies', 'slowLogs', 'allocationDecisions', 'statistics'].includes(candidate.key))
  }

  if (kind === 'security') {
    return common.filter((candidate) => ['users', 'roles', 'apiKeys'].includes(candidate.key))
  }

  if (kind === 'mappings' || kind === 'mapping') {
    return common.filter((candidate) => ['fields', 'mappings'].includes(candidate.key))
  }

  if (kind === 'settings') {
    return common.filter((candidate) => candidate.key === 'settings')
  }

  if (kind === 'templates' || kind === 'index-template' || kind === 'component-template') {
    return common.filter((candidate) => candidate.key === 'templates')
  }

  if (kind === 'pipelines' || kind === 'pipeline') {
    return common.filter((candidate) => candidate.key === 'pipelines')
  }

  if (kind === 'aliases' || kind === 'alias') {
    return common.filter((candidate) => candidate.key === 'aliases')
  }

  if (kind === 'data-stream' || kind === 'data-streams') {
    return common.filter((candidate) => ['dataStreams', 'indices', 'shards', 'statistics'].includes(candidate.key))
  }

  if (kind === 'index' || kind === 'indices' || kind === 'documents') {
    return common.filter((candidate) => ['indices', 'fields', 'aliases', 'shards', 'segments', 'settings', 'lifecyclePolicies', 'statistics'].includes(candidate.key))
  }

  return common
}

function section(
  key: string,
  title: string,
  columns: string[],
  emptyText: string,
  icon: SearchSectionIconName = 'search',
) {
  return { key, title, columns, emptyText, icon }
}

function searchMetricCards(payload: JsonRecord, connection: ConnectionProfile) {
  const cards: Array<{ label: string; value: string }> = []
  const entries: Array<[string, string[]]> = [
    ['Cluster', ['clusterName']],
    ['Status', ['status', 'health']],
    ['Index', ['index', 'objectName']],
    ['Documents', ['documentCount', 'documents']],
    ['Storage', ['storage', 'storeSize']],
    ['Shards', ['shardCount', 'primaryShards']],
    ['Nodes', ['nodeCount']],
    ['Engine', ['engine']],
  ]

  for (const [label, keys] of entries) {
    const value = keys.map((key) => payload[key]).find((candidate) => hasDisplayValue(candidate))
    if (hasDisplayValue(value)) {
      cards.push({ label, value: displayValue(value) })
    }
  }

  if (!cards.some((card) => card.label === 'Engine')) {
    cards.push({ label: 'Engine', value: connection.engine === 'opensearch' ? 'OpenSearch' : 'Elasticsearch' })
  }

  return cards.slice(0, 8)
}

function searchQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state?.queryTemplate) {
    return undefined
  }

  return {
    kind: state.kind,
    label: state.label,
    path: state.path,
    queryTemplate: state.queryTemplate,
    preferredBuilder: 'search-dsl',
  }
}

function SearchWarningList({ warnings }: { warnings: string[] }) {
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

function searchWarnings(tab: QueryTabState, payload: JsonRecord) {
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
  return /mapping|settings|filter|definition|processors|query|source/i.test(column)
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
