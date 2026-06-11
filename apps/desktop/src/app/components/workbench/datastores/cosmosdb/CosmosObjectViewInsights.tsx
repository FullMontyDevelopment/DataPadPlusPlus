import { ObjectCollectionIcon, ObjectIndexIcon, ObjectMetricIcon, ObjectStageIcon } from '../../icons'

type JsonRecord = Record<string, unknown>

interface CosmosObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function CosmosObjectViewInsights({
  kind,
  payload,
}: CosmosObjectViewInsightsProps) {
  if (!isInsightKind(kind)) {
    return null
  }

  const partitionKeys = records(payload.partitionKeys)
  const throughput = records(payload.throughput)
  const diagnostics = records(payload.diagnostics)
  const indexingPolicy = records(payload.indexingPolicy)
  const regions = records(payload.regions)
  const consistency = records(payload.consistency)

  return (
    <>
      <PartitionPosture partitionKeys={partitionKeys} diagnostics={diagnostics} />
      <RuPosture throughput={throughput} diagnostics={diagnostics} />
      <IndexingPosture indexingPolicy={indexingPolicy} />
      <GlobalDistribution regions={regions} consistency={consistency} />
    </>
  )
}

function PartitionPosture({
  partitionKeys,
  diagnostics,
}: {
  partitionKeys: JsonRecord[]
  diagnostics: JsonRecord[]
}) {
  if (!partitionKeys.length) {
    return null
  }

  const hotRisk = partitionKeys.filter((key) => /watch|high|critical/i.test(displayValue(key.hotPartitionRisk))).length
  const throttleSignals = diagnostics.filter((signal) => /throttle/i.test(displayValue(signal.signal)) && numeric(signal.value) > 0).length

  return (
    <section className="object-view-section" aria-label="Cosmos DB partition posture">
      <div className="object-view-section-heading">
        <ObjectCollectionIcon className="panel-inline-icon" />
        <strong>Partition Posture</strong>
        <span>{partitionKeys.length} key path(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Key" value={partitionKeys.map((key) => displayValue(key.path)).join(', ')} />
        <MetricCard label="Risk" value={hotRisk ? 'watch' : 'low'} />
        <MetricCard label="Throttles" value={String(throttleSignals)} />
      </div>
      <div className="object-view-chip-row">
        {partitionKeys.map((key) => (
          <span key={displayValue(key.path)}>
            {displayValue(key.path)}
            {' '}
            <strong>{displayValue(key.hotPartitionRisk)}</strong>
            {key.guidance ? ` ${displayValue(key.guidance)}` : ''}
          </span>
        ))}
      </div>
    </section>
  )
}

function RuPosture({
  throughput,
  diagnostics,
}: {
  throughput: JsonRecord[]
  diagnostics: JsonRecord[]
}) {
  if (!throughput.length && !diagnostics.length) {
    return null
  }

  const ruSignal = diagnostics.find((signal) => /ru consumption/i.test(displayValue(signal.signal)))
  const throttleSignal = diagnostics.find((signal) => /throttled/i.test(displayValue(signal.signal)))
  const latencySignal = diagnostics.find((signal) => /latency/i.test(displayValue(signal.signal)))

  return (
    <section className="object-view-section" aria-label="Cosmos DB RU posture">
      <div className="object-view-section-heading">
        <ObjectMetricIcon className="panel-inline-icon" />
        <strong>RU Posture</strong>
        <span>{throughput.length + diagnostics.length} signal(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Mode" value={displayValue(throughput[0]?.mode)} />
        <MetricCard label="RU/s" value={displayValue(throughput[0]?.ruPerSecond)} />
        <MetricCard label="Usage" value={displayValue(ruSignal?.value)} />
        <MetricCard label="Throttles" value={displayValue(throttleSignal?.value ?? throughput[0]?.throttles)} />
        <MetricCard label="Latency" value={displayValue(latencySignal?.value)} />
      </div>
      {diagnostics.length ? (
        <div className="object-view-table-wrap">
          <table className="object-view-table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Value</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.slice(0, 10).map((signal, index) => (
                <tr key={`${displayValue(signal.signal)}-${index}`}>
                  <td>{displayValue(signal.signal)}</td>
                  <td>{displayValue(signal.value)}</td>
                  <td>{displayValue(signal.status)}</td>
                  <td>{displayValue(signal.guidance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

function IndexingPosture({ indexingPolicy }: { indexingPolicy: JsonRecord[] }) {
  if (!indexingPolicy.length) {
    return null
  }

  const included = indexingPolicy.filter((path) => /included|range|composite/i.test(displayValue(path.kind))).length
  const excluded = indexingPolicy.filter((path) => /excluded/i.test(displayValue(path.kind))).length
  const composite = indexingPolicy.filter((path) => /composite/i.test(displayValue(path.mode))).length

  return (
    <section className="object-view-section" aria-label="Cosmos DB indexing posture">
      <div className="object-view-section-heading">
        <ObjectIndexIcon className="panel-inline-icon" />
        <strong>Indexing</strong>
        <span>{indexingPolicy.length} path(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Included" value={String(included)} />
        <MetricCard label="Excluded" value={String(excluded)} />
        <MetricCard label="Composite" value={String(composite)} />
      </div>
      <div className="object-view-chip-row">
        {indexingPolicy.slice(0, 12).map((path, index) => (
          <span key={`${displayValue(path.path)}-${index}`}>
            {displayValue(path.path)}
            {' '}
            <strong>{displayValue(path.kind)}</strong>
          </span>
        ))}
      </div>
    </section>
  )
}

function GlobalDistribution({
  regions,
  consistency,
}: {
  regions: JsonRecord[]
  consistency: JsonRecord[]
}) {
  if (!regions.length && !consistency.length) {
    return null
  }

  const writeRegion = regions.find((region) => /write/i.test(displayValue(region.role)))
  const onlineRegions = regions.filter((region) => /online|healthy/i.test(displayValue(region.status))).length
  const defaultConsistency = consistency.find((entry) => /default/i.test(displayValue(entry.setting)))

  return (
    <section className="object-view-section" aria-label="Cosmos DB global distribution">
      <div className="object-view-section-heading">
        <ObjectStageIcon className="panel-inline-icon" />
        <strong>Global Distribution</strong>
        <span>{regions.length || consistency.length} item(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Write" value={displayValue(writeRegion?.name)} />
        <MetricCard label="Online" value={regions.length ? `${onlineRegions}/${regions.length}` : '-'} />
        <MetricCard label="Consistency" value={displayValue(defaultConsistency?.value)} />
      </div>
      {regions.length ? (
        <div className="object-view-chip-row">
          {regions.map((region) => (
            <span key={displayValue(region.name)}>
              {displayValue(region.name)}
              {' '}
              <strong>{displayValue(region.role)}</strong>
              {region.status ? ` ${displayValue(region.status)}` : ''}
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
    'account',
    'database',
    'container',
    'containers',
    'items',
    'partition-key',
    'indexing-policy',
    'throughput',
    'regions',
    'consistency',
    'diagnostics',
    'change-feed',
    'conflicts',
  ].includes(kind)
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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
