import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'
import { DatabaseIcon } from '../../icons'
import { ObjectViewTable, SectionHeading } from '../../ObjectViewPrimitives'

type JsonRecord = Record<string, unknown>

export function MongoStatisticsView({
  descriptor,
  payload,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
}) {
  const stats = asRecord(payload.result) ?? payload
  const metricRows = Object.entries(stats)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')
    .map(([key, value]) => [humanizeMetric(key), String(value)])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={DatabaseIcon} title={descriptor.title} unit={`${metricRows.length} metric(s)`} />
      <div className="object-view-card-grid">
        {metricRows.slice(0, 8).map(([label, value]) => (
          <div key={label} className="object-view-card">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <ObjectViewTable
        columns={['Metric', 'Value']}
        rows={metricRows}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
    </div>
  )
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function humanizeMetric(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
