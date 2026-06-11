import { ObjectDatabaseIcon, ObjectJobIcon, ObjectKeyIcon } from '../../icons'

type JsonRecord = Record<string, unknown>

interface CassandraObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function CassandraObjectViewInsights({
  kind,
  payload,
}: CassandraObjectViewInsightsProps) {
  if (!isInsightKind(kind)) {
    return null
  }

  const primaryKey = records(payload.primaryKey)
  const options = records(payload.options)
  const diagnostics = records(payload.diagnostics)
  const warningRows = records(payload.warningRows)
  const nodes = records(payload.nodes)
  const indexes = records(payload.indexes)

  return (
    <>
      <PartitionModel primaryKey={primaryKey} indexes={indexes} />
      <CompactionPosture options={options} warningRows={warningRows} />
      <ClusterHealth diagnostics={diagnostics} nodes={nodes} />
    </>
  )
}

function PartitionModel({
  primaryKey,
  indexes,
}: {
  primaryKey: JsonRecord[]
  indexes: JsonRecord[]
}) {
  if (!primaryKey.length && !indexes.length) {
    return null
  }

  const partitionKeys = primaryKey.filter((key) => /partition/i.test(displayValue(key.role)))
  const clusteringKeys = primaryKey.filter((key) => /clustering/i.test(displayValue(key.role)))

  return (
    <section className="object-view-section" aria-label="Cassandra partition model">
      <div className="object-view-section-heading">
        <ObjectKeyIcon className="panel-inline-icon" />
        <strong>Partition Model</strong>
        <span>{primaryKey.length} key field(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Partition" value={partitionKeys.map((key) => displayValue(key.name)).join(', ') || '-'} />
        <MetricCard label="Clustering" value={clusteringKeys.map((key) => displayValue(key.name)).join(', ') || '-'} />
        <MetricCard label="Indexes" value={String(indexes.length)} />
      </div>
      {primaryKey.length ? (
        <div className="object-view-chip-row">
          {primaryKey.map((key) => (
            <span key={`${displayValue(key.role)}-${displayValue(key.name)}`}>
              {displayValue(key.name)}
              {' '}
              <strong>{displayValue(key.role)}</strong>
              {key.type ? ` ${displayValue(key.type)}` : ''}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function CompactionPosture({
  options,
  warningRows,
}: {
  options: JsonRecord[]
  warningRows: JsonRecord[]
}) {
  if (!options.length && !warningRows.length) {
    return null
  }

  const compaction = options.find((option) => /compaction/i.test(displayValue(option.option)))
  const ttl = options.find((option) => /^ttl|default time to live/i.test(displayValue(option.option)))
  const tombstones = warningRows.filter((warning) => /tombstone/i.test(displayValue(warning.warning))).length

  return (
    <section className="object-view-section" aria-label="Cassandra storage posture">
      <div className="object-view-section-heading">
        <ObjectJobIcon className="panel-inline-icon" />
        <strong>Storage Posture</strong>
        <span>{options.length + warningRows.length} signal(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Compaction" value={displayValue(compaction?.value)} />
        <MetricCard label="TTL" value={displayValue(ttl?.value)} />
        <MetricCard label="Warnings" value={String(warningRows.length)} />
        <MetricCard label="Tombstones" value={String(tombstones)} />
      </div>
      {warningRows.length ? (
        <div className="object-view-chip-row">
          {warningRows.map((warning, index) => (
            <span key={`${displayValue(warning.warning)}-${index}`}>
              {displayValue(warning.warning)}
              {' '}
              <strong>{displayValue(warning.scope)}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function ClusterHealth({
  diagnostics,
  nodes,
}: {
  diagnostics: JsonRecord[]
  nodes: JsonRecord[]
}) {
  if (!diagnostics.length && !nodes.length) {
    return null
  }

  const healthySignals = diagnostics.filter((signal) => /healthy|idle|ok/i.test(displayValue(signal.status))).length
  const watchSignals = diagnostics.filter((signal) => /watch|warning|critical/i.test(displayValue(signal.status))).length
  const upNodes = nodes.filter((node) => /^UN$/i.test(displayValue(node.status))).length

  return (
    <section className="object-view-section" aria-label="Cassandra cluster health">
      <div className="object-view-section-heading">
        <ObjectDatabaseIcon className="panel-inline-icon" />
        <strong>Cluster Health</strong>
        <span>{diagnostics.length + nodes.length} item(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Nodes Up" value={nodes.length ? `${upNodes}/${nodes.length}` : '-'} />
        <MetricCard label="Healthy" value={String(healthySignals)} />
        <MetricCard label="Watch" value={String(watchSignals)} />
      </div>
      {diagnostics.length ? (
        <div className="object-view-table-wrap">
          <table className="object-view-table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Value</th>
                <th>Status</th>
                <th>Guidance</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.slice(0, 12).map((signal, index) => (
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
    'data',
    'columns',
    'primary-key',
    'indexes',
    'statistics',
    'compaction',
    'diagnostics',
    'cluster',
    'tracing',
    'repairs',
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
