import {
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectSeriesIcon,
  ObjectStageIcon,
} from '../../../icons'

type JsonRecord = Record<string, unknown>

interface TimeSeriesObjectViewInsightsProps {
  engine: string
  kind: string
  payload: JsonRecord
}

export function TimeSeriesObjectViewInsights({
  engine,
  kind,
  payload,
}: TimeSeriesObjectViewInsightsProps) {
  if (!isInsightKind(kind)) {
    return null
  }

  const metrics = records(payload.metrics)
  const measurements = records(payload.measurements)
  const series = records(payload.series)
  const labels = records(payload.labels)
  const tags = records(payload.tags)
  const targets = records(payload.targets)
  const tasks = records(payload.tasks)
  const rules = records(payload.rules)
  const alerts = records(payload.alerts)
  const diagnostics = records(payload.diagnostics)
  const uidMetadata = records(payload.uidMetadata)

  return (
    <>
      <CardinalityPosture
        engine={engine}
        payload={payload}
        metrics={metrics}
        measurements={measurements}
        series={series}
        labels={labels}
        tags={tags}
        diagnostics={diagnostics}
      />
      <IngestionPosture
        engine={engine}
        payload={payload}
        metrics={metrics}
        measurements={measurements}
        series={series}
        targets={targets}
        diagnostics={diagnostics}
      />
      <RetentionPosture payload={payload} tasks={tasks} diagnostics={diagnostics} />
      <GovernancePosture
        engine={engine}
        payload={payload}
        rules={rules}
        alerts={alerts}
        tasks={tasks}
        uidMetadata={uidMetadata}
        diagnostics={diagnostics}
      />
    </>
  )
}

function CardinalityPosture({
  engine,
  payload,
  metrics,
  measurements,
  series,
  labels,
  tags,
  diagnostics,
}: {
  engine: string
  payload: JsonRecord
  metrics: JsonRecord[]
  measurements: JsonRecord[]
  series: JsonRecord[]
  labels: JsonRecord[]
  tags: JsonRecord[]
  diagnostics: JsonRecord[]
}) {
  const dimensionRows = labels.length ? labels : tags
  const highRiskDimensions = dimensionRows.filter((row) => /high|expensive|watch|critical/i.test(displayValue(row.cardinality ?? row.risk))).length
  const cardinalitySignal = diagnostics.find((signal) => /cardinality/i.test(displayValue(signal.signal)))
  const objectCount = firstValue(payload.metricCount, payload.measurementCount, metrics.length || measurements.length || undefined)
  const seriesCount = firstValue(payload.seriesCount, series.length || undefined)

  if (!hasDisplayValue(objectCount) && !hasDisplayValue(seriesCount) && !dimensionRows.length && !cardinalitySignal) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="Time-series cardinality posture">
      <div className="object-view-section-heading">
        <ObjectSeriesIcon className="panel-inline-icon" />
        <strong>{engineLabel(engine)} Cardinality</strong>
        <span>{dimensionRows.length} dimension(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Objects" value={displayValue(objectCount)} />
        <MetricCard label="Series" value={displayValue(seriesCount)} />
        <MetricCard label="High Risk" value={String(highRiskDimensions)} />
        <MetricCard label="Signal" value={displayValue(cardinalitySignal?.value ?? cardinalitySignal?.status)} />
      </div>
      {dimensionRows.length ? (
        <div className="object-view-chip-row">
          {dimensionRows.slice(0, 8).map((dimension, index) => (
            <span key={`${displayValue(dimension.name)}-${index}`}>
              {displayValue(dimension.name)}
              {' '}
              <strong>{displayValue(dimension.valueCount ?? dimension.cardinality ?? dimension.risk)}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function IngestionPosture({
  engine,
  payload,
  metrics,
  measurements,
  series,
  targets,
  diagnostics,
}: {
  engine: string
  payload: JsonRecord
  metrics: JsonRecord[]
  measurements: JsonRecord[]
  series: JsonRecord[]
  targets: JsonRecord[]
  diagnostics: JsonRecord[]
}) {
  const upTargets = firstValue(payload.upTargets, targets.filter((target) => /up|healthy|active/i.test(displayValue(target.health ?? target.status))).length || undefined)
  const downTargets = firstValue(payload.downTargets, targets.filter((target) => /down|failed|unhealthy/i.test(displayValue(target.health ?? target.status))).length || undefined)
  const sampleRate = firstValue(payload.samplesPerSecond, payload.writesPerSecond, firstNonEmpty(metrics, 'samples'), firstNonEmpty(series, 'sampleRate'), firstNonEmpty(measurements, 'lastWrite'))
  const latestWrite = firstValue(payload.lastWrite, firstNonEmpty(measurements, 'lastWrite'), firstNonEmpty(metrics, 'lastWrite'))
  const scrapeSignal = diagnostics.find((signal) => /scrape|write|ingest|target/i.test(displayValue(signal.signal)))

  if (!hasDisplayValue(upTargets) && !hasDisplayValue(downTargets) && !hasDisplayValue(sampleRate) && !hasDisplayValue(latestWrite) && !scrapeSignal) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="Time-series ingestion posture">
      <div className="object-view-section-heading">
        <ObjectMetricIcon className="panel-inline-icon" />
        <strong>{engine === 'prometheus' ? 'Scrape' : 'Ingestion'}</strong>
        <span>{metrics.length || measurements.length || series.length} signal(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Healthy" value={displayValue(upTargets)} />
        <MetricCard label="Down" value={displayValue(downTargets)} />
        <MetricCard label="Rate" value={displayValue(sampleRate)} />
        <MetricCard label="Latest" value={displayValue(latestWrite)} />
      </div>
      {scrapeSignal ? (
        <div className="object-view-chip-row">
          <span>
            {displayValue(scrapeSignal.signal)}
            {' '}
            <strong>{displayValue(scrapeSignal.value ?? scrapeSignal.status)}</strong>
          </span>
        </div>
      ) : null}
    </section>
  )
}

function RetentionPosture({
  payload,
  tasks,
  diagnostics,
}: {
  payload: JsonRecord
  tasks: JsonRecord[]
  diagnostics: JsonRecord[]
}) {
  const retention = firstValue(payload.retention, payload.retentionPolicy, payload.retentionPeriod)
  const storage = firstValue(payload.storage, payload.storageSize, payload.bytesStored)
  const bucket = firstValue(payload.bucket, payload.database)
  const taskCount = firstValue(payload.taskCount, tasks.length || undefined)
  const storageSignal = diagnostics.find((signal) => /storage|retention|compaction|block/i.test(displayValue(signal.signal)))

  if (!hasDisplayValue(retention) && !hasDisplayValue(storage) && !hasDisplayValue(bucket) && !hasDisplayValue(taskCount) && !storageSignal) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="Time-series retention posture">
      <div className="object-view-section-heading">
        <ObjectStageIcon className="panel-inline-icon" />
        <strong>Retention</strong>
        <span>{tasks.length} task(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Bucket" value={displayValue(bucket)} />
        <MetricCard label="Retention" value={displayValue(retention)} />
        <MetricCard label="Storage" value={displayValue(storage)} />
        <MetricCard label="Tasks" value={displayValue(taskCount)} />
      </div>
      {tasks.length ? (
        <div className="object-view-chip-row">
          {tasks.slice(0, 8).map((task, index) => (
            <span key={`${displayValue(task.name)}-${index}`}>
              {displayValue(task.name)}
              {' '}
              <strong>{displayValue(task.status ?? task.lastRun)}</strong>
            </span>
          ))}
        </div>
      ) : storageSignal ? (
        <div className="object-view-chip-row">
          <span>
            {displayValue(storageSignal.signal)}
            {' '}
            <strong>{displayValue(storageSignal.value ?? storageSignal.status)}</strong>
          </span>
        </div>
      ) : null}
    </section>
  )
}

function GovernancePosture({
  engine,
  payload,
  rules,
  alerts,
  tasks,
  uidMetadata,
  diagnostics,
}: {
  engine: string
  payload: JsonRecord
  rules: JsonRecord[]
  alerts: JsonRecord[]
  tasks: JsonRecord[]
  uidMetadata: JsonRecord[]
  diagnostics: JsonRecord[]
}) {
  const ruleCount = firstValue(payload.ruleCount, rules.length || undefined)
  const alertCount = firstValue(payload.alertCount, alerts.length || undefined)
  const uidCount = firstValue(payload.uidCount, uidMetadata.length || undefined)
  const warningCount = diagnostics.filter((signal) => /watch|warn|critical|failed|expensive/i.test(displayValue(signal.status ?? signal.risk ?? signal.signal))).length

  if (!hasDisplayValue(ruleCount) && !hasDisplayValue(alertCount) && !hasDisplayValue(uidCount) && !tasks.length && !warningCount) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="Time-series governance posture">
      <div className="object-view-section-heading">
        <ObjectSecurityIcon className="panel-inline-icon" />
        <strong>{engine === 'opentsdb' ? 'UID Health' : 'Controls'}</strong>
        <span>{warningCount} warning(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Rules" value={displayValue(ruleCount)} />
        <MetricCard label="Alerts" value={displayValue(alertCount)} />
        <MetricCard label="UIDs" value={displayValue(uidCount)} />
        <MetricCard label="Warnings" value={String(warningCount)} />
      </div>
      {uidMetadata.length ? (
        <div className="object-view-chip-row">
          {uidMetadata.slice(0, 8).map((entry, index) => (
            <span key={`${displayValue(entry.name)}-${index}`}>
              {displayValue(entry.name)}
              {' '}
              <strong>{displayValue(entry.uid)}</strong>
            </span>
          ))}
        </div>
      ) : null}
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
    'metric',
    'metrics',
    'series',
    'label',
    'labels',
    'target',
    'targets',
    'rule',
    'rules',
    'alert',
    'alerts',
    'bucket',
    'buckets',
    'measurement',
    'measurements',
    'tag',
    'tags',
    'field',
    'fields',
    'task',
    'tasks',
    'retention',
    'retention-policies',
    'uid',
    'uid-metadata',
    'tree',
    'trees',
    'stats',
    'diagnostics',
  ].includes(kind.trim().toLowerCase().replace(/[_\s]+/g, '-'))
}

function engineLabel(engine: string) {
  if (engine === 'prometheus') return 'Prometheus'
  if (engine === 'influxdb') return 'InfluxDB'
  if (engine === 'opentsdb') return 'OpenTSDB'
  return 'Time-Series'
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function firstNonEmpty(rows: JsonRecord[], key: string) {
  return rows.map((row) => row[key]).find(hasDisplayValue)
}

function firstValue(...values: unknown[]) {
  return values.find(hasDisplayValue)
}

function hasDisplayValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
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
