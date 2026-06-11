import {
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
  ObjectWarehouseIcon,
} from '../../../icons'

type JsonRecord = Record<string, unknown>

interface WarehouseObjectViewInsightsProps {
  engine: string
  kind: string
  payload: JsonRecord
}

export function WarehouseObjectViewInsights({
  engine,
  kind,
  payload,
}: WarehouseObjectViewInsightsProps) {
  if (!isInsightKind(kind)) {
    return null
  }

  const diagnostics = records(payload.diagnostics)
  const jobs = records(payload.jobs)
  const warehouses = records(payload.warehouses)
  const tables = records(payload.tables)
  const columns = records(payload.columns)
  const materializedViews = records(payload.materializedViews)
  const security = records(payload.security)

  return (
    <>
      <CostPosture engine={engine} payload={payload} diagnostics={diagnostics} jobs={jobs} />
      <ComputePosture payload={payload} diagnostics={diagnostics} jobs={jobs} warehouses={warehouses} />
      <StoragePosture payload={payload} tables={tables} columns={columns} materializedViews={materializedViews} />
      <AccessPosture security={security} />
    </>
  )
}

function CostPosture({
  engine,
  payload,
  diagnostics,
  jobs,
}: {
  engine: string
  payload: JsonRecord
  diagnostics: JsonRecord[]
  jobs: JsonRecord[]
}) {
  const scanned = firstValue(payload.bytesScanned, payload.bytesProcessed, payload.totalBytesProcessed)
  const cost = firstValue(payload.estimatedCost, payload.cost, payload.creditsConsumed)
  const slotOrCredit = firstValue(payload.slotMs, payload.totalSlotMs, payload.credits)
  const failedJobs = firstValue(
    payload.failedJobCount,
    jobs.filter((job) => /failed|error/i.test(displayValue(job.status))).length || undefined,
  )
  const warningSignals = diagnostics.filter((signal) => /watch|warn|high|critical|failed|broad/i.test(displayValue(signal.status ?? signal.signal)))

  if (!hasDisplayValue(scanned) && !hasDisplayValue(cost) && !hasDisplayValue(slotOrCredit) && !jobs.length && !warningSignals.length) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="Warehouse cost posture">
      <div className="object-view-section-heading">
        <ObjectMetricIcon className="panel-inline-icon" />
        <strong>{engineLabel(engine)} Cost</strong>
        <span>{jobs.length || warningSignals.length} signal(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Scanned" value={displayValue(scanned)} />
        <MetricCard label="Cost" value={displayValue(cost)} />
        <MetricCard label="Slots/Credits" value={displayValue(slotOrCredit)} />
        <MetricCard label="Failures" value={displayValue(failedJobs)} />
      </div>
      {warningSignals.length ? (
        <div className="object-view-chip-row">
          {warningSignals.slice(0, 8).map((signal, index) => (
            <span key={`${displayValue(signal.signal)}-${index}`}>
              {displayValue(signal.signal)}
              {' '}
              <strong>{displayValue(signal.value ?? signal.status)}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function ComputePosture({
  payload,
  diagnostics,
  jobs,
  warehouses,
}: {
  payload: JsonRecord
  diagnostics: JsonRecord[]
  jobs: JsonRecord[]
  warehouses: JsonRecord[]
}) {
  const queued = firstValue(payload.queued, sumNumeric(warehouses, 'queued'), diagnostics.find((signal) => /queue/i.test(displayValue(signal.signal)))?.value)
  const running = firstValue(payload.running, sumNumeric(warehouses, 'running'), jobs.filter((job) => /running/i.test(displayValue(job.status))).length || undefined)
  const compute = firstValue(payload.warehouse, payload.warehouseName, payload.reservation, warehouses[0]?.name)
  const duration = firstValue(payload.duration, payload.totalDuration, payload.queryDuration)

  if (!warehouses.length && !jobs.length && !hasDisplayValue(queued) && !hasDisplayValue(running) && !hasDisplayValue(compute)) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="Warehouse compute posture">
      <div className="object-view-section-heading">
        <ObjectWarehouseIcon className="panel-inline-icon" />
        <strong>Compute</strong>
        <span>{warehouses.length || jobs.length} item(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Compute" value={displayValue(compute)} />
        <MetricCard label="Running" value={displayValue(running)} />
        <MetricCard label="Queued" value={displayValue(queued)} />
        <MetricCard label="Duration" value={displayValue(duration)} />
      </div>
      {warehouses.length ? (
        <div className="object-view-chip-row">
          {warehouses.slice(0, 8).map((warehouse, index) => (
            <span key={`${displayValue(warehouse.name)}-${index}`}>
              {displayValue(warehouse.name)}
              {' '}
              <strong>{displayValue(warehouse.state ?? warehouse.size)}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function StoragePosture({
  payload,
  tables,
  columns,
  materializedViews,
}: {
  payload: JsonRecord
  tables: JsonRecord[]
  columns: JsonRecord[]
  materializedViews: JsonRecord[]
}) {
  const storage = firstValue(payload.storageSize, payload.bytesStored, payload.tableSize, tables[0]?.size)
  const tableCount = firstValue(payload.tableCount, tables.length || undefined)
  const partitioned = tables.filter((table) => hasDisplayValue(table.partitioning)).length
  const clustered = tables.filter((table) => hasDisplayValue(table.clustering)).length

  if (!tables.length && !columns.length && !materializedViews.length && !hasDisplayValue(storage)) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="Warehouse storage posture">
      <div className="object-view-section-heading">
        <ObjectTableIcon className="panel-inline-icon" />
        <strong>Storage</strong>
        <span>{tables.length || columns.length} object(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Storage" value={displayValue(storage)} />
        <MetricCard label="Tables" value={displayValue(tableCount)} />
        <MetricCard label="Columns" value={displayValue(columns.length || undefined)} />
        <MetricCard label="Partitions" value={displayValue(partitioned || undefined)} />
        <MetricCard label="Clustering" value={displayValue(clustered || undefined)} />
        <MetricCard label="Materialized" value={displayValue(materializedViews.length || undefined)} />
      </div>
      {tables.length ? (
        <div className="object-view-chip-row">
          {tables.slice(0, 8).map((table, index) => (
            <span key={`${displayValue(table.name)}-${index}`}>
              {displayValue(table.name)}
              {' '}
              <strong>{displayValue(table.rows ?? table.size)}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function AccessPosture({ security }: { security: JsonRecord[] }) {
  if (!security.length) {
    return null
  }

  const principals = uniqueCount(security.map((entry) => displayValue(entry.principal)))
  const roles = uniqueCount(security.map((entry) => displayValue(entry.role)))
  const denied = security.filter((entry) => /deny|blocked|missing/i.test(displayValue(entry.effect ?? entry.status))).length

  return (
    <section className="object-view-section" aria-label="Warehouse access posture">
      <div className="object-view-section-heading">
        <ObjectSecurityIcon className="panel-inline-icon" />
        <strong>Access</strong>
        <span>{security.length} grant(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Principals" value={String(principals)} />
        <MetricCard label="Roles" value={String(roles)} />
        <MetricCard label="Denied" value={String(denied)} />
      </div>
      <div className="object-view-chip-row">
        {security.slice(0, 8).map((entry, index) => (
          <span key={`${displayValue(entry.principal)}-${index}`}>
            {displayValue(entry.principal)}
            {' '}
            <strong>{displayValue(entry.privilege ?? entry.role)}</strong>
          </span>
        ))}
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

function engineLabel(engine: string) {
  if (engine === 'bigquery') return 'BigQuery'
  if (engine === 'snowflake') return 'Snowflake'
  if (engine === 'clickhouse') return 'ClickHouse'
  return 'Warehouse'
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function displayValue(value: unknown): string {
  if (!hasDisplayValue(value)) {
    return '-'
  }
  if (Array.isArray(value)) {
    return value.map(displayValue).join(', ')
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

function hasDisplayValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

function firstValue(...values: unknown[]) {
  return values.find(hasDisplayValue)
}

function sumNumeric(rows: JsonRecord[], key: string) {
  const total = rows.reduce((sum, row) => sum + numeric(row[key]), 0)
  return total || undefined
}

function numeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function uniqueCount(values: string[]) {
  return new Set(values.filter((value) => value && value !== '-')).size
}
