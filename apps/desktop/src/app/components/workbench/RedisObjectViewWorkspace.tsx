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

  if (kind === 'pubsub' || kind.startsWith('pubsub-')) {
    return <RedisPubSubView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (['cluster', 'sentinel', 'lua-scripts', 'functions'].includes(kind)) {
    return <RedisMetadataView descriptor={descriptor} payload={payload} />
  }

  if (kind === 'security') {
    return <RedisSecurityView descriptor={descriptor} payload={payload} />
  }

  return <RedisMetadataView descriptor={descriptor} payload={payload} />
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
          listSummary(row.examples ?? row.exampleKeys),
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
  const preview = payload.preview !== undefined ? payload.preview : payload.value

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
      {preview !== undefined ? <RedisValuePreview value={preview} /> : null}
    </div>
  )
}

function RedisValuePreview({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <ObjectViewTable
        columns={['#', 'Value', 'Detail']}
        rows={value.map((item, index) => [
          String(index + 1),
          displayValueSummary(item),
          detailSummary(item),
        ])}
        emptyText="No value preview items were returned."
      />
    )
  }

  if (value && typeof value === 'object') {
    const rows = Object.entries(value as JsonRecord).map(([key, item]) => [
      humanize(key),
      displayValueSummary(item),
      detailSummary(item),
    ])

    return (
      <ObjectViewTable
        columns={['Field', 'Value', 'Detail']}
        rows={rows}
        emptyText="No value preview fields were returned."
      />
    )
  }

  return (
    <KeyValueGrid
      rows={[['Value', stringValue(value)]]}
      emptyText="No value preview was returned."
    />
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
  const detailRows = redisDiagnosticDetailRows(kind, payload)
  const primaryRows = infoRows.length ? infoRows : metricRows
  const unit = primaryRows.length
    ? `${primaryRows.length} metric(s)`
    : detailRows.length
      ? `${detailRows.length} row(s)`
      : kind

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectMetricIcon} title={descriptor.title} unit={unit} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <MetricCards rows={metricRows.slice(0, 8)} />
      {primaryRows.length ? (
        <ObjectViewTable
          columns={['Metric', 'Value', 'Section']}
          rows={primaryRows}
          emptyText=""
        />
      ) : null}
      {detailRows.length ? (
        <ObjectViewTable
          columns={['Item', 'Value', 'Detail']}
          rows={detailRows}
          emptyText=""
        />
      ) : null}
      {!primaryRows.length && !detailRows.length ? (
        <p className="object-view-empty">No server metadata was returned for this view.</p>
      ) : null}
    </div>
  )
}

function RedisPubSubView({
  kind,
  descriptor,
  payload,
}: {
  kind: string
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const commandValues = Array.isArray(payload.value) ? payload.value : []
  const channels = normalizePubSubChannels(payload.channels, kind === 'pubsub' || kind === 'pubsub-channel' ? commandValues : [])
  const patterns = normalizePubSubPatterns(payload.patterns, kind === 'pubsub-pattern' ? commandValues : [])
  const subscribers = normalizePubSubSubscribers(payload.subscribers, kind === 'pubsub-subscriber' ? commandValues : [])
  const cards = [
    ['Channels', stringValue(payload.activeChannels ?? channels.length)],
    ['Patterns', stringValue(payload.patternSubscriptions ?? patterns.length)],
    ['Subscribers', stringValue(payload.totalSubscribers ?? subscribers.length)],
  ].filter(([, value]) => value)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ConsoleIcon} title={descriptor.title} unit={`${channels.length} channel(s)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <MetricCards rows={cards} />
      <ObjectViewTable
        columns={['Channel', 'Subscribers', 'Pattern']}
        rows={channels.map((channel) => [
          stringValue(channel.name ?? channel.channel),
          stringValue(channel.subscribers ?? channel.subscriberCount),
          stringValue(channel.pattern ?? ''),
        ])}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      {patterns.length ? (
        <ObjectViewTable
          columns={['Pattern', 'Subscribers', 'Detail']}
          rows={patterns.map((pattern) => [
            stringValue(pattern.pattern ?? pattern.name),
            stringValue(pattern.subscribers ?? pattern.subscriberCount),
            stringValue(pattern.detail),
          ])}
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
  const users = arrayOfRecords(payload.users).map((user) => [
    stringValue(user.name ?? user.user),
    booleanState(user.enabled),
    listSummary(user.categories ?? user.rules ?? user.roles ?? user.permissions),
  ])
  const categories = arrayOfRecords(payload.categories)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectSecurityIcon} title={descriptor.title} unit={`${users.length} row(s)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <ObjectViewTable
        columns={['Principal', 'State', 'Rules / Detail']}
        rows={users}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      {categories.length ? (
        <ObjectViewTable
          columns={['Category', 'Description', 'Detail']}
          rows={categories.map((category) => [
            stringValue(category.name ?? category.category),
            stringValue(category.description),
            listSummary(category.commands),
          ])}
          emptyText=""
        />
      ) : null}
      <p className="object-view-note">
        ACL changes are intentionally not executed from this view. Use guarded operation previews when user management is enabled for this environment.
      </p>
    </div>
  )
}

function RedisMetadataView({
  descriptor,
  payload,
}: {
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const rows = metadataRowsFromPayload(payload)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ConsoleIcon} title={descriptor.title} unit={rows.length ? `${rows.length} row(s)` : 'metadata'} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <ObjectViewTable
        columns={['Item', 'Value', 'Detail']}
        rows={rows}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
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

function redisDiagnosticDetailRows(kind: string, payload: JsonRecord): string[][] {
  const slowlog = arrayOfRecords(payload.entries)
  if (slowlog.length) {
    return slowlog.map((entry) => [
      `#${stringValue(entry.id) || 'entry'}`,
      durationText(entry.durationMicros),
      [
        stringValue(entry.commandName),
        stringValue(entry.key),
        stringValue(entry.recordedAt),
      ].filter(Boolean).join(' / '),
    ])
  }

  const samples = arrayOfRecords(payload.samples)
  if (samples.length) {
    return samples.map((sample) => [
      stringValue(sample.event ?? sample.name),
      `${stringValue(sample.latestMs)} ms`,
      `Max ${stringValue(sample.maxMs)} ms`,
    ])
  }

  const clients = arrayOfRecords(payload.clients)
  if (clients.length) {
    return clients.map((client) => [
      stringValue(client.name ?? client.id),
      stringValue(client.address ?? client.addr),
      [
        client.ageSeconds !== undefined ? `age ${client.ageSeconds}s` : '',
        client.idleSeconds !== undefined ? `idle ${client.idleSeconds}s` : '',
      ].filter(Boolean).join(', '),
    ])
  }

  const keyspace = arrayOfRecords(payload.keyspace)
  if (keyspace.length) {
    return keyspace.map((database) => [
      redisDatabaseLabel(database.database ?? database.id),
      `${stringValue(database.keys)} key(s)`,
      `${stringValue(database.expires)} expiring / ${stringValue(database.avgTtlMs ?? database.avgTtl)} avg TTL`,
    ])
  }

  const replicas = arrayOfRecords(payload.replicas)
  if (replicas.length) {
    return replicas.map((replica) => [
      stringValue(replica.name ?? replica.id ?? replica.host),
      stringValue(replica.state ?? replica.status ?? replica.role),
      detailSummary(replica),
    ])
  }

  if (kind === 'diagnostics') {
    return metadataRowsFromPayload(payload)
  }

  return []
}

function cardRowsFromPayload(payload: JsonRecord, keys: string[]) {
  return keys
    .map((key) => [humanize(key), stringValue(payload[key])])
    .filter(([, value]) => value)
}

function metadataRowsFromPayload(payload: JsonRecord): string[][] {
  const facts = arrayOfRecords(payload.facts)
  if (facts.length) {
    return facts.map((fact) => [
      stringValue(fact.label ?? fact.name),
      stringValue(fact.value),
      stringValue(fact.detail ?? fact.section),
      ])
  }

  const commandResultRows = nativeCommandResultRows(payload)
  if (commandResultRows.length) {
    return commandResultRows
  }

  const preferredCollections = [
    'masters',
    'replicas',
    'sentinels',
    'nodes',
    'slots',
    'libraries',
    'scripts',
    'history',
  ]
  for (const key of preferredCollections) {
    const records = arrayOfRecords(payload[key])
    if (records.length) {
      return records.map((record, index) => [
        stringValue(record.name ?? record.id ?? `#${index + 1}`),
        displayValueSummary(record.status ?? record.state ?? record.value ?? record.type ?? record),
        detailSummary(record),
      ])
    }
  }

  const server = asRecord(payload.server)
  const serverRows = Object.entries(server).map(([key, value]) => [
    humanize(key),
    stringValue(value),
    'Server',
  ])

  const scalarRows = Object.entries(payload)
    .filter(([key, value]) =>
      ![
        'command',
        'value',
        'kind',
        'warning',
        'message',
        'metrics',
        'server',
        'keyspace',
        'channels',
        'patterns',
        'subscribers',
        'users',
        'categories',
        'entries',
        'samples',
        'clients',
        'masters',
        'replicas',
        'sentinels',
        'nodes',
        'slots',
        'libraries',
        'scripts',
        'history',
      ].includes(key) &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
    .map(([key, value]) => [humanize(key), stringValue(value), ''])

  return [...serverRows, ...scalarRows]
}

function listSummary(value: unknown) {
  const items = Array.isArray(value) ? value : []
  if (items.length === 0) {
    return 'None'
  }

  return items
    .slice(0, 5)
    .map((item) => typeof item === 'string' ? item : displayValueSummary(item))
    .join(', ')
}

function normalizePubSubChannels(source: unknown, commandValues: unknown[]): JsonRecord[] {
  const records = arrayOfRecords(source)
  if (records.length) {
    return records
  }

  return commandValues
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((channel) => ({ name: channel, subscribers: '', pattern: '' }))
}

function normalizePubSubPatterns(source: unknown, commandValues: unknown[]): JsonRecord[] {
  const records = arrayOfRecords(source)
  if (records.length) {
    return records
  }

  if (!commandValues.length) {
    return []
  }

  const count = commandValues.find((item) => typeof item === 'number' || typeof item === 'string')
  return count === undefined ? [] : [{ pattern: 'Active pattern subscriptions', subscribers: count, detail: '' }]
}

function normalizePubSubSubscribers(source: unknown, commandValues: unknown[]): JsonRecord[] {
  const records = arrayOfRecords(source)
  if (records.length) {
    return records
  }

  const rows: JsonRecord[] = []
  for (let index = 0; index < commandValues.length; index += 2) {
    const channel = commandValues[index]
    const subscribers = commandValues[index + 1]
    if (channel !== undefined) {
      rows.push({ channel, subscribers, detail: '' })
    }
  }
  return rows
}

function nativeCommandResultRows(payload: JsonRecord): string[][] {
  if (!('value' in payload)) {
    return []
  }

  const value = payload.value
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item, index) => [
      `#${index + 1}`,
      displayValueSummary(item),
      detailSummary(item),
    ])
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as JsonRecord).slice(0, 25).map(([key, item]) => [
      humanize(key),
      displayValueSummary(item),
      detailSummary(item),
    ])
  }

  const scalar = stringValue(value)
  return scalar ? [['Result', scalar, '']] : []
}

function displayValueSummary(value: unknown): string {
  if (Array.isArray(value)) {
    return listSummary(value)
  }

  if (value && typeof value === 'object') {
    const record = value as JsonRecord
    const named = stringValue(record.name ?? record.key ?? record.channel ?? record.id)
    if (named) {
      return named
    }

    const keys = Object.keys(record)
    return keys.length ? `${keys.length} field(s): ${keys.slice(0, 4).map(humanize).join(', ')}` : 'Object'
  }

  return stringValue(value)
}

function detailSummary(value: unknown) {
  if (!value || typeof value !== 'object') {
    return stringValue(value)
  }

  const record = value as JsonRecord
  return Object.entries(record)
    .slice(0, 4)
    .map(([key, item]) => `${humanize(key)}: ${displayValueSummary(item)}`)
    .join(', ')
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

function durationText(value: unknown) {
  if (typeof value !== 'number') {
    return stringValue(value)
  }

  if (value < 1000) {
    return `${value} us`
  }

  return `${(value / 1000).toFixed(1)} ms`
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

function booleanState(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? 'Enabled' : 'Disabled'
  }

  return stringValue(value)
}

function humanize(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}
