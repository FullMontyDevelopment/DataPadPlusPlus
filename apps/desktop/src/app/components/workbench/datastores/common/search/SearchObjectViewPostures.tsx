import { ObjectIndexIcon, ObjectJobIcon, ObjectSearchIcon, ObjectSecurityIcon } from '../../../icons'

type JsonRecord = Record<string, unknown>

interface SearchObjectViewPosturesProps {
  payload: JsonRecord
}

export function SearchObjectViewPostures({ payload }: SearchObjectViewPosturesProps) {
  const nodes = records(payload.nodes)
  const shards = records(payload.shards)
  const segments = records(payload.segments)
  const pipelines = records(payload.pipelines)
  const templates = records(payload.templates)
  const users = records(payload.users)
  const roles = records(payload.roles)
  const apiKeys = records(payload.apiKeys)

  return (
    <>
      <ClusterPosture payload={payload} nodes={nodes} shards={shards} />
      <SegmentPressure segments={segments} />
      <PipelineTemplatePosture pipelines={pipelines} templates={templates} />
      <SecurityPosture users={users} roles={roles} apiKeys={apiKeys} />
    </>
  )
}

function ClusterPosture({
  payload,
  nodes,
  shards,
}: {
  payload: JsonRecord
  nodes: JsonRecord[]
  shards: JsonRecord[]
}) {
  if (!nodes.length && !shards.length && !hasAny(payload, ['health', 'status', 'nodeCount', 'shardCount'])) {
    return null
  }

  const onlineNodes = nodes.filter((node) => /online|green|started/i.test(displayValue(node.status))).length
  const relocating = shards.filter((shard) => /relocat|initializ|unassign/i.test(displayValue(shard.state))).length
  const pressureWarnings = nodes.filter((node) => percentValue(node.heapUsed) >= 75 || percentValue(node.diskUsed) >= 80).length

  return (
    <section className="object-view-section" aria-label="Search cluster posture">
      <div className="object-view-section-heading">
        <ObjectSearchIcon className="panel-inline-icon" />
        <strong>Cluster</strong>
        <span>{displayValue(payload.health ?? payload.status)}</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Nodes" value={nodes.length ? `${onlineNodes}/${nodes.length}` : displayValue(payload.nodeCount)} />
        <MetricCard label="Shards" value={shards.length ? String(shards.length) : displayValue(payload.shardCount)} />
        <MetricCard label="Relocating" value={String(relocating)} />
        <MetricCard label="Pressure" value={`${pressureWarnings} warning(s)`} />
      </div>
      {nodes.length ? (
        <div className="object-view-chip-row">
          {nodes.slice(0, 12).map((node) => (
            <span key={stringValue(node.name) || JSON.stringify(node)}>
              {displayValue(node.name)}
              {' '}
              <strong>{displayValue(node.roles)}</strong>
              {' '}
              {displayValue(node.heapUsed)} heap
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function SegmentPressure({ segments }: { segments: JsonRecord[] }) {
  if (!segments.length) {
    return null
  }

  const totalSegments = segments.reduce((total, segment) => total + numberValue(segment.segments), 0)
  const deletedDocs = segments.reduce((total, segment) => total + numberValue(segment.deletedDocs), 0)

  return (
    <section className="object-view-section" aria-label="Lucene segment posture">
      <div className="object-view-section-heading">
        <ObjectIndexIcon className="panel-inline-icon" />
        <strong>Segments</strong>
        <span>{totalSegments} segment(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Deleted Docs" value={deletedDocs.toLocaleString()} />
        <MetricCard label="Indexes" value={String(uniqueCount(segments.map((segment) => stringValue(segment.index))))} />
        <MetricCard label="Memory" value={segments.map((segment) => displayValue(segment.memory)).filter((value) => value !== '-').join(' / ') || '-'} />
      </div>
      <div className="object-view-chip-row">
        {segments.slice(0, 12).map((segment, index) => (
          <span key={`${displayValue(segment.index)}-${index}`}>
            {displayValue(segment.index)}
            {' '}
            <strong>{displayValue(segment.segments)}</strong>
            {' segments'}
          </span>
        ))}
      </div>
    </section>
  )
}

function PipelineTemplatePosture({
  pipelines,
  templates,
}: {
  pipelines: JsonRecord[]
  templates: JsonRecord[]
}) {
  if (!pipelines.length && !templates.length) {
    return null
  }

  return (
    <section className="object-view-section" aria-label="Search ingestion posture">
      <div className="object-view-section-heading">
        <ObjectJobIcon className="panel-inline-icon" />
        <strong>Ingestion</strong>
        <span>{pipelines.length + templates.length} asset(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Pipelines" value={String(pipelines.length)} />
        <MetricCard label="Templates" value={String(templates.length)} />
        <MetricCard label="Failures" value={String(pipelines.filter((pipeline) => displayValue(pipeline.onFailure) !== '-').length)} />
      </div>
      <div className="object-view-chip-row">
        {[...pipelines, ...templates].slice(0, 12).map((item) => (
          <span key={stringValue(item.name) || JSON.stringify(item)}>
            {displayValue(item.name)}
            {' '}
            <strong>{displayValue(item.type ?? item.processors ?? item.priority)}</strong>
          </span>
        ))}
      </div>
    </section>
  )
}

function SecurityPosture({
  users,
  roles,
  apiKeys,
}: {
  users: JsonRecord[]
  roles: JsonRecord[]
  apiKeys: JsonRecord[]
}) {
  if (!users.length && !roles.length && !apiKeys.length) {
    return null
  }

  const disabledUsers = users.filter((user) => user.enabled === false || displayValue(user.enabled) === 'no').length
  const expiredKeys = apiKeys.filter((key) => /expired|invalid/i.test(displayValue(key.status))).length

  return (
    <section className="object-view-section" aria-label="Search security posture">
      <div className="object-view-section-heading">
        <ObjectSecurityIcon className="panel-inline-icon" />
        <strong>Security</strong>
        <span>{users.length + roles.length + apiKeys.length} item(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Users" value={`${users.length - disabledUsers}/${users.length}`} />
        <MetricCard label="Roles" value={String(roles.length)} />
        <MetricCard label="API Keys" value={`${Math.max(0, apiKeys.length - expiredKeys)}/${apiKeys.length}`} />
      </div>
      <div className="object-view-chip-row">
        {[...users, ...roles, ...apiKeys].slice(0, 12).map((item) => (
          <span key={stringValue(item.name) || JSON.stringify(item)}>
            {displayValue(item.name)}
            {' '}
            <strong>{displayValue(item.realm ?? item.owner ?? item.clusterPrivileges ?? item.status)}</strong>
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

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
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

function percentValue(value: unknown) {
  return numberValue(value)
}

function uniqueCount(values: string[]) {
  return new Set(values.filter(Boolean)).size
}

function hasAny(record: JsonRecord, keys: string[]) {
  return keys.some((key) => record[key] !== undefined && record[key] !== null && record[key] !== '')
}

function displayValue(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return '-'
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }

  return String(value)
}
