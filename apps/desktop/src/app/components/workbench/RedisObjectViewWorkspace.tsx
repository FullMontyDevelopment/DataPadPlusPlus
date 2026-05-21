import { useCallback, useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  ConsoleIcon,
  DatabaseIcon,
  KeyValueIcon,
  ObjectHashIcon,
  ObjectKeyIcon,
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectStreamIcon,
  PlayIcon,
  RefreshIcon,
  WarningIcon,
} from './icons'
import {
  getRedisObjectViewDescriptor,
  type RedisObjectViewDescriptor,
} from './RedisObjectViewDescriptors'
import { ExplorerNodeIcon } from './SideBar.node-icons'

type JsonRecord = Record<string, unknown>

export function RedisObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
}: {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const [refreshing, setRefreshing] = useState(false)
  const kind = state?.kind ?? 'object'
  const descriptor = getRedisObjectViewDescriptor(kind)
  const queryTarget = useMemo(
    () => redisQueryTargetFromObjectView(tab, payload),
    [payload, tab],
  )
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])

  return (
    <section className="object-view-workspace" aria-label={`${descriptor.title} object view`}>
      <RedisObjectViewHeader
        connection={connection}
        environment={environment}
        kind={kind}
        path={state?.path}
        title={descriptor.title}
        refreshing={refreshing}
        onRefresh={refresh}
      >
        {queryTarget ? (
          <button
            type="button"
            className="drawer-button"
            onClick={() => onOpenQuery(queryTarget)}
          >
            <PlayIcon className="panel-inline-icon" />
            {descriptor.primaryQueryLabel ?? 'Open Key Browser'}
          </button>
        ) : null}
      </RedisObjectViewHeader>

      <div className="object-view-purpose">
        <strong>{state?.label && state.label !== descriptor.title ? state.label : descriptor.menuLabel}</strong>
        <span>{descriptor.purpose}</span>
      </div>
      {state?.summary ? <p className="object-view-summary">{state.summary}</p> : null}
      <WarningList warnings={objectViewWarnings(tab, payload)} />

      <div className="object-view-body">
        {renderRedisObjectView(kind, descriptor, payload, queryTarget, onOpenQuery)}
      </div>
    </section>
  )
}

function RedisObjectViewHeader({
  children,
  connection,
  environment,
  kind,
  path,
  title,
  refreshing,
  onRefresh,
}: {
  children?: ReactNode
  connection: ConnectionProfile
  environment: EnvironmentProfile
  kind: string
  path?: string[]
  title: string
  refreshing: boolean
  onRefresh(): void
}) {
  return (
    <div className="object-view-toolbar">
      <div className="object-view-heading">
        <ExplorerNodeIcon connection={connection} kind={kind} />
        <div>
          <strong>{title}</strong>
          <span>
            {[connection.name, environment.label, ...(path ?? [])].filter(Boolean).join(' / ')}
          </span>
        </div>
      </div>
      <div className="object-view-actions">
        {children}
        <button
          type="button"
          className="drawer-button"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshIcon className="panel-inline-icon" />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}

function renderRedisObjectView(
  kind: string,
  descriptor: RedisObjectViewDescriptor,
  payload: JsonRecord,
  queryTarget: ScopedQueryTarget | undefined,
  onOpenQuery: (target: ScopedQueryTarget) => void,
) {
  if (isRedisKeyPayload(payload)) {
    return <RedisKeyView descriptor={descriptor} payload={payload} />
  }

  if (kind === 'databases' || kind === 'database') {
    return (
      <RedisDatabaseView
        descriptor={descriptor}
        payload={payload}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (isRedisTypeFolderKind(kind)) {
    return (
      <RedisTypeFolderView
        kind={kind}
        descriptor={descriptor}
        payload={payload}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (kind === 'diagnostics' || isRedisDiagnosticsKind(kind)) {
    return <RedisDiagnosticsView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (kind === 'security') {
    return <RedisSecurityView descriptor={descriptor} payload={payload} />
  }

  return <RedisCommandView descriptor={descriptor} payload={payload} />
}

function RedisDatabaseView({
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
}: {
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const databases = arrayOfRecords(payload.databases)
  const typeCounts = arrayOfRecords(payload.typeCounts)
  const metrics = cardRowsFromPayload(payload, ['database', 'keyCount', 'scannedKeys', 'cursor', 'configuredDatabase'])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={DatabaseIcon} title={descriptor.title} unit={databaseUnit(payload, databases)} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <MetricCards rows={metrics} />
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel ?? 'Browse Keys'}
        </button>
      ) : null}
      <ObjectViewTable
        columns={['Database', 'Keys', 'Expires', 'Avg TTL', 'Detail']}
        rows={databases.map((database) => [
          redisDatabaseLabel(database.database ?? database.id),
          stringValue(database.keys ?? database.keyCount),
          stringValue(database.expires),
          stringValue(database.avgTtl ?? database.avgTtlMs),
          stringValue(database.detail ?? database.raw),
        ])}
        emptyText={typeCounts.length ? '' : `${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      <ObjectViewTable
        columns={['Type', 'Count', 'Example keys']}
        rows={typeCounts.map((row) => [
          redisTypeLabel(stringValue(row.type)),
          stringValue(row.count),
          compactJson(row.examples ?? row.exampleKeys ?? []),
        ])}
        emptyText="No type distribution has been collected yet."
      />
    </div>
  )
}

function RedisTypeFolderView({
  kind,
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
}: {
  kind: string
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const keys = arrayOfRecords(payload.keys)
  const scan = asRecord(payload.scan)
  const facts = [
    ['Database', redisDatabaseLabel(payload.database ?? scan?.database)],
    ['Type', redisTypeLabel(kind)],
    ['Pattern', stringValue(payload.pattern ?? scan?.pattern ?? '*')],
    ['Scanned', stringValue(payload.scannedKeys ?? scan?.scannedKeys)],
    ['Cursor', stringValue(payload.nextCursor ?? scan?.nextCursor)],
  ].filter(([, value]) => value)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={redisIconForKind(kind)} title={descriptor.title} unit={`${keys.length} loaded`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <KeyValueGrid rows={facts} emptyText="No scan metadata was returned." />
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel ?? 'Open Key Browser'}
        </button>
      ) : null}
      <ObjectViewTable
        columns={['Key', 'Type', 'TTL', 'Memory', 'Length']}
        rows={keys.map((key) => [
          stringValue(key.key ?? key.name),
          redisTypeLabel(stringValue(key.type ?? key.redisType)),
          ttlText(key.ttlSeconds ?? key.ttl),
          bytesText(key.memoryUsageBytes ?? key.memory),
          stringValue(key.length ?? key.cardinality),
        ])}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
    </div>
  )
}

function RedisKeyView({
  descriptor,
  payload,
}: {
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const preview = asRecord(payload.preview) ?? payload.value

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectKeyIcon} title={stringValue(payload.key) || descriptor.title} unit={redisTypeLabel(stringValue(payload.type ?? payload.redisType))} />
      <p className="object-view-note">Inspect this key's type, TTL, memory usage, encoding, length, and bounded value preview.</p>
      <KeyValueGrid
        rows={[
          ['Database', redisDatabaseLabel(payload.database)],
          ['Type', redisTypeLabel(stringValue(payload.type ?? payload.redisType))],
          ['TTL', ttlText(payload.ttlSeconds ?? payload.ttl)],
          ['Memory', bytesText(payload.memoryUsageBytes ?? payload.memoryUsage)],
          ['Encoding', stringValue(payload.encoding)],
          ['Length', stringValue(payload.length ?? payload.cardinality)],
        ].filter(([, value]) => value)}
        emptyText="No key metadata was returned."
      />
      {preview !== undefined ? (
        <pre className="object-view-code">{prettyJson(preview)}</pre>
      ) : null}
    </div>
  )
}

function RedisDiagnosticsView({
  kind,
  descriptor,
  payload,
}: {
  kind: string
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const infoRows = redisInfoRows(payload)
  const metricRows = metricsRowsFromPayload(payload)
  const commandRows = commandRowsFromPayload(payload)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectMetricIcon} title={descriptor.title} unit={stringValue(payload.command) || kind} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <MetricCards rows={metricRows.slice(0, 8)} />
      <ObjectViewTable
        columns={['Metric', 'Value', 'Section']}
        rows={infoRows.length ? infoRows : metricRows}
        emptyText="No INFO-style metrics were returned for this view."
      />
      {commandRows.length ? (
        <ObjectViewTable
          columns={['Item', 'Value', 'Detail']}
          rows={commandRows}
          emptyText=""
        />
      ) : null}
    </div>
  )
}

function RedisSecurityView({
  descriptor,
  payload,
}: {
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const commandRows = commandRowsFromPayload(payload)
  const users = commandRows.length
    ? commandRows
    : arrayOfRecords(payload.users).map((user) => [
        stringValue(user.name ?? user.user),
        stringValue(user.enabled),
        compactJson(user.rules ?? user.roles ?? user.permissions ?? []),
      ])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectSecurityIcon} title={descriptor.title} unit={`${users.length} row(s)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <ObjectViewTable
        columns={['Principal', 'State', 'Rules / Detail']}
        rows={users}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      <p className="object-view-note">
        ACL changes are intentionally not executed from this view. Use guarded operation previews when user management is enabled for this environment.
      </p>
    </div>
  )
}

function RedisCommandView({
  descriptor,
  payload,
}: {
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const rows = commandRowsFromPayload(payload)
  const command = stringValue(payload.command)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ConsoleIcon} title={descriptor.title} unit={command} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <ObjectViewTable
        columns={['Item', 'Value', 'Detail']}
        rows={rows}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      {rows.length === 0 && Object.keys(payload).length > 0 ? (
        <pre className="object-view-code">{prettyJson(payload)}</pre>
      ) : null}
    </div>
  )
}

function SectionHeading({
  Icon,
  title,
  unit,
}: {
  Icon: ComponentType<{ className?: string }>
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <Icon className="panel-inline-icon" />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function MetricCards({ rows }: { rows: string[][] }) {
  if (rows.length === 0) {
    return null
  }

  return (
    <div className="object-view-card-grid">
      {rows.map(([label, value]) => (
        <div key={`${label}:${value}`} className="object-view-card">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}

function KeyValueGrid({ rows, emptyText }: { rows: string[][]; emptyText: string }) {
  if (rows.length === 0) {
    return <p className="object-view-empty">{emptyText}</p>
  }

  return (
    <dl className="object-view-key-values">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ObjectViewTable({
  columns,
  rows,
  emptyText,
}: {
  columns: string[]
  rows: string[][]
  emptyText: string
}) {
  if (rows.length === 0) {
    return emptyText ? <p className="object-view-empty">{emptyText}</p> : null
  }

  return (
    <div className="object-view-table-wrap">
      <table className="object-view-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}:${row.join('|')}`}>
              {columns.map((column, columnIndex) => (
                <td key={column}>{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null
  }

  return (
    <div className="object-view-warning-list">
      {warnings.map((warning) => (
        <div key={warning} className="object-view-warning">
          <WarningIcon className="panel-inline-icon" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  )
}

function redisQueryTargetFromObjectView(
  tab: QueryTabState,
  payload: JsonRecord,
): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state) {
    return undefined
  }

  const databaseIndex = redisDatabaseIndex(payload.database ?? state.nodeId ?? state.path?.join('/'))
  const type = redisBrowserTypeFromKind(state.kind)
  const pattern = stringValue(payload.pattern) || redisPatternFromState(state.kind, state.label)

  if (!type && state.kind !== 'database' && state.kind !== 'databases') {
    return undefined
  }

  return {
    kind: state.kind,
    label: state.label,
    path: state.path,
    queryTemplate: redisKeyBrowserTemplate({
      databaseIndex,
      pattern,
      type: type ?? 'all',
      count: 100,
    }),
    preferredBuilder: 'redis-key-browser',
  }
}

function redisKeyBrowserTemplate({
  databaseIndex,
  pattern,
  type,
  count,
}: {
  databaseIndex?: number
  pattern: string
  type: string
  count: number
}) {
  return JSON.stringify(
    {
      mode: 'redis-key-browser',
      ...(databaseIndex !== undefined ? { databaseIndex } : {}),
      pattern,
      type,
      count,
    },
    null,
    2,
  )
}

function redisPatternFromState(kind: string, label: string) {
  if (kind === 'database' || kind === 'databases') {
    return '*'
  }

  return label.includes('*') ? label : '*'
}

function redisBrowserTypeFromKind(kind: string | undefined) {
  if (!kind || kind === 'databases' || kind === 'database') {
    return undefined
  }

  if (kind === 'keys') {
    return 'all'
  }

  if (isRedisTypeFolderKind(kind)) {
    return kind === 'search-index' ? 'all' : kind
  }

  return undefined
}

function isRedisTypeFolderKind(kind: string) {
  return [
    'keys',
    'string',
    'hash',
    'list',
    'set',
    'zset',
    'stream',
    'json',
    'timeseries',
    'bloom',
    'search-index',
    'vectorset',
  ].includes(kind)
}

function isRedisDiagnosticsKind(kind: string) {
  return [
    'slowlog',
    'metrics',
    'latency',
    'memory',
    'clients',
    'persistence',
    'replication',
  ].includes(kind)
}

function isRedisKeyPayload(payload: JsonRecord) {
  return Boolean(payload.key && (payload.type || payload.redisType || payload.ttlSeconds !== undefined))
}

function redisIconForKind(kind: string) {
  if (kind === 'hash') {
    return ObjectHashIcon
  }

  if (kind === 'stream') {
    return ObjectStreamIcon
  }

  if (kind === 'keys') {
    return KeyValueIcon
  }

  return ObjectKeyIcon
}

function databaseUnit(payload: JsonRecord, databases: JsonRecord[]) {
  if (databases.length) {
    return `${databases.length} DB(s)`
  }

  const database = redisDatabaseLabel(payload.database)
  return database || undefined
}

function redisInfoRows(payload: JsonRecord) {
  const text = stringValue(payload.text)
  if (!text) {
    return []
  }

  let section = ''
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      if (line.startsWith('#')) {
        section = line.replace(/^#\s*/, '')
        return []
      }

      const [name, ...rest] = line.split(':')
      if (!name || rest.length === 0) {
        return []
      }

      return [[humanize(name), rest.join(':'), section]]
    })
}

function metricsRowsFromPayload(payload: JsonRecord) {
  const metrics = arrayOfRecords(payload.metrics)
  if (metrics.length) {
    return metrics.map((metric) => [
      stringValue(metric.label ?? metric.name ?? metric.metric),
      stringValue(metric.value),
      stringValue(metric.section ?? metric.unit ?? metric.source),
    ])
  }

  return Object.entries(payload)
    .filter(([key, value]) =>
      !['value', 'text', 'command', 'keys', 'databases', 'typeCounts'].includes(key) &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
    .map(([key, value]) => [humanize(key), String(value), ''])
}

function cardRowsFromPayload(payload: JsonRecord, keys: string[]) {
  return keys
    .map((key) => [humanize(key), stringValue(payload[key])])
    .filter(([, value]) => value)
}

function commandRowsFromPayload(payload: JsonRecord): string[][] {
  const value = payload.value
  if (Array.isArray(value)) {
    return value.map((item, index) => redisCommandRow(item, index))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as JsonRecord).map(([key, item]) => [
      humanize(key),
      compactJson(item),
      '',
    ])
  }

  if (value !== undefined) {
    return [['Result', stringValue(value), '']]
  }

  return []
}

function redisCommandRow(value: unknown, index: number): string[] {
  if (Array.isArray(value)) {
    return [`#${index + 1}`, compactJson(value), '']
  }

  if (value && typeof value === 'object') {
    const record = value as JsonRecord
    return [
      stringValue(record.key ?? record.id ?? record.name ?? `#${index + 1}`),
      compactJson(record.value ?? record.result ?? record),
      stringValue(record.detail ?? record.type ?? ''),
    ]
  }

  return [`#${index + 1}`, stringValue(value), '']
}

function objectViewWarnings(tab: QueryTabState, payload: JsonRecord) {
  return [
    ...(tab.objectViewState?.warnings ?? []),
    ...(tab.error?.message ? [tab.error.message] : []),
    ...(typeof payload.warning === 'string' ? [payload.warning] : []),
    ...(typeof payload.message === 'string' && /unavailable|unsupported|blocked|requires/i.test(payload.message)
      ? [payload.message]
      : []),
  ].filter(Boolean)
}

function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return compactJson(value)
}

function compactJson(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function redisDatabaseIndex(value: unknown): number | undefined {
  const text = stringValue(value)
  const match = /(?:DB\s*|db:)?(\d+)/i.exec(text)
  if (!match) {
    return undefined
  }

  return Number.parseInt(match[1] ?? '', 10)
}

function redisDatabaseLabel(value: unknown) {
  const index = redisDatabaseIndex(value)
  if (index !== undefined && Number.isFinite(index)) {
    return `DB ${index}`
  }

  return stringValue(value)
}

function redisTypeLabel(value: string) {
  switch (value) {
    case 'zset':
      return 'sorted set'
    case 'json':
      return 'JSON'
    case 'timeseries':
      return 'time series'
    case 'vectorset':
      return 'vector'
    case 'search-index':
      return 'search index'
    default:
      return value
  }
}

function ttlText(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  if (typeof value === 'number') {
    if (value < 0) {
      return value === -1 ? 'No limit' : 'Missing/expired'
    }

    return `${value}s`
  }

  return stringValue(value)
}

function bytesText(value: unknown) {
  if (typeof value !== 'number') {
    return stringValue(value)
  }

  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function humanize(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}
