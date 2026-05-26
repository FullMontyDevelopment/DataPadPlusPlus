import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import {
  DatabaseIcon,
  KeyValueIcon,
  ObjectHashIcon,
  ObjectKeyIcon,
  ObjectStreamIcon,
  PlayIcon,
} from './icons'
import {
  arrayOfRecords,
  asRecord,
  bytesText,
  detailSummary,
  displayValueSummary,
  humanize,
  listSummary,
  redisDatabaseLabel,
  redisTypeLabel,
  stringValue,
  ttlText,
} from './RedisObjectViewFormatters'
import { cardRowsFromPayload } from './RedisObjectViewMetrics'
import { databaseUnit } from './RedisObjectViewNormalizers'
import {
  KeyValueGrid,
  MetricCards,
  ObjectViewTable,
  SectionHeading,
} from './RedisObjectViewPrimitives'
import type { RedisObjectViewDescriptor } from './RedisObjectViewDescriptors'
import type { JsonRecord } from './RedisObjectViewTypes'

export function RedisDatabaseView({
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

export function RedisTypeFolderView({
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

export function RedisKeyView({
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
