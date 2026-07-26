import { useState } from 'react'
import { humanize, isSensitiveMetadataKey } from './DatastoreExplorerProvider.model'

const MAX_DEPTH = 4
const MAX_ITEMS = 25
const MAX_TEXT = 240

export function DatastoreExplorerStructuredValue({
  value,
  depth = 0,
}: {
  value: unknown
  depth?: number
}) {
  if (value === null || value === undefined) {
    return <span className="datastore-explorer-value is-null">null</span>
  }
  if (typeof value === 'boolean') {
    return <span className="datastore-explorer-value is-boolean">{value ? 'True' : 'False'}</span>
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return <span className="datastore-explorer-value is-number">{String(value)}</span>
  }
  if (typeof value === 'string') {
    return <span className="datastore-explorer-value">{truncate(value, MAX_TEXT)}</span>
  }
  if (depth >= MAX_DEPTH) {
    return <span className="datastore-explorer-value is-muted">Nested value</span>
  }
  if (Array.isArray(value)) {
    return <StructuredArray value={value} depth={depth} />
  }
  if (typeof value === 'object') {
    return <StructuredObject value={value as Record<string, unknown>} depth={depth} />
  }
  return <span className="datastore-explorer-value">{truncate(String(value), MAX_TEXT)}</span>
}

function StructuredArray({ value, depth }: { value: unknown[]; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1)
  const visible = value.slice(0, MAX_ITEMS)
  return (
    <details className="datastore-explorer-nested-value" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>{value.length} item{value.length === 1 ? '' : 's'}</summary>
      <ol>
        {visible.map((item, index) => (
          <li key={index}>
            <span>{index + 1}</span>
            <DatastoreExplorerStructuredValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
      {value.length > visible.length ? <small>Showing the first {visible.length} items.</small> : null}
    </details>
  )
}

function StructuredObject({
  value,
  depth,
}: {
  value: Record<string, unknown>
  depth: number
}) {
  const entries = Object.entries(value)
    .filter(([key]) => !isSensitiveMetadataKey(key))
    .slice(0, MAX_ITEMS)
  return (
    <dl className="datastore-explorer-value-fields">
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt>{humanize(key)}</dt>
          <dd>
            <DatastoreExplorerStructuredValue value={item} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

