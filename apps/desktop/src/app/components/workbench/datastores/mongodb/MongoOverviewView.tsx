import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import {
  mongoScopedQueryMenuLabel,
  type MongoObjectViewDescriptor,
} from './MongoObjectViewDescriptors'
import { DownloadIcon, DatabaseIcon, ObjectCollectionIcon, PlayIcon, PlusIcon } from '../../icons'
import { mongoPipelineStageRows } from './MongoPipelineView.helpers'
import {
  arrayOfRecords,
  asRecord,
  documentFieldSummary,
  formatBytes,
  indexKeyPatternText,
  indexOptionsSummary,
  metadataSummary,
  normalizeIndexList,
  numericValue,
  pipelineSummary,
  stringValue,
} from './MongoOverviewView.helpers'
import { KeyValueGrid, ObjectViewTable, PurposeEmptyState, SectionHeading } from '../../ObjectViewPrimitives'

type JsonRecord = Record<string, unknown>

type MongoOperationPlanner = (request: {
  objectName?: string
  operationId: string
  parameters?: Record<string, unknown>
  title: string
}) => void

export function MongoOverviewView({
  kind,
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
  onPlanOperation,
}: {
  kind: string
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: MongoOperationPlanner
}) {
  const facts = [
    ['Database', stringValue(payload.database)],
    ['Collection', stringValue(payload.collection)],
    ['View', stringValue(payload.view)],
    ['Object', stringValue(payload.object)],
  ].filter(([, value]) => value)

  return (
    <div className="object-view-section">
      <SectionHeading
        Icon={kind === 'database' ? DatabaseIcon : ObjectCollectionIcon}
        title={descriptor.title}
        unit="MongoDB"
      />
      {kind === 'database' ? <MongoDatabaseOverview payload={payload} /> : null}
      {kind === 'collection' ? <MongoCollectionOverview payload={payload} onPlanOperation={onPlanOperation} /> : null}
      {kind === 'view' ? <MongoViewOverview payload={payload} /> : null}
      <KeyValueGrid rows={facts} emptyText="No object metadata has been loaded yet." />
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel ?? mongoScopedQueryMenuLabel(kind)}
        </button>
      ) : null}
    </div>
  )
}

function MongoDatabaseOverview({ payload }: { payload: JsonRecord }) {
  const collections = arrayOfRecords(payload.collections)
  const views = arrayOfRecords(payload.views)
  const timeSeriesCollections = arrayOfRecords(payload.timeSeriesCollections)
  const cappedCollections = arrayOfRecords(payload.cappedCollections)
  const gridfsBuckets = arrayOfRecords(payload.gridfsBuckets)
  const users = arrayOfRecords(payload.users)
  const roles = arrayOfRecords(payload.roles)
  const stats = asRecord(payload.statistics ?? payload.stats)

  return (
    <>
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>Collections</span>
          <strong>{collections.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Views</span>
          <strong>{views.length}</strong>
        </div>
        <div className="object-view-card">
          <span>GridFS buckets</span>
          <strong>{gridfsBuckets.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Users / roles</span>
          <strong>{users.length}/{roles.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Objects</span>
          <strong>{stringValue(stats.objects ?? stats.collections ?? '') || 'unknown'}</strong>
        </div>
      </div>
      <ObjectViewTable
        columns={['Collection', 'Type', 'Details']}
        rows={[
          ...collections.map((collection) => [
            stringValue(collection.name ?? collection.collection),
            'Collection',
            metadataSummary(collection, ['name', 'collection', 'type']),
          ]),
          ...timeSeriesCollections.map((collection) => [
            stringValue(collection.name ?? collection.collection),
            'Time series',
            metadataSummary(collection, ['name', 'collection', 'type']),
          ]),
          ...cappedCollections.map((collection) => [
            stringValue(collection.name ?? collection.collection),
            'Capped',
            metadataSummary(collection, ['name', 'collection', 'type']),
          ]),
        ]}
        emptyText="No collection metadata was returned for this database."
      />
      <ObjectViewTable
        columns={['View', 'Stages', 'First stage']}
        rows={views.map((view) => [
          stringValue(view.name ?? view.view),
          String(Array.isArray(view.pipeline) ? view.pipeline.length : 0),
          pipelineSummary(view.pipeline),
        ])}
        emptyText="No MongoDB views were returned for this database."
      />
    </>
  )
}

function MongoCollectionOverview({
  payload,
  onPlanOperation,
}: {
  payload: JsonRecord
  onPlanOperation?: MongoOperationPlanner
}) {
  const database = stringValue(payload.database)
  const collection = stringValue(payload.collection)
  const indexes = normalizeIndexList(payload.indexes)
  const sampleDocuments = arrayOfRecords(payload.sampleDocuments)
  const validator = payload.validator ?? asRecord(payload.options)?.validator
  const statistics = asRecord(payload.statistics ?? payload.stats)
  const planExport = () => {
    onPlanOperation?.({
      title: `Export ${collection}`,
      operationId: 'mongodb.collection.export',
      objectName: collection,
      parameters: {
        database,
        collection,
        format: 'extended-json',
        filter: {},
        projection: {},
        sort: {},
        batchSize: 1000,
      },
    })
  }
  const planImport = () => {
    onPlanOperation?.({
      title: `Import into ${collection}`,
      operationId: 'mongodb.collection.import',
      objectName: collection,
      parameters: {
        database,
        collection,
        format: 'json',
        mode: 'insertMany',
        validation: 'validate-before-write',
        mapping: {},
      },
    })
  }

  return (
    <>
      <div className="object-view-button-row object-view-button-row--compact" aria-label="Collection data actions">
        <button
          type="button"
          className="drawer-button"
          disabled={!onPlanOperation || !collection}
          title="Review export settings before writing files."
          onClick={planExport}
        >
          <DownloadIcon className="panel-inline-icon" />
          Export
        </button>
        <button
          type="button"
          className="drawer-button"
          disabled={!onPlanOperation || !collection}
          title="Review import settings before changing data."
          onClick={planImport}
        >
          <PlusIcon className="panel-inline-icon" />
          Import
        </button>
      </div>
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>Sample size</span>
          <strong>{sampleDocuments.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Indexes</span>
          <strong>{indexes.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Validator</span>
          <strong>{validator && Object.keys(asRecord(validator)).length ? 'configured' : 'none'}</strong>
        </div>
        <div className="object-view-card">
          <span>Documents</span>
          <strong>{stringValue(statistics.count ?? statistics.objects ?? '') || 'unknown'}</strong>
        </div>
        <div className="object-view-card">
          <span>Storage</span>
          <strong>{formatBytes(numericValue(statistics.storageSize ?? statistics.size))}</strong>
        </div>
      </div>
      <ObjectViewTable
        columns={['Index', 'Key pattern', 'Options']}
        rows={indexes.map((index) => [
          stringValue(index.name),
          indexKeyPatternText(index.key),
          indexOptionsSummary(index, ['name', 'key']),
        ])}
        emptyText="No index metadata was returned for this collection."
      />
      <ObjectViewTable
        columns={['Document', 'Fields', 'Top fields']}
        rows={sampleDocuments.map((document, index) => [
          stringValue(document._id ?? `Document ${index + 1}`),
          String(Object.keys(document).length),
          documentFieldSummary(document),
        ])}
        emptyText="No document sample metadata was returned for this collection."
      />
    </>
  )
}

function MongoViewOverview({ payload }: { payload: JsonRecord }) {
  const pipeline = Array.isArray(payload.pipeline) ? payload.pipeline : []

  return (
    pipeline.length ? (
      <div className="mongo-pipeline-stage-list" role="group" aria-label="MongoDB object pipeline stages">
        {mongoPipelineStageRows(pipeline).map((stage, index) => (
          <article className="mongo-pipeline-stage" key={`${stage.operator}:${index}`}>
            <div className="mongo-pipeline-stage-order">{index + 1}</div>
            <div className="mongo-pipeline-stage-body">
              <div className="mongo-pipeline-stage-title">
                <strong>{stage.operator}</strong>
                <span>{stage.summary}</span>
              </div>
              {stage.details.length ? (
                <div className="mongo-pipeline-stage-tags">
                  {stage.details.map((detail) => <span key={detail}>{detail}</span>)}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    ) : (
      <PurposeEmptyState descriptor={{
        emptyTitle: 'No view pipeline metadata',
        emptyDescription: 'Refresh this view or check that the selected MongoDB view still exists.',
      }} />
    )
  )
}
