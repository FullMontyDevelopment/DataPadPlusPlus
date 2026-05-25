import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
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
} from './icons'
import {
  arrayOfRecords,
  asRecord,
  booleanState,
  bytesText,
  detailSummary,
  displayValueSummary,
  humanize,
  redisDatabaseIndex,
  redisDatabaseLabel,
  redisTypeLabel,
  stringValue,
  ttlText,
} from './RedisObjectViewFormatters'
import {
  cardRowsFromPayload,
  metadataRowsFromPayload,
  metricsRowsFromPayload,
  redisDiagnosticDetailRows,
  redisInfoRows,
  redisInfoRowsFromPayloadValue,
} from './RedisObjectViewMetrics'
import {
  clusterCards,
  currentRedisUser,
  databaseUnit,
  endpointSummary,
  functionListSummary,
  listSummary,
  normalizeAclCategories,
  normalizeAclUsers,
  normalizeClusterNodes,
  normalizeClusterSlots,
  normalizeFunctionLibraries,
  normalizePubSubChannels,
  normalizePubSubPatterns,
  normalizePubSubSubscribers,
  normalizeSentinelRecords,
  redisClusterUnit,
  redisSecurityUnit,
} from './RedisObjectViewNormalizers'
import {
  EmptyPanel,
  KeyValueGrid,
  MetricCards,
  ObjectViewTable,
  SectionHeading,
  WarningList,
} from './RedisObjectViewPrimitives'
import {
  getRedisObjectViewDescriptor,
  type RedisObjectViewDescriptor,
} from './RedisObjectViewDescriptors'
import type { JsonRecord } from './RedisObjectViewTypes'
import { ExplorerNodeIcon } from './SideBar.node-icons'

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

  if (isRedisClusterKind(kind)) {
    return <RedisClusterView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (isRedisSentinelKind(kind)) {
    return <RedisSentinelView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (isRedisScriptKind(kind)) {
    return <RedisLuaScriptsView descriptor={descriptor} payload={payload} />
  }

  if (isRedisFunctionKind(kind)) {
    return <RedisFunctionsView descriptor={descriptor} payload={payload} />
  }

  if (isRedisSecurityKind(kind)) {
    return <RedisSecurityView kind={kind} descriptor={descriptor} payload={payload} />
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
  kind,
  descriptor,
  payload,
}: {
  kind: string
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const users = normalizeAclUsers(payload).map((user) => [
    stringValue(user.name ?? user.user),
    booleanState(user.enabled),
    listSummary(user.categories ?? user.rules ?? user.roles ?? user.permissions ?? user.commands),
  ])
  const categories = normalizeAclCategories(payload, kind)
  const currentUser = currentRedisUser(payload)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectSecurityIcon} title={descriptor.title} unit={redisSecurityUnit(kind, users.length, categories.length, currentUser)} />
      <p className="object-view-note">{descriptor.purpose}</p>
      {currentUser ? <MetricCards rows={[['Current user', currentUser]]} /> : null}
      <ObjectViewTable
        columns={['User', 'State', 'Commands / Rules']}
        rows={users}
        emptyText={kind === 'permissions' || kind === 'user' ? '' : `${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
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
      {!users.length && !categories.length && !currentUser ? (
        <EmptyPanel title={descriptor.emptyTitle} description={descriptor.emptyDescription} />
      ) : null}
    </div>
  )
}

function RedisClusterView({
  kind,
  descriptor,
  payload,
}: {
  kind: string
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const infoRows = redisInfoRowsFromPayloadValue(payload)
  const nodes = normalizeClusterNodes(payload)
  const slots = normalizeClusterSlots(payload)
  const cards = clusterCards(payload, infoRows, nodes, slots)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectMetricIcon} title={descriptor.title} unit={redisClusterUnit(kind, infoRows, nodes, slots)} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <MetricCards rows={cards} />
      {infoRows.length ? (
        <ObjectViewTable
          columns={['Signal', 'Value', 'Section']}
          rows={infoRows}
          emptyText=""
        />
      ) : null}
      {nodes.length ? (
        <ObjectViewTable
          columns={['Node', 'Address', 'Role / Flags', 'Link', 'Slots']}
          rows={nodes.map((node) => [
            stringValue(node.id ?? node.name),
            stringValue(node.address ?? node.addr ?? node.endpoint),
            stringValue(node.role ?? node.flags ?? node.state),
            stringValue(node.linkState ?? node.link ?? node.status),
            listSummary(node.slots ?? node.slotRanges),
          ])}
          emptyText=""
        />
      ) : null}
      {slots.length ? (
        <ObjectViewTable
          columns={['Range', 'Master', 'Replicas', 'Detail']}
          rows={slots.map((slot) => [
            stringValue(slot.range),
            stringValue(slot.master),
            listSummary(slot.replicas),
            stringValue(slot.detail),
          ])}
          emptyText=""
        />
      ) : null}
      {!infoRows.length && !nodes.length && !slots.length ? (
        <EmptyPanel title={descriptor.emptyTitle} description={descriptor.emptyDescription} />
      ) : null}
    </div>
  )
}

function RedisSentinelView({
  kind,
  descriptor,
  payload,
}: {
  kind: string
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const masters = normalizeSentinelRecords(payload.masters, kind === 'sentinel' || kind === 'sentinel-masters' ? payload.value : undefined)
  const replicas = normalizeSentinelRecords(payload.replicas, kind === 'sentinel-replicas' ? payload.value : undefined)
  const sentinels = normalizeSentinelRecords(payload.sentinels, kind === 'sentinel-peers' ? payload.value : undefined)
  const cards = [
    ['Masters', String(masters.length)],
    ['Replicas', String(replicas.length)],
    ['Sentinels', String(sentinels.length)],
  ]

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectMetricIcon} title={descriptor.title} unit={`${masters.length + replicas.length + sentinels.length} row(s)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <MetricCards rows={cards} />
      <ObjectViewTable
        columns={['Master', 'Address', 'State', 'Quorum / Replicas']}
        rows={masters.map((master) => [
          stringValue(master.name),
          endpointSummary(master),
          stringValue(master.flags ?? master.status ?? master.state),
          [stringValue(master.quorum), stringValue(master.numSlaves ?? master.slaves)].filter(Boolean).join(' / '),
        ])}
        emptyText={kind === 'sentinel' || kind === 'sentinel-masters' ? `${descriptor.emptyTitle}. ${descriptor.emptyDescription}` : ''}
      />
      {replicas.length ? (
        <ObjectViewTable
          columns={['Replica', 'Address', 'State', 'Master']}
          rows={replicas.map((replica) => [
            stringValue(replica.name ?? replica.runid ?? replica.id),
            endpointSummary(replica),
            stringValue(replica.flags ?? replica.status ?? replica.state),
            stringValue(replica.masterName ?? replica.master),
          ])}
          emptyText=""
        />
      ) : null}
      {sentinels.length ? (
        <ObjectViewTable
          columns={['Sentinel', 'Address', 'State', 'Run ID']}
          rows={sentinels.map((sentinel) => [
            stringValue(sentinel.name ?? sentinel.id),
            endpointSummary(sentinel),
            stringValue(sentinel.flags ?? sentinel.status ?? sentinel.state),
            stringValue(sentinel.runid ?? sentinel.runId),
          ])}
          emptyText=""
        />
      ) : null}
      {!masters.length && !replicas.length && !sentinels.length ? (
        <EmptyPanel title={descriptor.emptyTitle} description={descriptor.emptyDescription} />
      ) : null}
    </div>
  )
}

function RedisLuaScriptsView({
  descriptor,
  payload,
}: {
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const scripts = arrayOfRecords(payload.scripts)
  const history = arrayOfRecords(payload.history)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ConsoleIcon} title={descriptor.title} unit={`${scripts.length + history.length} item(s)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <MetricCards rows={[
        ['Loaded scripts', String(scripts.length)],
        ['Library history', String(history.length)],
      ]} />
      {scripts.length ? (
        <ObjectViewTable
          columns={['SHA', 'Name', 'Last Used']}
          rows={scripts.map((script) => [
            stringValue(script.sha ?? script.id),
            stringValue(script.name),
            stringValue(script.lastUsedAt ?? script.updatedAt),
          ])}
          emptyText=""
        />
      ) : null}
      {history.length ? (
        <ObjectViewTable
          columns={['Script', 'Scope', 'Last Run']}
          rows={history.map((item) => [
            stringValue(item.name ?? item.title),
            stringValue(item.scope ?? item.database),
            stringValue(item.lastRunAt ?? item.updatedAt),
          ])}
          emptyText=""
        />
      ) : null}
      {!scripts.length && !history.length ? (
        <EmptyPanel title={descriptor.emptyTitle} description={descriptor.emptyDescription} />
      ) : null}
    </div>
  )
}

function RedisFunctionsView({
  descriptor,
  payload,
}: {
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const libraries = normalizeFunctionLibraries(payload)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ConsoleIcon} title={descriptor.title} unit={`${libraries.length} librar${libraries.length === 1 ? 'y' : 'ies'}`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <ObjectViewTable
        columns={['Library', 'Engine', 'Functions', 'Flags / Detail']}
        rows={libraries.map((library) => [
          stringValue(library.name ?? library.libraryName ?? library.library_name),
          stringValue(library.engine),
          functionListSummary(library.functions),
          listSummary(library.flags ?? library.libraryFlags ?? library.description),
        ])}
        emptyText=""
      />
      {!libraries.length ? (
        <EmptyPanel title={descriptor.emptyTitle} description={descriptor.emptyDescription} />
      ) : null}
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

function isRedisClusterKind(kind: string) {
  return ['cluster', 'cluster-node', 'cluster-slots', 'cluster-failover'].includes(kind)
}

function isRedisSentinelKind(kind: string) {
  return ['sentinel', 'sentinel-masters', 'sentinel-replicas', 'sentinel-peers', 'sentinel-failover'].includes(kind)
}

function isRedisScriptKind(kind: string) {
  return ['lua-scripts', 'lua-script', 'history'].includes(kind)
}

function isRedisFunctionKind(kind: string) {
  return kind === 'functions'
}

function isRedisSecurityKind(kind: string) {
  return ['security', 'users', 'permissions', 'user'].includes(kind)
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
