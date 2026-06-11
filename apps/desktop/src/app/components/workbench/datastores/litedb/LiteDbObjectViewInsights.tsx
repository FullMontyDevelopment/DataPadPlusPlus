import {
  ObjectCollectionIcon,
  ObjectDocumentIcon,
  ObjectIndexIcon,
  ObjectStageIcon,
} from '../../icons'

type JsonRecord = Record<string, unknown>

interface LiteDbObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function LiteDbObjectViewInsights({
  kind,
  payload,
}: LiteDbObjectViewInsightsProps) {
  if (!isInsightKind(kind)) {
    return null
  }

  const collections = records(payload.collections)
  const fields = records(payload.fields)
  const indexes = records(payload.indexes)
  const storage = records(payload.storage)
  const files = records(payload.files)
  const chunks = records(payload.chunks)
  const diagnostics = records(payload.diagnostics)

  return (
    <>
      <LiteDbCollectionPosture collections={collections} fields={fields} indexes={indexes} payload={payload} />
      <LiteDbIndexPosture indexes={indexes} diagnostics={diagnostics} />
      <LiteDbStoragePosture storage={storage} diagnostics={diagnostics} payload={payload} />
      <LiteDbFileStoragePosture files={files} chunks={chunks} diagnostics={diagnostics} />
    </>
  )
}

function LiteDbCollectionPosture({
  collections,
  fields,
  indexes,
  payload,
}: {
  collections: JsonRecord[]
  fields: JsonRecord[]
  indexes: JsonRecord[]
  payload: JsonRecord
}) {
  if (!collections.length && !fields.length) {
    return null
  }

  const documentCount = numeric(payload.documentCount)
    || collections.reduce((sum, collection) => sum + numeric(collection.documentCount), 0)
  const indexedFields = new Set(indexes.map((index) => displayValue(index.expression)).filter((value) => value !== '-'))
  const warningFields = fields.filter((field) => displayValue(field.warning) !== '-')

  return (
    <section className="object-view-section" aria-label="LiteDB collection posture">
      <div className="object-view-section-heading">
        <ObjectCollectionIcon className="panel-inline-icon" />
        <strong>Collection Posture</strong>
        <span>{collections.length || 1} collection(s)</span>
      </div>
      <div className="object-view-card-grid">
        <InsightCard label="Documents" value={documentCount ? documentCount.toLocaleString() : '-'} />
        <InsightCard label="Fields" value={fields.length ? String(fields.length) : '-'} />
        <InsightCard label="Indexed" value={indexes.length ? String(indexedFields.size || indexes.length) : '-'} />
        <InsightCard label="Warnings" value={String(warningFields.length)} />
      </div>
      {fields.length ? (
        <div className="object-view-chip-row">
          {fields.slice(0, 10).map((field) => (
            <span key={displayValue(field.path)}>
              {displayValue(field.path)}
              {' '}
              <strong>{displayValue(field.types)}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function LiteDbIndexPosture({
  indexes,
  diagnostics,
}: {
  indexes: JsonRecord[]
  diagnostics: JsonRecord[]
}) {
  if (!indexes.length) {
    return null
  }

  const uniqueIndexes = indexes.filter((index) => truthy(index.unique)).length
  const watchSignals = diagnostics.filter((signal) => /index/i.test(displayValue(signal.signal)) && /watch|warn|stale/i.test(displayValue(signal.status))).length

  return (
    <section className="object-view-section" aria-label="LiteDB index posture">
      <div className="object-view-section-heading">
        <ObjectIndexIcon className="panel-inline-icon" />
        <strong>Index Posture</strong>
        <span>{indexes.length} index(es)</span>
      </div>
      <div className="object-view-card-grid">
        <InsightCard label="Unique" value={String(uniqueIndexes)} />
        <InsightCard label="Regular" value={String(Math.max(0, indexes.length - uniqueIndexes))} />
        <InsightCard label="Watch" value={String(watchSignals)} />
      </div>
      <div className="object-view-chip-row">
        {indexes.slice(0, 12).map((index) => (
          <span key={`${displayValue(index.collection)}-${displayValue(index.name)}`}>
            {displayValue(index.name)}
            {' '}
            <strong>{displayValue(index.expression)}</strong>
          </span>
        ))}
      </div>
    </section>
  )
}

function LiteDbStoragePosture({
  storage,
  diagnostics,
  payload,
}: {
  storage: JsonRecord[]
  diagnostics: JsonRecord[]
  payload: JsonRecord
}) {
  if (!storage.length && !diagnostics.length && !payload.fileSize) {
    return null
  }

  const freePages = storage.find((row) => /free pages/i.test(displayValue(row.name)))
  const journal = storage.find((row) => /journal/i.test(displayValue(row.name)))
  const watchSignals = [...storage, ...diagnostics].filter((row) => /watch|warn|critical/i.test(displayValue(row.status))).length

  return (
    <section className="object-view-section" aria-label="LiteDB storage posture">
      <div className="object-view-section-heading">
        <ObjectStageIcon className="panel-inline-icon" />
        <strong>Storage Posture</strong>
        <span>{storage.length + diagnostics.length} signal(s)</span>
      </div>
      <div className="object-view-card-grid">
        <InsightCard label="File" value={displayValue(payload.fileSize)} />
        <InsightCard label="Free Pages" value={displayValue(freePages?.value)} />
        <InsightCard label="Journal" value={displayValue(journal?.value)} />
        <InsightCard label="Watch" value={String(watchSignals)} />
      </div>
    </section>
  )
}

function LiteDbFileStoragePosture({
  files,
  chunks,
  diagnostics,
}: {
  files: JsonRecord[]
  chunks: JsonRecord[]
  diagnostics: JsonRecord[]
}) {
  if (!files.length && !chunks.length) {
    return null
  }

  const missingChunks = chunks.filter((chunk) => /missing|error|orphan/i.test(displayValue(chunk.status))).length
  const fileSignal = diagnostics.find((signal) => /file storage/i.test(displayValue(signal.signal)))

  return (
    <section className="object-view-section" aria-label="LiteDB file storage posture">
      <div className="object-view-section-heading">
        <ObjectDocumentIcon className="panel-inline-icon" />
        <strong>File Storage</strong>
        <span>{files.length} file(s)</span>
      </div>
      <div className="object-view-card-grid">
        <InsightCard label="Files" value={String(files.length)} />
        <InsightCard label="Chunks" value={String(chunks.length)} />
        <InsightCard label="Missing" value={String(missingChunks)} />
        <InsightCard label="Health" value={displayValue(fileSignal?.status)} />
      </div>
    </section>
  )
}

function InsightCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="object-view-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function isInsightKind(kind: string) {
  return [
    'database',
    'collections',
    'collection',
    'documents',
    'schema',
    'indexes',
    'index',
    'file-storage',
    'files',
    'chunks',
    'storage',
    'statistics',
    'pragmas',
    'maintenance',
    'settings',
    'diagnostics',
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

function truthy(value: unknown) {
  return value === true || /true|yes|unique/i.test(displayValue(value))
}
