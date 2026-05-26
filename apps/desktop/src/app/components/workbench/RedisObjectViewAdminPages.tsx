import {
  ConsoleIcon,
  ObjectMetricIcon,
  ObjectSecurityIcon,
} from './icons'
import {
  arrayOfRecords,
  booleanState,
  stringValue,
} from './RedisObjectViewFormatters'
import {
  metadataRowsFromPayload,
  metricsRowsFromPayload,
  redisDiagnosticDetailRows,
  redisInfoRows,
  redisInfoRowsFromPayloadValue,
} from './RedisObjectViewMetrics'
import {
  clusterCards,
  currentRedisUser,
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
  MetricCards,
  ObjectViewTable,
  SectionHeading,
} from './RedisObjectViewPrimitives'
import type { RedisObjectViewDescriptor } from './RedisObjectViewDescriptors'
import type { JsonRecord } from './RedisObjectViewTypes'

export function RedisDiagnosticsView({
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

export function RedisPubSubView({
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

export function RedisSecurityView({
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

export function RedisClusterView({
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

export function RedisSentinelView({
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

export function RedisLuaScriptsView({
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

export function RedisFunctionsView({
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

export function RedisMetadataView({
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
      <ObjectViewTable
        columns={['Item', 'Value', 'Detail']}
        rows={rows}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
    </div>
  )
}
