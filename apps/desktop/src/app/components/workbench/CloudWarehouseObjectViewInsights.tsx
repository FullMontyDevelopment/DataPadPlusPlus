import {
  ObjectJobIcon,
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
  ObjectWarehouseIcon,
} from './icons'

type JsonRecord = Record<string, unknown>

interface CloudWarehouseObjectViewInsightsProps {
  engine: string
  kind: string
  payload: JsonRecord
}

export function CloudWarehouseObjectViewInsights({
  engine,
  kind,
  payload,
}: CloudWarehouseObjectViewInsightsProps) {
  if (!isCloudWarehouse(engine) || !isCloudInsightKind(kind)) {
    return null
  }

  const queryHistory = records(payload.queryHistory)
  const warehouseLoad = records(payload.warehouseLoad)
  const credits = records(payload.credits)
  const jobTimeline = records(payload.jobTimeline)
  const reservations = records(payload.reservations)
  const slotUsage = records(payload.slotUsage)
  const scheduledQueries = records(payload.scheduledQueries)
  const tableStorage = records(payload.tableStorage)
  const iamBindings = records(payload.iamBindings)
  const streams = records(payload.streams)
  const shares = records(payload.shares)

  if (
    !queryHistory.length &&
    !warehouseLoad.length &&
    !credits.length &&
    !jobTimeline.length &&
    !reservations.length &&
    !slotUsage.length &&
    !scheduledQueries.length &&
    !tableStorage.length &&
    !iamBindings.length &&
    !streams.length &&
    !shares.length
  ) {
    return null
  }

  return engine === 'bigquery' ? (
    <>
      <BigQueryJobPosture payload={payload} jobTimeline={jobTimeline} />
      <BigQueryReservationPosture reservations={reservations} slotUsage={slotUsage} />
      <BigQueryStoragePosture tableStorage={tableStorage} />
      <CloudAccessPosture title="IAM" rows={iamBindings} />
    </>
  ) : (
    <>
      <SnowflakeQueryPosture payload={payload} queryHistory={queryHistory} credits={credits} />
      <SnowflakeWarehousePosture payload={payload} warehouseLoad={warehouseLoad} />
      <SnowflakeDataFlowPosture streams={streams} shares={shares} />
      <CloudAccessPosture title="Grants" rows={records(payload.security)} />
    </>
  )
}

function BigQueryJobPosture({
  payload,
  jobTimeline,
}: {
  payload: JsonRecord
  jobTimeline: JsonRecord[]
}) {
  const failed = jobTimeline.filter((job) => /fail|error/i.test(display(job.state ?? job.status))).length

  return (
    <section className="object-view-section" aria-label="BigQuery job posture">
      <div className="object-view-section-heading">
        <ObjectJobIcon className="panel-inline-icon" />
        <strong>Jobs</strong>
        <span>{jobTimeline.length} job(s)</span>
      </div>
      <div className="object-view-card-grid">
        <Card label="Processed" value={display(firstValue(payload.totalBytesProcessed, payload.bytesProcessed))} />
        <Card label="Slot Time" value={display(firstValue(payload.totalSlotMs, payload.slotMs))} />
        <Card label="Estimate" value={display(payload.estimatedCost)} />
        <Card label="Failures" value={String(failed)} />
      </div>
      {jobTimeline.length ? <ChipRows rows={jobTimeline} labelKey="jobId" valueKey="duration" /> : null}
    </section>
  )
}

function BigQueryReservationPosture({
  reservations,
  slotUsage,
}: {
  reservations: JsonRecord[]
  slotUsage: JsonRecord[]
}) {
  if (!reservations.length && !slotUsage.length) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="BigQuery reservation posture">
      <div className="object-view-section-heading">
        <ObjectWarehouseIcon className="panel-inline-icon" />
        <strong>Reservations</strong>
        <span>{reservations.length || slotUsage.length} item(s)</span>
      </div>
      <div className="object-view-card-grid">
        <Card label="Reservations" value={String(reservations.length || '-')} />
        <Card label="Slots" value={display(sumNumeric(reservations, 'slots'))} />
        <Card label="Idle Slots" value={display(sumNumeric(reservations, 'idleSlots'))} />
        <Card label="Slot Usage" value={display(slotUsage[0]?.utilization)} />
      </div>
      {slotUsage.length ? <ChipRows rows={slotUsage} labelKey="reservation" valueKey="utilization" /> : null}
    </section>
  )
}

function BigQueryStoragePosture({ tableStorage }: { tableStorage: JsonRecord[] }) {
  if (!tableStorage.length) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="BigQuery storage posture">
      <div className="object-view-section-heading">
        <ObjectTableIcon className="panel-inline-icon" />
        <strong>Storage</strong>
        <span>{tableStorage.length} table(s)</span>
      </div>
      <div className="object-view-card-grid">
        <Card label="Tables" value={String(tableStorage.length)} />
        <Card label="Largest" value={display(tableStorage[0]?.bytes)} />
        <Card label="Long Term" value={display(tableStorage[0]?.longTermBytes)} />
        <Card label="Partitions" value={display(sumNumeric(tableStorage, 'partitions'))} />
      </div>
      <ChipRows rows={tableStorage} labelKey="table" valueKey="bytes" />
    </section>
  )
}

function SnowflakeQueryPosture({
  payload,
  queryHistory,
  credits,
}: {
  payload: JsonRecord
  queryHistory: JsonRecord[]
  credits: JsonRecord[]
}) {
  const failed = queryHistory.filter((query) => /fail|error/i.test(display(query.status))).length

  return (
    <section className="object-view-section" aria-label="Snowflake query posture">
      <div className="object-view-section-heading">
        <ObjectMetricIcon className="panel-inline-icon" />
        <strong>Query History</strong>
        <span>{queryHistory.length} query(s)</span>
      </div>
      <div className="object-view-card-grid">
        <Card label="Credits" value={display(firstValue(payload.creditsConsumed, credits[0]?.credits))} />
        <Card label="Scanned" value={display(payload.bytesScanned)} />
        <Card label="Failures" value={String(failed)} />
        <Card label="Warehouses" value={String(uniqueCount(queryHistory.map((row) => display(row.warehouse))) || '-')} />
      </div>
      {queryHistory.length ? <ChipRows rows={queryHistory} labelKey="queryId" valueKey="duration" /> : null}
    </section>
  )
}

function SnowflakeWarehousePosture({
  payload,
  warehouseLoad,
}: {
  payload: JsonRecord
  warehouseLoad: JsonRecord[]
}) {
  if (!warehouseLoad.length && !hasValue(payload.queued) && !hasValue(payload.running)) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="Snowflake warehouse posture">
      <div className="object-view-section-heading">
        <ObjectWarehouseIcon className="panel-inline-icon" />
        <strong>Warehouses</strong>
        <span>{warehouseLoad.length} warehouse(s)</span>
      </div>
      <div className="object-view-card-grid">
        <Card label="Running" value={display(firstValue(payload.running, sumNumeric(warehouseLoad, 'running')))} />
        <Card label="Queued" value={display(firstValue(payload.queued, sumNumeric(warehouseLoad, 'queued')))} />
        <Card label="Load" value={display(warehouseLoad[0]?.load)} />
        <Card label="Credits" value={display(sumNumeric(warehouseLoad, 'credits'))} />
      </div>
      {warehouseLoad.length ? <ChipRows rows={warehouseLoad} labelKey="warehouse" valueKey="state" /> : null}
    </section>
  )
}

function SnowflakeDataFlowPosture({
  streams,
  shares,
}: {
  streams: JsonRecord[]
  shares: JsonRecord[]
}) {
  if (!streams.length && !shares.length) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="Snowflake data flow posture">
      <div className="object-view-section-heading">
        <ObjectTableIcon className="panel-inline-icon" />
        <strong>Data Flow</strong>
        <span>{streams.length + shares.length} object(s)</span>
      </div>
      <div className="object-view-card-grid">
        <Card label="Streams" value={String(streams.length || '-')} />
        <Card label="Shares" value={String(shares.length || '-')} />
        <Card label="Stale" value={String(streams.filter((stream) => /yes|true/i.test(display(stream.stale))).length)} />
      </div>
      {streams.length ? <ChipRows rows={streams} labelKey="name" valueKey="table" /> : <ChipRows rows={shares} labelKey="name" valueKey="status" />}
    </section>
  )
}

function CloudAccessPosture({
  title,
  rows,
}: {
  title: string
  rows: JsonRecord[]
}) {
  if (!rows.length) {
    return null
  }

  return (
    <section className="object-view-section" aria-label={`${title} posture`}>
      <div className="object-view-section-heading">
        <ObjectSecurityIcon className="panel-inline-icon" />
        <strong>{title}</strong>
        <span>{rows.length} entry(s)</span>
      </div>
      <div className="object-view-card-grid">
        <Card label="Principals" value={String(uniqueCount(rows.map((row) => display(row.principal))))} />
        <Card label="Roles" value={String(uniqueCount(rows.map((row) => display(row.role))))} />
        <Card label="Resources" value={String(uniqueCount(rows.map((row) => display(row.resource ?? row.object))))} />
      </div>
      <ChipRows rows={rows} labelKey="principal" valueKey="role" />
    </section>
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

function isCloudWarehouse(engine: string) {
  return engine === 'snowflake' || engine === 'bigquery'
}

function isCloudInsightKind(kind: string) {
  return [
    'database',
    'databases',
    'dataset',
    'datasets',
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
    'task',
    'tasks',
    'security',
    'diagnostics',
  ].includes(kind.trim().toLowerCase().replace(/[_\s]+/g, '-'))
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function firstValue(...values: unknown[]) {
  return values.find(hasValue)
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

function display(value: unknown): string {
  if (!hasValue(value)) {
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
    const parsed = Number(value.replace(/[^\d.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function sumNumeric(rows: JsonRecord[], key: string) {
  const total = rows.reduce((sum, row) => sum + numeric(row[key]), 0)
  return total || undefined
}

function uniqueCount(values: string[]) {
  return new Set(values.filter((value) => value && value !== '-')).size
}
