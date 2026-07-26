import type { ExplorerNode } from '@datapadplusplus/shared-types'
import {
  ChevronRightIcon,
  ObjectCollectionIcon,
  RefreshIcon,
  WarningIcon,
} from '../../icons'
import { ExplorerNodeIcon } from '../../SideBar.node-icons'
import {
  asMongoRecord,
  formatMongoBytes,
  humanizeMongoMetric,
  mongoNumber,
  mongoRecordArray,
  mongoString,
} from './MongoOperationalView.helpers'
import type { MongoExplorerDetailProps } from './MongoExplorerDetail.types'

const BYTE_METRICS = new Set([
  'avgObjSize',
  'dataSize',
  'fileSize',
  'freeStorageSize',
  'indexFreeStorageSize',
  'indexSize',
  'size',
  'storageSize',
  'totalIndexSize',
  'totalSize',
])

const RESERVED_METADATA_KEYS = new Set([
  'database',
  'collection',
  'view',
  'nodeId',
  'object',
  'objectView',
  'warning',
  'warnings',
  'result',
  'statistics',
  'collections',
  'views',
  'timeSeriesCollections',
  'cappedCollections',
  'gridfsBuckets',
  'indexes',
  'validator',
  'sampleDocuments',
  'fields',
  'pipeline',
  'scripts',
  'users',
  'roles',
  'buckets',
  'files',
  'chunks',
])

export function MongoScopeDetail(props: MongoExplorerDetailProps) {
  const { node, scopeResponse, scopeLoading, scopeError, onLoadScope, onSelectNode } = props
  const nodes = scopeResponse?.nodes ?? []
  const pageInfo = scopeResponse?.pageInfo

  if (scopeError) {
    return (
      <MongoDetailState
        tone="error"
        title={`${node.label} could not be loaded`}
        detail={scopeError}
        action={
          node.scope ? (
            <button type="button" className="drawer-button" onClick={() => onLoadScope(node.scope)}>
              <RefreshIcon /> Retry
            </button>
          ) : undefined
        }
      />
    )
  }

  if (scopeLoading && !scopeResponse) {
    return <MongoDetailState title={`Loading ${node.label.toLowerCase()}…`} detail={node.detail} />
  }

  return (
    <div className="mongo-explorer-detail-content">
      <MongoDetailMetrics
        metrics={[
          {
            label: 'Loaded',
            value: nodes.length,
          },
          ...(pageInfo?.knownTotal !== undefined
            ? [{ label: 'Available', value: pageInfo.knownTotal }]
            : []),
          {
            label: 'Status',
            value: pageInfo?.hasMore ? 'Partial' : 'Current',
          },
        ]}
      />
      <MongoDetailSection
        title={scopeSectionTitle(node)}
        description={node.detail}
        actions={
          node.scope ? (
            <button type="button" className="drawer-button" onClick={() => onLoadScope(node.scope)}>
              <RefreshIcon /> Refresh
            </button>
          ) : undefined
        }
      >
        {nodes.length ? (
          <div className="mongo-explorer-inventory" role="list">
            {nodes.map((child) => (
              <div key={child.id} role="listitem">
                <button
                  type="button"
                  className="mongo-explorer-inventory-row"
                  onClick={() => onSelectNode(child)}
                  title={child.detail}
                >
                  <ExplorerNodeIcon connection={props.connection} kind={child.kind} />
                  <span>
                    <strong>{child.label}</strong>
                    <small>{child.detail || humanizeMongoMetric(child.kind)}</small>
                  </span>
                  <span className="mongo-explorer-kind-label">
                    {humanizeMongoMetric(child.kind)}
                  </span>
                  <ChevronRightIcon />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <MongoEmptyDetail node={node} />
        )}
        {pageInfo?.hasMore && pageInfo.nextCursor ? (
          <button
            type="button"
            className="drawer-button mongo-explorer-detail-load-more"
            disabled={scopeLoading}
            onClick={() => onLoadScope(node.scope, pageInfo.nextCursor)}
          >
            {scopeLoading ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </MongoDetailSection>
    </div>
  )
}

export function MongoDatabaseDetail(props: MongoExplorerDetailProps) {
  const payload = selectedPayload(props)
  if (!payload) return <MongoInspectionState {...props} />

  const collections = mongoRecordArray(payload.collections)
  const views = mongoRecordArray(payload.views)
  const groups = [
    { label: 'Collections', records: collections },
    { label: 'Views', records: views },
    {
      label: 'Time series',
      records: mongoRecordArray(payload.timeSeriesCollections),
    },
    { label: 'Capped', records: mongoRecordArray(payload.cappedCollections) },
    { label: 'GridFS buckets', records: mongoRecordArray(payload.gridfsBuckets) },
  ]
  const statistics = asMongoRecord(payload.statistics)
  const inventoryCount = groups.reduce((count, group) => count + group.records.length, 0)

  return (
    <div className="mongo-explorer-detail-content">
      <MongoWarnings payload={payload} />
      <MongoDetailMetrics
        metrics={[
          { label: 'Collections', value: collections.length },
          { label: 'Views', value: views.length },
          { label: 'Objects', value: formatNumber(statistics.objects) },
          { label: 'Storage', value: formatMetricValue('storageSize', statistics.storageSize) },
        ]}
      />
      <MongoDetailSection
        title="Database objects"
        description={`${inventoryCount} discovered object${inventoryCount === 1 ? '' : 's'}, grouped by purpose.`}
      >
        <div className="mongo-explorer-grouped-inventory">
          {groups.map((group) => (
            <section key={group.label}>
              <header>
                <h3>{group.label}</h3>
                <span>{group.records.length}</span>
              </header>
              {group.records.length ? (
                <ul>
                  {group.records.slice(0, 12).map((record, index) => (
                    <li key={`${mongoString(record.name) || group.label}-${index}`}>
                      <ObjectCollectionIcon />
                      <span>{mongoString(record.name) || 'Unnamed object'}</span>
                      <small>{mongoString(record.type)}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>None returned.</p>
              )}
            </section>
          ))}
        </div>
      </MongoDetailSection>
      <MongoScalarDetails payload={statistics} title="Storage details" />
    </div>
  )
}

export function MongoCollectionDetail(props: MongoExplorerDetailProps) {
  const payload = selectedPayload(props)
  if (!payload) return <MongoInspectionState {...props} />

  const statistics = asMongoRecord(payload.statistics)
  const indexes = normalizeIndexes(payload.indexes)
  const samples = mongoRecordArray(payload.sampleDocuments)
  const inferredFields = inferSampleFields(samples)
  const validator = asMongoRecord(payload.validator)

  return (
    <div className="mongo-explorer-detail-content">
      <MongoWarnings payload={payload} />
      <MongoDetailMetrics
        metrics={[
          {
            label: 'Documents',
            value: formatNumber(statistics.count ?? statistics.objects),
          },
          { label: 'Indexes', value: indexes.length },
          {
            label: 'Storage',
            value: formatMetricValue('storageSize', statistics.storageSize),
          },
          {
            label: 'Validation',
            value: Object.keys(validator).length ? 'Configured' : 'Not configured',
          },
        ]}
      />
      <MongoDetailSection
        title="Sampled fields"
        description={`Top-level fields inferred from ${samples.length} bounded sample document${samples.length === 1 ? '' : 's'}.`}
      >
        {inferredFields.length ? (
          <MongoDataTable
            columns={['Field', 'Observed types', 'Present']}
            rows={inferredFields.map((field) => [
              field.name,
              field.types.join(', '),
              `${field.count} / ${samples.length}`,
            ])}
          />
        ) : (
          <p className="mongo-explorer-empty-copy">No sample fields were returned.</p>
        )}
      </MongoDetailSection>
      <MongoIndexInventory indexes={indexes} />
      <MongoValidationSummary validator={validator} />
      <MongoDocumentSamples samples={samples} />
      <MongoScalarDetails payload={statistics} title="Collection details" />
    </div>
  )
}

export function MongoViewDetail(props: MongoExplorerDetailProps) {
  const payload = selectedPayload(props)
  if (!payload) return <MongoInspectionState {...props} />

  const stages = Array.isArray(payload.pipeline) ? payload.pipeline : []
  const backingCollection = mongoString(payload.backingCollection)

  return (
    <div className="mongo-explorer-detail-content">
      <MongoWarnings payload={payload} />
      <MongoDetailMetrics
        metrics={[
          { label: 'Access', value: 'Read only' },
          { label: 'Pipeline stages', value: stages.length },
          { label: 'Backing collection', value: backingCollection || 'Not reported' },
        ]}
      />
      <MongoDetailSection
        title="Pipeline"
        description="Stages execute in this order when MongoDB resolves the view."
      >
        {stages.length ? (
          <ol className="mongo-explorer-pipeline">
            {stages.map((stage, index) => {
              const record = asMongoRecord(stage)
              const [operator, value] = Object.entries(record)[0] ?? ['Stage', stage]
              return (
                <li key={`${operator}-${index}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{operator}</strong>
                    <MongoValue value={value} depth={0} />
                  </div>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="mongo-explorer-empty-copy">No pipeline stages were returned.</p>
        )}
      </MongoDetailSection>
    </div>
  )
}

export function MongoSchemaDetail(props: MongoExplorerDetailProps) {
  const payload = selectedPayload(props)
  if (!payload) return <MongoInspectionState {...props} />

  const fields = mongoRecordArray(payload.fields)
  const sampleSize = mongoNumber(payload.sampleSize)

  return (
    <div className="mongo-explorer-detail-content">
      <MongoWarnings payload={payload} />
      <MongoDetailMetrics
        metrics={[
          { label: 'Sample size', value: sampleSize },
          { label: 'Fields', value: fields.length },
          {
            label: 'Mixed types',
            value: fields.filter((field) => Object.keys(asMongoRecord(field.typeDistribution)).length > 1).length,
          },
        ]}
      />
      <MongoDetailSection
        title="Inferred fields"
        description="Field paths and BSON types observed in the bounded schema sample."
      >
        {fields.length ? (
          <MongoDataTable
            columns={['Field', 'Primary type', 'Coverage', 'Observed types']}
            rows={fields.map((field) => {
              const count = mongoNumber(field.count)
              const distribution = asMongoRecord(field.typeDistribution)
              return [
                mongoString(field.path ?? field.name),
                mongoString(field.type) || 'Mixed',
                sampleSize ? `${Math.round((count / sampleSize) * 100)}%` : '—',
                Object.keys(distribution).join(', ') || mongoString(field.type),
              ]
            })}
          />
        ) : (
          <p className="mongo-explorer-empty-copy">No fields were inferred.</p>
        )}
      </MongoDetailSection>
      <MongoValidationSummary validator={asMongoRecord(payload.validator)} />
    </div>
  )
}

export function MongoIndexDetail(props: MongoExplorerDetailProps) {
  const payload = selectedPayload(props)
  if (!payload) return <MongoInspectionState {...props} />

  const indexes = normalizeIndexes(payload.indexes)
  const selected = indexes.find((index) => mongoString(index.name) === props.node.label)
    ?? indexes[0]

  return (
    <div className="mongo-explorer-detail-content">
      <MongoWarnings payload={payload} />
      {selected ? (
        <>
          <MongoDetailMetrics
            metrics={[
              { label: 'Name', value: mongoString(selected.name) || props.node.label },
              { label: 'Unique', value: selected.unique ? 'Yes' : 'No' },
              { label: 'Sparse', value: selected.sparse ? 'Yes' : 'No' },
              { label: 'Protected', value: mongoString(selected.name) === '_id_' ? 'Yes' : 'No' },
            ]}
          />
          <MongoDetailSection title="Key definition" description="Fields are applied in key order.">
            <MongoKeyPattern value={selected.key} />
          </MongoDetailSection>
          <MongoScalarDetails payload={selected} title="Index options" excluded={new Set(['name', 'key'])} />
        </>
      ) : (
        <MongoDetailState title="Index metadata is unavailable" detail={props.node.detail} />
      )}
    </div>
  )
}

export function MongoValidationDetail(props: MongoExplorerDetailProps) {
  const payload = selectedPayload(props)
  if (!payload) return <MongoInspectionState {...props} />

  return (
    <div className="mongo-explorer-detail-content">
      <MongoWarnings payload={payload} />
      <MongoValidationSummary validator={asMongoRecord(payload.validator)} />
    </div>
  )
}

export function MongoStatisticsDetail(props: MongoExplorerDetailProps) {
  const payload = selectedPayload(props)
  if (!payload) return <MongoInspectionState {...props} />
  const statistics = Object.keys(asMongoRecord(payload.result)).length
    ? asMongoRecord(payload.result)
    : Object.keys(asMongoRecord(payload.statistics)).length
      ? asMongoRecord(payload.statistics)
      : payload
  const curatedKeys = [
    'collections',
    'objects',
    'count',
    'dataSize',
    'storageSize',
    'indexes',
    'totalIndexSize',
  ]

  return (
    <div className="mongo-explorer-detail-content">
      <MongoWarnings payload={payload} />
      <MongoDetailMetrics
        metrics={curatedKeys
          .filter((key) => statistics[key] !== undefined)
          .slice(0, 6)
          .map((key) => ({
            label: humanizeMongoMetric(key),
            value: formatMetricValue(key, statistics[key]),
          }))}
      />
      <MongoScalarDetails payload={statistics} title="Metrics" />
    </div>
  )
}

export function MongoPermissionsDetail(props: MongoExplorerDetailProps) {
  const payload = selectedPayload(props)
  if (!payload) return <MongoInspectionState {...props} />
  const result = asMongoRecord(payload.result)
  const users = mongoRecordArray(payload.users ?? result.users)
  const roles = mongoRecordArray(payload.roles ?? result.roles)

  return (
    <div className="mongo-explorer-detail-content">
      <MongoWarnings payload={payload} />
      <MongoDetailMetrics
        metrics={[
          { label: 'Users', value: users.length },
          { label: 'Roles', value: roles.length },
          { label: 'Mode', value: 'Read only' },
        ]}
      />
      <MongoPrincipalInventory title="Users" records={users} identityKey="user" />
      <MongoPrincipalInventory title="Roles" records={roles} identityKey="role" />
      {!users.length && !roles.length && !warningText(payload) ? (
        <MongoDetailState
          title="No permission metadata was returned"
          detail="The connected principal may not have permission to inspect users or roles."
        />
      ) : null}
    </div>
  )
}

export function MongoScriptsDetail(props: MongoExplorerDetailProps) {
  const payload = selectedPayload(props)
  if (!payload) return <MongoInspectionState {...props} />
  const scripts = Array.isArray(payload.scripts)
    ? payload.scripts.filter((script): script is string => typeof script === 'string')
    : []

  return (
    <div className="mongo-explorer-detail-content">
      <MongoWarnings payload={payload} />
      <MongoDetailSection
        title="Templates"
        description="Collection-scoped starting points for the MongoDB query editor."
      >
        {scripts.length ? (
          <ol className="mongo-explorer-script-list">
            {scripts.map((script, index) => (
              <li key={`${script}-${index}`}>
                <span>{index + 1}</span>
                <code>{script}</code>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mongo-explorer-empty-copy">No script templates were returned.</p>
        )}
      </MongoDetailSection>
    </div>
  )
}

export function MongoGridFsDetail(props: MongoExplorerDetailProps) {
  const payload = selectedPayload(props)
  if (!payload) return <MongoInspectionState {...props} />
  const buckets = mongoRecordArray(payload.buckets)
  const files = mongoRecordArray(payload.files)
  const chunks = mongoRecordArray(payload.chunks)

  return (
    <div className="mongo-explorer-detail-content">
      <MongoWarnings payload={payload} />
      <MongoDetailMetrics
        metrics={[
          { label: 'Buckets', value: buckets.length },
          { label: 'Sampled files', value: files.length },
          { label: 'Sampled chunks', value: chunks.length },
          { label: 'Sample limit', value: mongoNumber(payload.sampleLimit) || 25 },
        ]}
      />
      <MongoDetailSection title="Buckets" description="Detected GridFS bucket collection pairs.">
        {buckets.length ? (
          <MongoDataTable
            columns={['Bucket', 'Files collection', 'Chunks collection']}
            rows={buckets.map((bucket) => [
              mongoString(bucket.name),
              mongoString(bucket.filesCollection),
              mongoString(bucket.chunksCollection),
            ])}
          />
        ) : (
          <p className="mongo-explorer-empty-copy">No GridFS buckets were detected.</p>
        )}
      </MongoDetailSection>
      <MongoDetailSection title="Files" description="Bounded file metadata; file bodies are never loaded.">
        {files.length ? (
          <MongoDataTable
            columns={['Filename', 'Length', 'Uploaded', 'Identifier']}
            rows={files.map((file) => [
              mongoString(file.filename) || 'Unnamed file',
              formatMongoBytes(mongoNumber(file.length)),
              mongoScalarText(file.uploadDate),
              mongoScalarText(file._id),
            ])}
          />
        ) : (
          <p className="mongo-explorer-empty-copy">No file metadata was returned.</p>
        )}
      </MongoDetailSection>
      <MongoDetailSection title="Chunk health" description="Bounded chunk metadata without binary content.">
        {chunks.length ? (
          <MongoDataTable
            columns={['File identifier', 'Sequence', 'Size']}
            rows={chunks.map((chunk) => [
              mongoScalarText(chunk.files_id),
              mongoScalarText(chunk.n),
              formatMongoBytes(mongoNumber(chunk.size)),
            ])}
          />
        ) : (
          <p className="mongo-explorer-empty-copy">No chunk metadata was returned.</p>
        )}
      </MongoDetailSection>
    </div>
  )
}

export function MongoLaunchDetail(props: MongoExplorerDetailProps) {
  const primaryAction = props.actions.find((action) => action.primary) ?? props.actions[0]
  return (
    <MongoDetailState
      title={launchTitle(props.node)}
      detail={props.node.detail}
      action={
        primaryAction ? (
          <button
            type="button"
            className="drawer-button primary"
            onClick={() => props.onRunAction(primaryAction.id, props.node)}
          >
            {primaryAction.label}
          </button>
        ) : undefined
      }
    />
  )
}

export function MongoStateDetail(props: MongoExplorerDetailProps) {
  const isWarning = props.node.kind === 'permission' || props.node.kind === 'unavailable'
  return (
    <MongoDetailState
      tone={isWarning ? 'warning' : undefined}
      title={props.node.label}
      detail={props.node.detail}
    />
  )
}

export function MongoUnknownDetail(props: MongoExplorerDetailProps) {
  return (
    <MongoDetailState
      title="This metadata type is not available in Explorer"
      detail={`${props.node.label} can still be opened through its existing query or operational workflow when available.`}
    />
  )
}

export function MongoDetailActions({
  actions,
  node,
  onRunAction,
}: Pick<MongoExplorerDetailProps, 'actions' | 'node' | 'onRunAction'>) {
  if (!actions.length || ['documents', 'aggregations', 'sample-results', 'view-results'].includes(node.kind)) {
    return null
  }

  return (
    <div className="mongo-explorer-detail-actions" aria-label={`${node.label} actions`}>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={`drawer-button${action.primary ? ' primary' : ''}`}
          onClick={() => onRunAction(action.id, node)}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

function MongoInspectionState(props: MongoExplorerDetailProps) {
  if (props.scopeError) {
    return (
      <MongoDetailState
        tone="error"
        title="Metadata could not be loaded"
        detail={props.scopeError}
      />
    )
  }
  return (
    <MongoDetailState
      title={props.scopeLoading ? 'Loading metadata…' : 'Metadata is not loaded'}
      detail={
        props.scopeLoading
          ? `MongoDB is inspecting ${props.node.label}.`
          : 'Select the object again or refresh the database metadata.'
      }
    />
  )
}

function MongoDetailState({
  title,
  detail,
  tone,
  action,
}: {
  title: string
  detail?: string
  tone?: 'warning' | 'error'
  action?: React.ReactNode
}) {
  return (
    <div className={`mongo-explorer-purpose-state${tone ? ` is-${tone}` : ''}`}>
      {tone ? <WarningIcon /> : <ObjectCollectionIcon />}
      <div>
        <h3>{title}</h3>
        {detail ? <p>{detail}</p> : null}
        {action ? <div>{action}</div> : null}
      </div>
    </div>
  )
}

function MongoDetailMetrics({
  metrics,
}: {
  metrics: Array<{ label: string; value: React.ReactNode }>
}) {
  const visibleMetrics = metrics.filter(
    (metric) => metric.value !== undefined && metric.value !== '',
  )
  if (!visibleMetrics.length) return null

  return (
    <dl className="mongo-explorer-detail-metrics">
      {visibleMetrics.map((metric) => (
        <div key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function MongoDetailSection({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mongo-explorer-detail-section">
      <header>
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {actions}
      </header>
      <div className="mongo-explorer-detail-section-body">{children}</div>
    </section>
  )
}

function MongoDataTable({
  columns,
  rows,
}: {
  columns: string[]
  rows: Array<Array<React.ReactNode>>
}) {
  return (
    <div className="mongo-explorer-table-wrap">
      <table className="mongo-explorer-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, columnIndex) => <td key={columnIndex}>{value || '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MongoIndexInventory({ indexes }: { indexes: Array<Record<string, unknown>> }) {
  return (
    <MongoDetailSection title="Indexes" description="Current collection access paths.">
      {indexes.length ? (
        <div className="mongo-explorer-index-list">
          {indexes.map((index, indexNumber) => (
            <div key={`${mongoString(index.name)}-${indexNumber}`}>
              <div>
                <strong>{mongoString(index.name) || `Index ${indexNumber + 1}`}</strong>
                <span>{index.unique ? 'Unique' : 'Standard'}</span>
              </div>
              <MongoKeyPattern value={index.key} />
            </div>
          ))}
        </div>
      ) : (
        <p className="mongo-explorer-empty-copy">Index metadata was not returned.</p>
      )}
    </MongoDetailSection>
  )
}

function MongoKeyPattern({ value }: { value: unknown }) {
  const keys = Object.entries(asMongoRecord(value))
  return keys.length ? (
    <div className="mongo-explorer-key-pattern">
      {keys.map(([field, direction]) => (
        <span key={field}>
          <strong>{field}</strong>
          <small>{mongoScalarText(direction)}</small>
        </span>
      ))}
    </div>
  ) : (
    <span className="mongo-explorer-empty-copy">No key fields returned.</span>
  )
}

function MongoValidationSummary({ validator }: { validator: Record<string, unknown> }) {
  const schema = asMongoRecord(validator.$jsonSchema)
  const required = Array.isArray(schema.required)
    ? schema.required.filter((field): field is string => typeof field === 'string')
    : []
  const properties = Object.entries(asMongoRecord(schema.properties))

  return (
    <MongoDetailSection
      title="Validation"
      description="Readable constraints from the collection validator."
    >
      {!Object.keys(validator).length ? (
        <p className="mongo-explorer-empty-copy">No collection validator is configured.</p>
      ) : (
        <div className="mongo-explorer-validation-summary">
          <div>
            <span>Document type</span>
            <strong>{mongoString(schema.bsonType) || 'Not specified'}</strong>
          </div>
          <div>
            <span>Required fields</span>
            <strong>{required.length ? required.join(', ') : 'None specified'}</strong>
          </div>
          {properties.length ? (
            <MongoDataTable
              columns={['Field', 'BSON type', 'Description']}
              rows={properties.map(([field, value]) => {
                const definition = asMongoRecord(value)
                return [
                  field,
                  mongoScalarText(definition.bsonType),
                  mongoString(definition.description),
                ]
              })}
            />
          ) : null}
        </div>
      )}
    </MongoDetailSection>
  )
}

function MongoDocumentSamples({ samples }: { samples: Array<Record<string, unknown>> }) {
  if (!samples.length) return null
  return (
    <MongoDetailSection
      title="Sample documents"
      description="Bounded metadata sample with type-aware values."
    >
      <div className="mongo-explorer-document-list">
        {samples.map((sample, index) => (
          <details key={index} open={index === 0}>
            <summary>
              <span>Document {index + 1}</span>
              <small>{Object.keys(sample).length} fields</small>
            </summary>
            <MongoObjectFields value={sample} depth={0} />
          </details>
        ))}
      </div>
    </MongoDetailSection>
  )
}

function MongoObjectFields({ value, depth }: { value: Record<string, unknown>; depth: number }) {
  const entries = Object.entries(value).slice(0, 24)
  return (
    <dl className="mongo-explorer-value-fields">
      {entries.map(([key, fieldValue]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd><MongoValue value={fieldValue} depth={depth + 1} /></dd>
        </div>
      ))}
      {Object.keys(value).length > entries.length ? (
        <div>
          <dt>Additional fields</dt>
          <dd>{Object.keys(value).length - entries.length} not shown</dd>
        </div>
      ) : null}
    </dl>
  )
}

function MongoValue({ value, depth }: { value: unknown; depth: number }) {
  if (value === null) return <span className="mongo-value-type is-null">null</span>
  if (value === undefined) return <span className="mongo-value-type is-null">not set</span>
  if (typeof value === 'string') return <span title={value}>{truncate(value, 180)}</span>
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="mongo-value-type">{String(value)}</span>
  }

  const tagged = mongoTaggedValue(value)
  if (tagged) {
    return (
      <span className="mongo-value-tagged">
        <small>{tagged.type}</small>
        <span title={tagged.value}>{truncate(tagged.value, 180)}</span>
      </span>
    )
  }

  if (depth >= 4) {
    return <span className="mongo-value-type">{Array.isArray(value) ? 'Array' : 'Object'}</span>
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 12)
    return (
      <details className="mongo-explorer-nested-value">
        <summary>{value.length} item{value.length === 1 ? '' : 's'}</summary>
        <ol>
          {items.map((item, index) => (
            <li key={index}><MongoValue value={item} depth={depth + 1} /></li>
          ))}
        </ol>
        {value.length > items.length ? <small>{value.length - items.length} more</small> : null}
      </details>
    )
  }

  const record = asMongoRecord(value)
  return (
    <details className="mongo-explorer-nested-value">
      <summary>{Object.keys(record).length} field{Object.keys(record).length === 1 ? '' : 's'}</summary>
      <MongoObjectFields value={record} depth={depth + 1} />
    </details>
  )
}

function MongoPrincipalInventory({
  title,
  records,
  identityKey,
}: {
  title: string
  records: Array<Record<string, unknown>>
  identityKey: 'user' | 'role'
}) {
  if (!records.length) return null
  return (
    <MongoDetailSection title={title} description={`Read-only ${title.toLowerCase()} metadata.`}>
      <div className="mongo-explorer-principal-list">
        {records.map((record, index) => {
          const roles = Array.isArray(record.roles) ? record.roles : []
          const privileges = Array.isArray(record.privileges) ? record.privileges : []
          return (
            <article key={`${mongoString(record[identityKey])}-${index}`}>
              <header>
                <ExplorerNodeIcon kind={identityKey} />
                <strong>{mongoString(record[identityKey]) || `Unnamed ${identityKey}`}</strong>
              </header>
              <dl>
                <div>
                  <dt>Database</dt>
                  <dd>{mongoString(record.db) || 'Current database'}</dd>
                </div>
                <div>
                  <dt>Roles</dt>
                  <dd>{roles.length ? roles.map(mongoPrincipalLabel).join(', ') : 'None returned'}</dd>
                </div>
                <div>
                  <dt>Privileges</dt>
                  <dd>{privileges.length || 'None returned'}</dd>
                </div>
              </dl>
            </article>
          )
        })}
      </div>
    </MongoDetailSection>
  )
}

function MongoScalarDetails({
  payload,
  title,
  excluded = RESERVED_METADATA_KEYS,
}: {
  payload: Record<string, unknown>
  title: string
  excluded?: ReadonlySet<string>
}) {
  const rows = Object.entries(payload)
    .filter(([key, value]) => !excluded.has(key) && isScalarOrTagged(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [
      humanizeMongoMetric(key),
      formatMetricValue(key, value),
    ])
  if (!rows.length) return null

  return (
    <MongoDetailSection title={title}>
      <MongoDataTable columns={['Metric', 'Value']} rows={rows} />
    </MongoDetailSection>
  )
}

function MongoWarnings({ payload }: { payload: Record<string, unknown> }) {
  const warning = warningText(payload)
  return warning ? (
    <div className="mongo-explorer-inline-warning">
      <WarningIcon />
      <span>{warning}</span>
    </div>
  ) : null
}

function selectedPayload(props: MongoExplorerDetailProps) {
  return props.inspection?.nodeId === props.node.id
    ? asMongoRecord(props.inspection.payload)
    : undefined
}

function normalizeIndexes(value: unknown) {
  if (Array.isArray(value)) return mongoRecordArray(value)
  const record = asMongoRecord(value)
  const cursor = asMongoRecord(record.cursor)
  return mongoRecordArray(cursor.firstBatch)
}

function warningText(payload: Record<string, unknown>) {
  const warning = mongoString(payload.warning)
  if (warning) return warning
  return Array.isArray(payload.warnings)
    ? payload.warnings.filter((item): item is string => typeof item === 'string').join(' ')
    : ''
}

function inferSampleFields(samples: Array<Record<string, unknown>>) {
  const fields = new Map<string, { name: string; count: number; types: Set<string> }>()
  samples.forEach((sample) => {
    Object.entries(sample).forEach(([name, value]) => {
      const current = fields.get(name) ?? { name, count: 0, types: new Set<string>() }
      current.count += 1
      current.types.add(mongoValueType(value))
      fields.set(name, current)
    })
  })
  return [...fields.values()]
    .map((field) => ({ ...field, types: [...field.types].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function mongoValueType(value: unknown) {
  const tagged = mongoTaggedValue(value)
  if (tagged) return tagged.type
  if (value === null) return 'Null'
  if (Array.isArray(value)) return 'Array'
  if (typeof value === 'object') return 'Document'
  return humanizeMongoMetric(typeof value)
}

function mongoTaggedValue(value: unknown): { type: string; value: string } | undefined {
  const record = asMongoRecord(value)
  const entries = Object.entries(record)
  const entry = entries[0]
  if (entries.length !== 1 || !entry || !entry[0].startsWith('$')) return undefined
  const [tag, taggedValue] = entry
  const labels: Record<string, string> = {
    $oid: 'ObjectId',
    $date: 'Date',
    $numberDecimal: 'Decimal128',
    $numberDouble: 'Double',
    $numberInt: 'Int32',
    $numberLong: 'Int64',
    $binary: 'Binary',
    $timestamp: 'Timestamp',
  }
  const type = labels[tag] ?? humanizeMongoMetric(tag.slice(1))
  return { type, value: mongoScalarText(taggedValue) }
}

function mongoScalarText(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  const tagged = mongoTaggedValue(value)
  if (tagged) return tagged.value
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  return `${Object.keys(asMongoRecord(value)).length} field${Object.keys(asMongoRecord(value)).length === 1 ? '' : 's'}`
}

function formatNumber(value: unknown) {
  const number = mongoNumber(value)
  return number ? new Intl.NumberFormat().format(number) : '0'
}

function formatMetricValue(key: string, value: unknown) {
  if (BYTE_METRICS.has(key)) return formatMongoBytes(mongoNumber(value))
  if (typeof value === 'number') return new Intl.NumberFormat().format(value)
  return mongoScalarText(value)
}

function mongoPrincipalLabel(value: unknown) {
  if (typeof value === 'string') return value
  const record = asMongoRecord(value)
  const role = mongoString(record.role)
  const database = mongoString(record.db)
  return [role, database].filter(Boolean).join('@') || 'Unnamed role'
}

function isScalarOrTagged(value: unknown) {
  return (
    value === null
    || ['string', 'number', 'boolean'].includes(typeof value)
    || Boolean(mongoTaggedValue(value))
  )
}

function scopeSectionTitle(node: ExplorerNode) {
  if (node.kind === 'databases') return 'Authorized databases'
  if (node.kind === 'system-databases') return 'System databases'
  return node.label
}

function launchTitle(node: ExplorerNode) {
  if (node.kind === 'aggregations') return 'Build an aggregation'
  if (node.kind === 'documents') return 'Browse collection documents'
  return 'Open query results'
}

function MongoEmptyDetail({ node }: { node: ExplorerNode }) {
  const title = node.kind === 'databases'
    ? 'No authorized databases were returned'
    : node.kind === 'system-databases'
      ? 'No system databases were returned'
      : `No ${node.label.toLowerCase()} were returned`
  return <p className="mongo-explorer-empty-copy">{title}.</p>
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}
