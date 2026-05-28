import {
  ObjectJobIcon,
  ObjectPartitionIcon,
  ObjectTableIcon,
  ObjectWarehouseIcon,
} from './icons'

type JsonRecord = Record<string, unknown>

interface ClickHouseObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function ClickHouseObjectViewInsights({
  kind,
  payload,
}: ClickHouseObjectViewInsightsProps) {
  if (!isClickHouseInsightKind(kind)) {
    return null
  }

  const queryLog = records(payload.queryLog)
  const parts = records(payload.parts)
  const partitions = records(payload.partitions)
  const clusters = records(payload.clusters)
  const replicas = records(payload.replicas)
  const merges = records(payload.merges)
  const mutations = records(payload.mutations)

  if (
    !queryLog.length &&
    !parts.length &&
    !partitions.length &&
    !clusters.length &&
    !replicas.length &&
    !merges.length &&
    !mutations.length
  ) {
    return null
  }

  return (
    <>
      <QueryLogPosture payload={payload} queryLog={queryLog} />
      <MergeTreePosture payload={payload} parts={parts} partitions={partitions} />
      <ClusterPosture clusters={clusters} replicas={replicas} />
      <MaintenancePosture merges={merges} mutations={mutations} />
    </>
  )
}

function QueryLogPosture({
  payload,
  queryLog,
}: {
  payload: JsonRecord
  queryLog: JsonRecord[]
}) {
  const readRows = firstDisplay(payload.readRows, sumNumeric(queryLog, 'readRows'))
  const readBytes = firstDisplay(payload.readBytes, sumNumeric(queryLog, 'readBytes'))
  const memory = firstDisplay(payload.memoryUsage, maxNumeric(queryLog, 'memoryUsage'))
  const failures = queryLog.filter((row) => /fail|exception|error/i.test(display(row.status ?? row.type))).length

  return (
    <section className="object-view-section" aria-label="ClickHouse query log posture">
      <div className="object-view-section-heading">
        <ObjectJobIcon className="panel-inline-icon" />
        <strong>Query Log</strong>
        <span>{queryLog.length} event(s)</span>
      </div>
      <div className="object-view-card-grid">
        <Card label="Read Rows" value={display(readRows)} />
        <Card label="Read Bytes" value={display(readBytes)} />
        <Card label="Peak Memory" value={display(memory)} />
        <Card label="Failures" value={String(failures)} />
      </div>
      {queryLog.length ? <ChipRows rows={queryLog} labelKey="queryId" valueKey="duration" /> : null}
    </section>
  )
}

function MergeTreePosture({
  payload,
  parts,
  partitions,
}: {
  payload: JsonRecord
  parts: JsonRecord[]
  partitions: JsonRecord[]
}) {
  const activeParts = firstDisplay(payload.activeParts, parts.filter((part) => part.active !== false).length)
  const compressed = firstDisplay(payload.compressedBytes, sumNumeric(parts, 'compressedBytes'))
  const rows = firstDisplay(payload.rows, sumNumeric(parts, 'rows'))
  const bytesPerRow = ratio(numeric(compressed), numeric(rows))

  return (
    <section className="object-view-section" aria-label="ClickHouse MergeTree posture">
      <div className="object-view-section-heading">
        <ObjectTableIcon className="panel-inline-icon" />
        <strong>MergeTree</strong>
        <span>{partitions.length || parts.length} part(s)</span>
      </div>
      <div className="object-view-card-grid">
        <Card label="Active Parts" value={display(activeParts)} />
        <Card label="Partitions" value={display(partitions.length || undefined)} />
        <Card label="Compressed" value={display(compressed)} />
        <Card label="Bytes/Row" value={display(bytesPerRow)} />
      </div>
      {partitions.length ? <ChipRows rows={partitions} labelKey="partition" valueKey="rows" /> : null}
    </section>
  )
}

function ClusterPosture({
  clusters,
  replicas,
}: {
  clusters: JsonRecord[]
  replicas: JsonRecord[]
}) {
  if (!clusters.length && !replicas.length) {
    return null
  }

  const shards = uniqueCount(clusters.map((row) => display(row.shard)))
  const unhealthy = replicas.filter((row) => /lag|readonly|error|stale/i.test(display(row.status ?? row.health))).length

  return (
    <section className="object-view-section" aria-label="ClickHouse cluster posture">
      <div className="object-view-section-heading">
        <ObjectWarehouseIcon className="panel-inline-icon" />
        <strong>Cluster</strong>
        <span>{clusters.length || replicas.length} node(s)</span>
      </div>
      <div className="object-view-card-grid">
        <Card label="Shards" value={String(shards || '-')} />
        <Card label="Replicas" value={String(replicas.length || '-')} />
        <Card label="Warnings" value={String(unhealthy)} />
      </div>
      {clusters.length ? <ChipRows rows={clusters} labelKey="host" valueKey="shard" /> : null}
    </section>
  )
}

function MaintenancePosture({
  merges,
  mutations,
}: {
  merges: JsonRecord[]
  mutations: JsonRecord[]
}) {
  if (!merges.length && !mutations.length) {
    return null
  }

  const failedMutations = mutations.filter((row) => /fail|error/i.test(display(row.status ?? row.latestFailedPart))).length

  return (
    <section className="object-view-section" aria-label="ClickHouse maintenance posture">
      <div className="object-view-section-heading">
        <ObjectPartitionIcon className="panel-inline-icon" />
        <strong>Maintenance</strong>
        <span>{merges.length + mutations.length} task(s)</span>
      </div>
      <div className="object-view-card-grid">
        <Card label="Merges" value={String(merges.length || '-')} />
        <Card label="Mutations" value={String(mutations.length || '-')} />
        <Card label="Failed" value={String(failedMutations)} />
      </div>
      {mutations.length ? <ChipRows rows={mutations} labelKey="mutationId" valueKey="status" /> : null}
    </section>
  )
}

function ChipRows({
  rows,
  labelKey,
  valueKey,
}: {
  rows: JsonRecord[]
  labelKey: string
  valueKey: string
}) {
  return (
    <div className="object-view-chip-row">
      {rows.slice(0, 8).map((row, index) => (
        <span key={`${display(row[labelKey])}-${index}`}>
          {display(row[labelKey])}
          {' '}
          <strong>{display(row[valueKey])}</strong>
        </span>
      ))}
    </div>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="object-view-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function isClickHouseInsightKind(kind: string) {
  return [
    'database',
    'databases',
    'schema',
    'schemas',
    'table',
    'tables',
    'view',
    'views',
    'materialized-view',
    'materialized-views',
    'warehouse',
    'warehouses',
    'job',
    'jobs',
    'diagnostics',
  ].includes(normalizeKind(kind))
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function firstDisplay(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-'
  }
  if (Array.isArray(value)) {
    return value.map(display).join(', ')
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as JsonRecord)
    return keys.length ? `${keys.length} field${keys.length === 1 ? '' : 's'}` : 'Object'
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }
  return String(value)
}

function numeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[,\s]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function sumNumeric(rows: JsonRecord[], key: string) {
  const total = rows.reduce((sum, row) => sum + numeric(row[key]), 0)
  return total || undefined
}

function maxNumeric(rows: JsonRecord[], key: string) {
  const values = rows.map((row) => numeric(row[key])).filter(Boolean)
  return values.length ? Math.max(...values) : undefined
}

function ratio(numerator: number, denominator: number) {
  if (!numerator || !denominator) {
    return undefined
  }
  return Number((numerator / denominator).toFixed(2))
}

function uniqueCount(values: string[]) {
  return new Set(values.filter((value) => value && value !== '-')).size
}

function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
