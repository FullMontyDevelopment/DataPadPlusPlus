import { ObjectIndexIcon, ObjectJobIcon, ObjectKeyIcon, ObjectMetricIcon } from './icons'

type JsonRecord = Record<string, unknown>

interface DynamoObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function DynamoObjectViewInsights({
  kind,
  payload,
}: DynamoObjectViewInsightsProps) {
  if (!isInsightKind(kind)) {
    return null
  }

  const keys = records(payload.keys)
  const globalIndexes = records(payload.globalSecondaryIndexes)
  const localIndexes = records(payload.localSecondaryIndexes)
  const capacity = records(payload.capacity)
  const hotPartitions = records(payload.hotPartitions)
  const streams = records(payload.streams)
  const ttl = records(payload.ttl)
  const backups = records(payload.backups)

  return (
    <>
      <KeyDesign keys={keys} globalIndexes={globalIndexes} localIndexes={localIndexes} />
      <CapacityPosture capacity={capacity} hotPartitions={hotPartitions} />
      <TableFeatures ttl={ttl} streams={streams} backups={backups} />
      <IndexCoverage globalIndexes={globalIndexes} localIndexes={localIndexes} />
    </>
  )
}

function KeyDesign({
  keys,
  globalIndexes,
  localIndexes,
}: {
  keys: JsonRecord[]
  globalIndexes: JsonRecord[]
  localIndexes: JsonRecord[]
}) {
  if (!keys.length && !globalIndexes.length && !localIndexes.length) {
    return null
  }

  const partitionKey = keys.find((key) => /hash|partition/i.test(displayValue(key.type ?? key.keyRole)))
  const sortKey = keys.find((key) => /range|sort/i.test(displayValue(key.type ?? key.keyRole)))

  return (
    <section className="object-view-section" aria-label="DynamoDB key design">
      <div className="object-view-section-heading">
        <ObjectKeyIcon className="panel-inline-icon" />
        <strong>Key Design</strong>
        <span>{keys.length} key field(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Partition" value={displayValue(partitionKey?.attribute ?? partitionKey?.name)} />
        <MetricCard label="Sort" value={displayValue(sortKey?.attribute ?? sortKey?.name)} />
        <MetricCard label="GSI" value={String(globalIndexes.length)} />
        <MetricCard label="LSI" value={String(localIndexes.length)} />
      </div>
      {keys.length ? (
        <div className="object-view-chip-row">
          {keys.map((key) => (
            <span key={displayValue(key.attribute ?? key.name)}>
              {displayValue(key.attribute ?? key.name)}
              {' '}
              <strong>{displayValue(key.keyRole ?? key.type)}</strong>
              {key.attributeType ? ` ${displayValue(key.attributeType)}` : ''}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function CapacityPosture({
  capacity,
  hotPartitions,
}: {
  capacity: JsonRecord[]
  hotPartitions: JsonRecord[]
}) {
  if (!capacity.length && !hotPartitions.length) {
    return null
  }

  const readUnits = sum(capacity, 'readUnits')
  const writeUnits = sum(capacity, 'writeUnits')
  const readThrottles = sum(capacity, 'readThrottleEvents')
  const writeThrottles = sum(capacity, 'writeThrottleEvents')
  const hotSignals = hotPartitions.filter((partition) => numberValue(partition.throttles) > 0).length

  return (
    <section className="object-view-section" aria-label="DynamoDB capacity posture">
      <div className="object-view-section-heading">
        <ObjectMetricIcon className="panel-inline-icon" />
        <strong>Capacity</strong>
        <span>{capacity.length + hotPartitions.length} signal(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Read" value={readUnits ? String(readUnits) : '-'} />
        <MetricCard label="Write" value={writeUnits ? String(writeUnits) : '-'} />
        <MetricCard label="Throttles" value={String(readThrottles + writeThrottles)} />
        <MetricCard label="Hot Keys" value={String(hotSignals)} />
      </div>
      {hotPartitions.length ? (
        <div className="object-view-table-wrap">
          <table className="object-view-table">
            <thead>
              <tr>
                <th>Partition</th>
                <th>Read</th>
                <th>Write</th>
                <th>Throttles</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {hotPartitions.slice(0, 12).map((partition, index) => (
                <tr key={`${displayValue(partition.partitionKey)}-${index}`}>
                  <td>{displayValue(partition.partitionKey)}</td>
                  <td>{displayValue(partition.readPercent)}</td>
                  <td>{displayValue(partition.writePercent)}</td>
                  <td>{displayValue(partition.throttles)}</td>
                  <td>{displayValue(partition.recommendation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

function TableFeatures({
  ttl,
  streams,
  backups,
}: {
  ttl: JsonRecord[]
  streams: JsonRecord[]
  backups: JsonRecord[]
}) {
  if (!ttl.length && !streams.length && !backups.length) {
    return null
  }

  const ttlState = displayValue(ttl[0]?.status)
  const streamState = displayValue(streams[0]?.status)
  const latestBackup = backups.find((backup) => /available|active|completed/i.test(displayValue(backup.status))) ?? backups[0]

  return (
    <section className="object-view-section" aria-label="DynamoDB table features">
      <div className="object-view-section-heading">
        <ObjectJobIcon className="panel-inline-icon" />
        <strong>Table Features</strong>
        <span>{ttl.length + streams.length + backups.length} item(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="TTL" value={ttlState} />
        <MetricCard label="TTL Field" value={displayValue(ttl[0]?.attribute)} />
        <MetricCard label="Stream" value={streamState} />
        <MetricCard label="Backup" value={displayValue(latestBackup?.status ?? latestBackup?.type)} />
      </div>
      <div className="object-view-chip-row">
        {streams.map((stream, index) => (
          <span key={`stream-${index}`}>
            Stream
            {' '}
            <strong>{displayValue(stream.viewType)}</strong>
            {stream.consumers !== undefined ? ` ${displayValue(stream.consumers)} consumer(s)` : ''}
          </span>
        ))}
        {ttl.map((entry, index) => (
          <span key={`ttl-${index}`}>
            TTL
            {' '}
            <strong>{displayValue(entry.attribute)}</strong>
            {entry.sampleExpiringItems !== undefined ? ` ${displayValue(entry.sampleExpiringItems)} expiring` : ''}
          </span>
        ))}
        {backups.slice(0, 4).map((backup, index) => (
          <span key={`backup-${displayValue(backup.name)}-${index}`}>
            {displayValue(backup.name)}
            {' '}
            <strong>{displayValue(backup.status)}</strong>
          </span>
        ))}
      </div>
    </section>
  )
}

function IndexCoverage({
  globalIndexes,
  localIndexes,
}: {
  globalIndexes: JsonRecord[]
  localIndexes: JsonRecord[]
}) {
  const indexes: JsonRecord[] = [
    ...globalIndexes.map((index) => ({ ...index, scope: 'GSI' })),
    ...localIndexes.map((index) => ({ ...index, scope: 'LSI' })),
  ]

  if (!indexes.length) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="DynamoDB index coverage">
      <div className="object-view-section-heading">
        <ObjectIndexIcon className="panel-inline-icon" />
        <strong>Index Coverage</strong>
        <span>{indexes.length} index(es)</span>
      </div>
      <div className="object-view-table-wrap">
        <table className="object-view-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Partition</th>
              <th>Sort</th>
              <th>Projection</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {indexes.slice(0, 16).map((index, rowIndex) => (
              <tr key={`${displayValue(index.name)}-${rowIndex}`}>
                <td>{displayValue(index.name)}</td>
                <td>{displayValue(index.scope)}</td>
                <td>{displayValue(index.partitionKey)}</td>
                <td>{displayValue(index.sortKey)}</td>
                <td>{displayValue(index.projection)}</td>
                <td>{displayValue(index.status ?? 'ACTIVE')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="object-view-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function isInsightKind(kind: string) {
  return [
    'table',
    'items',
    'keys',
    'indexes',
    'global-secondary-indexes',
    'local-secondary-indexes',
    'streams',
    'ttl',
    'capacity',
    'diagnostics',
    'hot-partitions',
    'alarms',
    'backups',
  ].includes(kind)
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sum(rows: JsonRecord[], key: string) {
  return rows.reduce((total, row) => total + numberValue(row[key]), 0)
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-'
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }

  return String(value)
}
