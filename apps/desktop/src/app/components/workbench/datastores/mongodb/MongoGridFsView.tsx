import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'
import { DownloadIcon, PlayIcon, PlusIcon, WarningIcon } from '../../icons'
import { ObjectViewTable, PurposeEmptyState } from '../../ObjectViewPrimitives'
import {
  formatMongoBytes,
  mongoNumber,
  mongoRecordArray,
  mongoString,
  type JsonRecord,
} from './MongoOperationalView.helpers'
import { MongoContextStrip, MongoResourceSection } from './MongoOperationalViewPrimitives'

type MongoOperationPlanner = (request: {
  objectName?: string
  operationId: string
  parameters?: Record<string, unknown>
  title: string
}) => void

export function MongoGridFsView({
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
  onPlanOperation,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: MongoOperationPlanner
}) {
  const database = mongoString(payload.database)
  const bucket = mongoString(payload.bucket) || 'fs'
  const filesCollection = mongoString(payload.filesCollection) || `${bucket}.files`
  const chunksCollection = mongoString(payload.chunksCollection) || `${bucket}.chunks`
  const buckets = mongoRecordArray(payload.buckets)
  const files = mongoRecordArray(payload.files)
  const chunks = mongoRecordArray(payload.chunks)
  const totalBytes = files.reduce((sum, file) => sum + mongoNumber(file.length ?? file.size), 0)
  const missingChunkValue = payload.missingChunks ?? payload.missingChunkCount
  const missingChunks = missingChunkValue === undefined || missingChunkValue === null
    ? 'Not checked'
    : mongoNumber(missingChunkValue)
  const warning = mongoString(payload.warning)
  const sampleFile = files[0]
  const sampleFilename = mongoString(sampleFile?.filename ?? sampleFile?.name ?? sampleFile?._id) || '*'
  const canPlan = Boolean(onPlanOperation && database)

  const planExport = () => onPlanOperation?.({
    title: `Export GridFS ${bucket}`,
    operationId: 'mongodb.gridfs.export',
    objectName: filesCollection,
    parameters: {
      database,
      bucket,
      filename: sampleFilename,
      filesCollection,
      chunksCollection,
      format: 'binary',
    },
  })
  const planUpload = () => onPlanOperation?.({
    title: `Upload to GridFS ${bucket}`,
    operationId: 'mongodb.gridfs.upload',
    objectName: filesCollection,
    parameters: {
      database,
      bucket,
      filename: '<filename>',
      source: '<selected-file>',
      filesCollection,
      chunksCollection,
      metadata: {},
      validation: 'validate-before-write',
    },
  })
  const planValidate = () => onPlanOperation?.({
    title: `Validate GridFS ${bucket}`,
    operationId: 'mongodb.gridfs.validate',
    objectName: filesCollection,
    parameters: { database, bucket, filesCollection, chunksCollection },
  })

  return (
    <div className="object-view-section">
      <MongoContextStrip
        eyebrow="GridFS"
        title={database ? `${database} / ${bucket}` : bucket}
        detail="Metadata is bounded; binary chunk bodies are never loaded into this view."
        metrics={[
          { label: 'Buckets', value: buckets.length || (bucket ? 1 : 0) },
          { label: 'Files', value: files.length },
          { label: 'Chunks sampled', value: chunks.length },
          { label: 'Stored bytes sampled', value: formatMongoBytes(totalBytes) },
          { label: 'Missing chunks', value: missingChunks },
        ]}
      />
      {warning ? <p className="mongo-inline-warning">{warning}</p> : null}

      <MongoResourceSection
        eyebrow="Storage layout"
        title="Buckets"
        description="GridFS bucket prefixes detected from matching files and chunks collections."
      >
        {buckets.length ? (
          <ObjectViewTable
            columns={['Bucket', 'Files collection', 'Chunks collection']}
            rows={buckets.map((item) => [
              mongoString(item.bucket ?? item.name),
              mongoString(item.filesCollection ?? item.files),
              mongoString(item.chunksCollection ?? item.chunks),
            ])}
            emptyText="No GridFS buckets were returned."
          />
        ) : <PurposeEmptyState descriptor={descriptor} />}
      </MongoResourceSection>

      <MongoResourceSection
        eyebrow="File inventory"
        title="Files"
        description={files.length
          ? `${files.length} bounded file record${files.length === 1 ? '' : 's'} returned`
          : 'No file metadata was returned for this bucket.'}
        actions={(
          <>
            {queryTarget ? (
              <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
                <PlayIcon className="panel-inline-icon" />
                Query files
              </button>
            ) : null}
            <button
              type="button"
              className="drawer-button"
              disabled={!canPlan}
              title="Planning only: live file transfer is not enabled."
              onClick={planExport}
            >
              <DownloadIcon className="panel-inline-icon" />
              Review export plan
            </button>
            <button
              type="button"
              className="drawer-button"
              disabled={!canPlan}
              title="Planning only: live file transfer is not enabled."
              onClick={planUpload}
            >
              <PlusIcon className="panel-inline-icon" />
              Review upload plan
            </button>
          </>
        )}
      >
        <p className="mongo-capability-note">
          Export and upload are planning-only. DataPad++ does not transfer GridFS file content from this screen.
        </p>
        <ObjectViewTable
          columns={['File', 'Length', 'Upload date', 'Metadata']}
          rows={files.map((file) => [
            mongoString(file.filename ?? file.name ?? file._id),
            formatMongoBytes(mongoNumber(file.length ?? file.size)),
            mongoString(file.uploadDate ?? file.uploadedAt),
            compactJson(file.metadata ?? {}),
          ])}
          emptyText="No GridFS file metadata was returned."
        />
      </MongoResourceSection>

      <MongoResourceSection
        eyebrow="Consistency"
        title="Chunk health"
        description="A bounded metadata sample for chunk order and recorded size."
        actions={(
          <button
            type="button"
            className="drawer-button"
            disabled={!canPlan}
            title="Review a chunk-consistency validation plan."
            onClick={planValidate}
          >
            <WarningIcon className="panel-inline-icon" />
            Review validation
          </button>
        )}
      >
        <ObjectViewTable
          columns={['File id', 'Chunk', 'Size']}
          rows={chunks.map((chunk) => [
            mongoString(chunk.files_id ?? chunk.fileId),
            mongoString(chunk.n ?? chunk.chunk),
            formatMongoBytes(mongoNumber(chunk.size ?? chunk.length)),
          ])}
          emptyText="No GridFS chunk metadata was returned."
        />
      </MongoResourceSection>
    </div>
  )
}

function compactJson(value: unknown) {
  return JSON.stringify(value)
}
