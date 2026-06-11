import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'
import { DownloadIcon, ObjectCollectionIcon, PlayIcon, PlusIcon, WarningIcon } from '../../icons'
import { KeyValueGrid, ObjectViewTable, SectionHeading } from '../../ObjectViewPrimitives'

type JsonRecord = Record<string, unknown>

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
  const database = stringValue(payload.database)
  const bucket = stringValue(payload.bucket) || 'fs'
  const filesCollection = stringValue(payload.filesCollection) || `${bucket}.files`
  const chunksCollection = stringValue(payload.chunksCollection) || `${bucket}.chunks`
  const facts = [
    ['Database', database],
    ['Bucket', bucket],
    ['Collection', stringValue(payload.collection)],
    ['Files collection', filesCollection],
    ['Chunks collection', chunksCollection],
  ].filter(([, value]) => value)
  const buckets = arrayOfRecords(payload.buckets)
  const files = arrayOfRecords(payload.files)
  const chunks = arrayOfRecords(payload.chunks)
  const totalBytes = files.reduce((sum, file) => sum + numericValue(file.length ?? file.size), 0)
  const missingChunks = numericValue(payload.missingChunks ?? payload.missingChunkCount)
  const sampleFile = files[0]
  const sampleFilename = stringValue(sampleFile?.filename ?? sampleFile?.name ?? sampleFile?._id) || '*'
  const canPlan = Boolean(onPlanOperation && database)

  const planExport = () => {
    onPlanOperation?.({
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
  }

  const planUpload = () => {
    onPlanOperation?.({
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
  }

  const planValidate = () => {
    onPlanOperation?.({
      title: `Validate GridFS ${bucket}`,
      operationId: 'mongodb.gridfs.validate',
      objectName: filesCollection,
      parameters: {
        database,
        bucket,
        filesCollection,
        chunksCollection,
      },
    })
  }

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectCollectionIcon} title={descriptor.title} unit="files and chunks" />
      <div className="object-view-button-row object-view-button-row--compact" aria-label="GridFS actions">
        <button
          type="button"
          className="drawer-button"
          disabled={!canPlan}
          title="Review an export plan before writing files."
          onClick={planExport}
        >
          <DownloadIcon className="panel-inline-icon" />
          Export Files
        </button>
        <button
          type="button"
          className="drawer-button"
          disabled={!canPlan}
          title="Review upload validation before writing to GridFS."
          onClick={planUpload}
        >
          <PlusIcon className="panel-inline-icon" />
          Upload File
        </button>
        <button
          type="button"
          className="drawer-button"
          disabled={!canPlan}
          title="Check GridFS chunk consistency."
          onClick={planValidate}
        >
          <WarningIcon className="panel-inline-icon" />
          Validate Chunks
        </button>
      </div>
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>Buckets</span>
          <strong>{buckets.length || (bucket ? 1 : 0)}</strong>
        </div>
        <div className="object-view-card">
          <span>Files</span>
          <strong>{files.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Chunks</span>
          <strong>{chunks.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Stored bytes</span>
          <strong>{totalBytes ? formatBytes(totalBytes) : '0 B'}</strong>
        </div>
        <div className="object-view-card">
          <span>Missing chunks</span>
          <strong>{missingChunks}</strong>
        </div>
      </div>
      <KeyValueGrid
        rows={facts}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      {buckets.length || files.length || chunks.length ? (
        <>
          <ObjectViewTable
            columns={['Bucket', 'Files collection', 'Chunks collection']}
            rows={buckets.map((bucket) => [
              stringValue(bucket.bucket ?? bucket.name),
              stringValue(bucket.filesCollection ?? bucket.files),
              stringValue(bucket.chunksCollection ?? bucket.chunks),
            ])}
            emptyText="No GridFS buckets were returned."
          />
          <ObjectViewTable
            columns={['File', 'Length', 'Upload date', 'Metadata']}
            rows={files.map((file) => [
              stringValue(file.filename ?? file.name ?? file._id),
              formatBytes(numericValue(file.length ?? file.size)),
              stringValue(file.uploadDate ?? file.uploadedAt),
              compactJson(file.metadata ?? {}),
            ])}
            emptyText="No GridFS files were returned."
          />
          <ObjectViewTable
            columns={['File id', 'Chunk', 'Size']}
            rows={chunks.map((chunk) => [
              stringValue(chunk.files_id ?? chunk.fileId),
              stringValue(chunk.n ?? chunk.chunk),
              formatBytes(numericValue(chunk.size ?? chunk.length)),
            ])}
            emptyText="No GridFS chunks were returned."
          />
        </>
      ) : null}
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          Query GridFS Collection
        </button>
      ) : null}
    </div>
  )
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
}

function numericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const record = asRecord(value)
  const extendedNumber = record.$numberLong ?? record.$numberInt ?? record.$numberDouble
  return typeof extendedNumber === 'string' ? numericValue(extendedNumber) : 0
}

function stringValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function compactJson(value: unknown) {
  return JSON.stringify(value)
}

function formatBytes(value: number) {
  if (!value) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }

  return `${amount.toFixed(amount >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}
