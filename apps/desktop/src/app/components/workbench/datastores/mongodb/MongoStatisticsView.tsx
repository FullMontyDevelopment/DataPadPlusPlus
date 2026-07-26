import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'
import {
  asMongoRecord,
  formatMongoBytes,
  humanizeMongoMetric,
  mongoString,
  type JsonRecord,
} from './MongoOperationalView.helpers'
import { MongoContextStrip, MongoResourceSection } from './MongoOperationalViewPrimitives'
import { ObjectViewTable } from '../../ObjectViewPrimitives'

const byteMetrics = new Set([
  'avgObjSize',
  'dataSize',
  'freeStorageSize',
  'indexFreeStorageSize',
  'size',
  'storageSize',
  'totalIndexSize',
  'totalSize',
])

const preferredMetrics = [
  'collections',
  'views',
  'objects',
  'count',
  'avgObjSize',
  'dataSize',
  'size',
  'storageSize',
  'indexes',
  'nindexes',
  'indexSize',
  'totalIndexSize',
  'totalSize',
  'scaleFactor',
]

export function MongoStatisticsView({
  descriptor,
  payload,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
}) {
  const nestedResult = asMongoRecord(payload.result)
  const stats = Object.keys(nestedResult).length ? nestedResult : payload
  const metricRows: [string, string][] = Object.entries(stats)
    .filter(([key, value]) =>
      key !== 'database' &&
      key !== 'collection' &&
      key !== 'warning' &&
      (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'))
    .sort(([left], [right]) => metricOrder(left) - metricOrder(right) || left.localeCompare(right))
    .map(([key, value]): [string, string] => [humanizeMongoMetric(key), formatMetricValue(key, value)])
  const context = [mongoString(payload.database), mongoString(payload.collection)]
    .filter(Boolean)
    .join(' / ')
  const headlineMetrics = metricRows.slice(0, 5).map(([label, value]) => ({ label, value }))

  return (
    <div className="object-view-section">
      <MongoContextStrip
        eyebrow={descriptor.kind === 'database-statistics' ? 'Database statistics' : 'Collection statistics'}
        title={context || 'MongoDB'}
        detail={`${metricRows.length} metric${metricRows.length === 1 ? '' : 's'} returned`}
        metrics={headlineMetrics}
      />
      <MongoResourceSection
        eyebrow="Live metadata"
        title="Statistics"
        description="Scalar metrics returned by MongoDB for the selected object."
      >
        <ObjectViewTable
          columns={['Metric', 'Value']}
          rows={metricRows}
          emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
        />
      </MongoResourceSection>
    </div>
  )
}

function metricOrder(key: string) {
  const index = preferredMetrics.indexOf(key)
  return index === -1 ? preferredMetrics.length : index
}

function formatMetricValue(key: string, value: unknown) {
  if (byteMetrics.has(key) && typeof value === 'number') {
    return formatMongoBytes(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (typeof value === 'number') {
    return new Intl.NumberFormat('en-US').format(value)
  }
  return mongoString(value)
}
