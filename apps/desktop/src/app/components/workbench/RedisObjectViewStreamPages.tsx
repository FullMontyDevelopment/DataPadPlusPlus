import { ObjectStreamIcon } from './icons'
import {
  asRecord,
  humanize,
  listSummary,
  redisDatabaseLabel,
  stringValue,
} from './RedisObjectViewFormatters'
import {
  normalizePendingEntries,
  normalizePendingSummary,
  normalizeStreamConsumers,
  normalizeStreamEntries,
  normalizeStreamGroups,
  normalizeStreamInfo,
  streamUnit,
} from './RedisObjectViewStreamNormalizers'
import {
  EmptyPanel,
  KeyValueGrid,
  MetricCards,
  ObjectViewTable,
  SectionHeading,
} from './RedisObjectViewPrimitives'
import type { RedisObjectViewDescriptor } from './RedisObjectViewDescriptors'
import type { JsonRecord } from './RedisObjectViewTypes'

export function RedisStreamView({
  kind,
  descriptor,
  payload,
}: {
  kind: string
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
}) {
  const info = normalizeStreamInfo(payload)
  const groups = normalizeStreamGroups(payload)
  const consumers = normalizeStreamConsumers(payload)
  const entries = normalizeStreamEntries(payload)
  const pendingSummary = normalizePendingSummary(payload)
  const pendingEntries = normalizePendingEntries(payload)
  const hasContent = Object.keys(info).length || groups.length || consumers.length || entries.length || pendingEntries.length

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectStreamIcon} title={descriptor.title} unit={streamUnit(kind, payload)} />
      <MetricCards rows={streamCards(payload, info, groups, consumers, pendingSummary)} />
      <KeyValueGrid rows={streamFacts(payload, info, pendingSummary)} emptyText="No stream facts were returned." />
      {shouldShowGroups(kind, groups) ? <StreamGroupsTable groups={groups} descriptor={descriptor} /> : null}
      {shouldShowConsumers(kind, consumers) ? <StreamConsumersTable consumers={consumers} /> : null}
      {shouldShowEntries(kind, entries) ? <StreamEntriesTable entries={entries} descriptor={descriptor} /> : null}
      {shouldShowPending(kind, pendingEntries) ? <StreamPendingTable entries={pendingEntries} descriptor={descriptor} /> : null}
      {!hasContent ? <EmptyPanel title={descriptor.emptyTitle} description={descriptor.emptyDescription} /> : null}
    </div>
  )
}

function StreamGroupsTable({
  groups,
  descriptor,
}: {
  groups: JsonRecord[]
  descriptor: RedisObjectViewDescriptor
}) {
  return (
    <ObjectViewTable
      columns={['Group', 'Consumers', 'Pending', 'Delivered / Lag']}
      rows={groups.map((group) => [
        stringValue(group.name ?? group.group),
        stringValue(group.consumers),
        stringValue(group.pending),
        [stringValue(group.lastDeliveredId), stringValue(group.lag)].filter(Boolean).join(' / '),
      ])}
      emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
    />
  )
}

function StreamConsumersTable({ consumers }: { consumers: JsonRecord[] }) {
  return (
    <ObjectViewTable
      columns={['Consumer', 'Pending', 'Idle', 'Inactive']}
      rows={consumers.map((consumer) => [
        stringValue(consumer.name ?? consumer.consumer),
        stringValue(consumer.pending),
        millisecondsText(consumer.idle ?? consumer.idleMs),
        millisecondsText(consumer.inactive ?? consumer.inactiveMs),
      ])}
      emptyText="No consumers were returned for this group."
    />
  )
}

function StreamEntriesTable({
  entries,
  descriptor,
}: {
  entries: JsonRecord[]
  descriptor: RedisObjectViewDescriptor
}) {
  return (
    <ObjectViewTable
      columns={['Entry ID', 'Fields', 'Detail']}
      rows={entries.map((entry) => [
        stringValue(entry.id),
        streamFields(entry.fields),
        stringValue(entry.detail),
      ])}
      emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
    />
  )
}

function StreamPendingTable({
  entries,
  descriptor,
}: {
  entries: JsonRecord[]
  descriptor: RedisObjectViewDescriptor
}) {
  return (
    <ObjectViewTable
      columns={['Entry ID', 'Consumer', 'Idle', 'Deliveries']}
      rows={entries.map((entry) => [
        stringValue(entry.id),
        stringValue(entry.consumer),
        millisecondsText(entry.idleMs ?? entry.idle),
        stringValue(entry.deliveries ?? entry.deliveryCount),
      ])}
      emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
    />
  )
}

function streamCards(
  payload: JsonRecord,
  info: JsonRecord,
  groups: JsonRecord[],
  consumers: JsonRecord[],
  pendingSummary: JsonRecord,
) {
  return [
    ['Database', redisDatabaseLabel(payload.database)],
    ['Key', stringValue(payload.key)],
    ['Length', stringValue(info.length ?? info.entriesAdded)],
    ['Groups', stringValue(info.groups ?? groups.length)],
    ['Consumers', stringValue(consumers.length || pendingSummary.consumers)],
    ['Pending', stringValue(pendingSummary.pending)],
  ].filter(([, value]) => value && value !== '0')
}

function streamFacts(payload: JsonRecord, info: JsonRecord, pendingSummary: JsonRecord) {
  return [
    ['Database', redisDatabaseLabel(payload.database)],
    ['Stream', stringValue(payload.key)],
    ['Group', stringValue(payload.group)],
    ['First entry', stringValue(info.firstEntryId ?? asRecord(info.firstEntry).id)],
    ['Last entry', stringValue(info.lastEntryId ?? asRecord(info.lastEntry).id)],
    ['Recorded first', stringValue(info.recordedFirstEntryId)],
    ['Pending range', pendingRange(pendingSummary)],
  ].filter(([, value]) => value)
}

function streamFields(value: unknown) {
  const fields = asRecord(value)
  const summary = Object.entries(fields).map(([key, item]) => `${humanize(key)}: ${stringValue(item)}`)
  return listSummary(summary)
}

function pendingRange(summary: JsonRecord) {
  const smallest = stringValue(summary.smallestId)
  const largest = stringValue(summary.largestId)
  return [smallest, largest].filter(Boolean).join(' - ')
}

function millisecondsText(value: unknown) {
  const text = stringValue(value)
  return text ? `${text} ms` : ''
}

function shouldShowGroups(kind: string, groups: JsonRecord[]) {
  return groups.length > 0 || kind === 'stream-groups' || kind === 'stream-group'
}

function shouldShowConsumers(kind: string, consumers: JsonRecord[]) {
  return consumers.length > 0 || kind === 'stream-consumers'
}

function shouldShowEntries(kind: string, entries: JsonRecord[]) {
  return entries.length > 0 || kind === 'stream-detail' || kind === 'stream-entries'
}

function shouldShowPending(kind: string, entries: JsonRecord[]) {
  return entries.length > 0 || kind === 'stream-pending'
}
