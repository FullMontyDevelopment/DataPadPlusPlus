import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { ObjectIndexIcon, ObjectJobIcon, ObjectSearchIcon } from './icons'
import { SearchObjectViewPostures } from './SearchObjectViewPostures'

type JsonRecord = Record<string, unknown>

interface SearchObjectViewInsightsProps {
  connection: ConnectionProfile
  kind: string
  payload: JsonRecord
}

export function SearchObjectViewInsights({
  connection,
  kind,
  payload,
}: SearchObjectViewInsightsProps) {
  const fields = records(payload.fields).length ? records(payload.fields) : records(payload.mappings)
  const shards = records(payload.shards)
  const lifecyclePolicies = records(payload.lifecyclePolicies)

  if (!isInsightKind(kind)) {
    return null
  }

  return (
    <>
      <SearchObjectViewPostures payload={payload} />
      <FieldCapabilities fields={fields} />
      <ShardHealth shards={shards} />
      <LifecycleStatus
        connection={connection}
        lifecyclePolicies={lifecyclePolicies}
      />
    </>
  )
}

function FieldCapabilities({ fields }: { fields: JsonRecord[] }) {
  if (!fields.length) {
    return null
  }

  const searchable = fields.filter((field) => booleanValue(field.searchable)).length
  const aggregatable = fields.filter((field) => booleanValue(field.aggregatable)).length
  const vectorFields = fields.filter((field) => /dense_vector|knn_vector|sparse_vector|rank_features/i.test(stringValue(field.type))).length

  return (
    <section className="object-view-section" aria-label="Field capabilities">
      <div className="object-view-section-heading">
        <ObjectSearchIcon className="panel-inline-icon" />
        <strong>Field Capabilities</strong>
        <span>{fields.length} field(s)</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Searchable" value={`${searchable}/${fields.length}`} />
        <MetricCard label="Aggregatable" value={`${aggregatable}/${fields.length}`} />
        <MetricCard label="Vector" value={String(vectorFields)} />
      </div>
      <div className="object-view-chip-row">
        {fields.slice(0, 16).map((field) => (
          <span key={stringValue(field.path) || JSON.stringify(field)}>
            {displayValue(field.path)}
            {' '}
            <strong>{displayValue(field.type)}</strong>
            {booleanValue(field.searchable) ? ' search' : ''}
            {booleanValue(field.aggregatable) ? ' agg' : ''}
          </span>
        ))}
      </div>
    </section>
  )
}

function ShardHealth({ shards }: { shards: JsonRecord[] }) {
  if (!shards.length) {
    return null
  }

  const started = shards.filter((shard) => stringValue(shard.state).toUpperCase() === 'STARTED').length
  const primary = shards.filter((shard) => booleanValue(shard.primary)).length
  const replica = Math.max(0, shards.length - primary)

  return (
    <section className="object-view-section" aria-label="Shard health">
      <div className="object-view-section-heading">
        <ObjectIndexIcon className="panel-inline-icon" />
        <strong>Shard Health</strong>
        <span>{started}/{shards.length} started</span>
      </div>
      <div className="object-view-card-grid">
        <MetricCard label="Primary" value={String(primary)} />
        <MetricCard label="Replica" value={String(replica)} />
        <MetricCard label="Started" value={`${started}/${shards.length}`} />
      </div>
      <div className="object-view-table-wrap">
        <table className="object-view-table">
          <thead>
            <tr>
              <th>Index</th>
              <th>Shard</th>
              <th>Role</th>
              <th>State</th>
              <th>Node</th>
              <th>Docs</th>
              <th>Storage</th>
            </tr>
          </thead>
          <tbody>
            {shards.slice(0, 24).map((shard, index) => (
              <tr key={`${displayValue(shard.index)}-${displayValue(shard.shard)}-${index}`}>
                <td>{displayValue(shard.index)}</td>
                <td>{displayValue(shard.shard)}</td>
                <td>{booleanValue(shard.primary) ? 'primary' : 'replica'}</td>
                <td>{displayValue(shard.state)}</td>
                <td>{displayValue(shard.node)}</td>
                <td>{displayValue(shard.documents)}</td>
                <td>{displayValue(shard.storage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}


function LifecycleStatus({
  connection,
  lifecyclePolicies,
}: {
  connection: ConnectionProfile
  lifecyclePolicies: JsonRecord[]
}) {
  if (!lifecyclePolicies.length) {
    return null
  }

  const label = connection.engine === 'opensearch' ? 'ISM' : 'ILM'

  return (
    <section className="object-view-section" aria-label="Lifecycle status">
      <div className="object-view-section-heading">
        <ObjectJobIcon className="panel-inline-icon" />
        <strong>{label} Lifecycle</strong>
        <span>{lifecyclePolicies.length} policy item(s)</span>
      </div>
      <div className="object-view-chip-row">
        {lifecyclePolicies.map((policy) => (
          <span key={stringValue(policy.name) || JSON.stringify(policy)}>
            {displayValue(policy.name)}
            {' '}
            <strong>{displayValue(policy.phase ?? policy.status)}</strong>
            {policy.managedIndices !== undefined ? ` ${displayValue(policy.managedIndices)} index(es)` : ''}
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
    'cluster',
    'diagnostics',
    'index',
    'indices',
    'data-stream',
    'data-streams',
    'documents',
    'mappings',
    'mapping',
    'shards',
    'lifecycle-policies',
    'segments',
    'templates',
    'index-template',
    'component-template',
    'pipelines',
    'pipeline',
    'security',
    'users',
    'roles',
    'api-keys',
  ].includes(kind)
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

function booleanValue(value: unknown) {
  return value === true || value === 'true'
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
