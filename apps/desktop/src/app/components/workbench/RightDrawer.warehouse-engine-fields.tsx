import type { ConnectionProfile, WarehouseConnectionOptions } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

export function RemoteWarehouseFields({
  connectionDraft,
  options,
  updateOptions,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  options: WarehouseConnectionOptions
  updateOptions(patch: Partial<WarehouseConnectionOptions>): void
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  return (
    <>
      <FormField label="Endpoint">
        <input
          aria-label="Warehouse endpoint URL"
          value={options.endpointUrl ?? connectionDraft.host ?? ''}
          placeholder={endpointPlaceholder(connectionDraft.engine)}
          onChange={(event) => {
            updateOptions({ endpointUrl: event.target.value || undefined })
            onUpdateConnectionDraft({ host: event.target.value || '' }, { preserveName: true })
          }}
        />
      </FormField>

      <div className="connection-advanced-grid">
        <FormField label={scopeLabel(connectionDraft.engine)}>
          <input
            aria-label="Warehouse database"
            value={options.databaseName ?? connectionDraft.database ?? ''}
            placeholder={scopePlaceholder(connectionDraft.engine)}
            onChange={(event) => {
              updateOptions({ databaseName: event.target.value || undefined })
              onUpdateConnectionDraft(
                { database: event.target.value || undefined },
                { preserveName: true },
              )
            }}
          />
        </FormField>
        <FormField label="Path prefix">
          <input
            aria-label="Warehouse path prefix"
            value={options.pathPrefix ?? ''}
            placeholder="/proxy"
            onChange={(event) => updateOptions({ pathPrefix: event.target.value || undefined })}
          />
        </FormField>
      </div>

      {connectionDraft.engine === 'snowflake' ? (
        <SnowflakeFields options={options} updateOptions={updateOptions} />
      ) : null}
      {connectionDraft.engine === 'bigquery' ? (
        <BigQueryFields
          options={options}
          updateOptions={updateOptions}
          onUpdateConnectionDraft={onUpdateConnectionDraft}
          connectionDraft={connectionDraft}
        />
      ) : null}
      {connectionDraft.engine === 'clickhouse' ? (
        <ClickHouseFields options={options} updateOptions={updateOptions} />
      ) : null}
    </>
  )
}

export function DuckDbFields({
  connectionDraft,
  options,
  updateOptions,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  options: WarehouseConnectionOptions
  updateOptions(patch: Partial<WarehouseConnectionOptions>): void
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  return (
    <>
      <FormField label="Database file">
        <input
          aria-label="DuckDB file path"
          value={options.filePath ?? connectionDraft.database ?? connectionDraft.host ?? ''}
          placeholder="C:/data/warehouse.duckdb or :memory:"
          onChange={(event) => {
            updateOptions({ filePath: event.target.value || undefined })
            onUpdateConnectionDraft(
              { host: event.target.value || '', database: event.target.value || undefined },
              { preserveName: true },
            )
          }}
        />
      </FormField>
      <div className="connection-advanced-grid">
        <FormField label="Catalog">
          <input
            aria-label="DuckDB catalog"
            value={options.catalogName ?? ''}
            placeholder="main"
            onChange={(event) => updateOptions({ catalogName: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Schema">
          <input
            aria-label="DuckDB schema"
            value={options.schemaName ?? ''}
            placeholder="main"
            onChange={(event) => updateOptions({ schemaName: event.target.value || undefined })}
          />
        </FormField>
      </div>
      <div className="connection-advanced-grid">
        <FormField label="Threads">
          <input
            aria-label="DuckDB threads"
            type="number"
            min={1}
            value={options.threads ?? ''}
            onChange={(event) => updateOptions({ threads: Number(event.target.value) || undefined })}
          />
        </FormField>
        <FormField label="Memory limit">
          <input
            aria-label="DuckDB memory limit"
            value={options.memoryLimit ?? ''}
            placeholder="4GB"
            onChange={(event) => updateOptions({ memoryLimit: event.target.value || undefined })}
          />
        </FormField>
      </div>
      <FormField label="Extensions">
        <input
          aria-label="DuckDB extensions"
          value={(options.extensions ?? []).join(', ')}
          placeholder="httpfs, parquet, json"
          onChange={(event) =>
            updateOptions({
              extensions: event.target.value
                .split(',')
                .map((extension) => extension.trim())
                .filter(Boolean),
            })
          }
        />
      </FormField>
    </>
  )
}

function SnowflakeFields({
  options,
  updateOptions,
}: {
  options: WarehouseConnectionOptions
  updateOptions(patch: Partial<WarehouseConnectionOptions>): void
}) {
  return (
    <>
      <div className="connection-advanced-grid">
        <FormField label="Account">
          <input
            aria-label="Snowflake account"
            value={options.accountName ?? ''}
            placeholder="xy12345.eu-west-1"
            onChange={(event) => updateOptions({ accountName: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Schema">
          <input
            aria-label="Snowflake schema"
            value={options.schemaName ?? ''}
            placeholder="PUBLIC"
            onChange={(event) => updateOptions({ schemaName: event.target.value || undefined })}
          />
        </FormField>
      </div>
      <div className="connection-advanced-grid">
        <FormField label="Warehouse">
          <input
            aria-label="Snowflake warehouse"
            value={options.warehouseName ?? ''}
            placeholder="COMPUTE_WH"
            onChange={(event) => updateOptions({ warehouseName: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Role">
          <input
            aria-label="Snowflake role"
            value={options.roleName ?? ''}
            placeholder="ANALYST"
            onChange={(event) => updateOptions({ roleName: event.target.value || undefined })}
          />
        </FormField>
      </div>
    </>
  )
}

function BigQueryFields({
  connectionDraft,
  options,
  updateOptions,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  options: WarehouseConnectionOptions
  updateOptions(patch: Partial<WarehouseConnectionOptions>): void
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  return (
    <>
      <div className="connection-advanced-grid">
        <FormField label="Project">
          <input
            aria-label="BigQuery project"
            value={options.projectId ?? connectionDraft.auth.username ?? ''}
            placeholder="analytics-project"
            onChange={(event) => {
              updateOptions({ projectId: event.target.value || undefined })
              onUpdateConnectionDraft({
                auth: { ...connectionDraft.auth, username: event.target.value || undefined },
              })
            }}
          />
        </FormField>
        <FormField label="Dataset">
          <input
            aria-label="BigQuery dataset"
            value={options.datasetId ?? connectionDraft.database ?? ''}
            placeholder="warehouse"
            onChange={(event) => {
              updateOptions({ datasetId: event.target.value || undefined })
              onUpdateConnectionDraft(
                { database: event.target.value || undefined },
                { preserveName: true },
              )
            }}
          />
        </FormField>
      </div>
      <div className="connection-advanced-grid">
        <FormField label="Location">
          <input
            aria-label="BigQuery location"
            value={options.location ?? ''}
            placeholder="US"
            onChange={(event) => updateOptions({ location: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Profile">
          <input
            aria-label="Warehouse profile"
            value={options.profileName ?? ''}
            placeholder="gcloud profile"
            onChange={(event) => updateOptions({ profileName: event.target.value || undefined })}
          />
        </FormField>
      </div>
    </>
  )
}

function ClickHouseFields({
  options,
  updateOptions,
}: {
  options: WarehouseConnectionOptions
  updateOptions(patch: Partial<WarehouseConnectionOptions>): void
}) {
  return (
    <div className="connection-advanced-grid">
      <FormField label="Catalog">
        <input
          aria-label="ClickHouse catalog"
          value={options.catalogName ?? ''}
          placeholder="default"
          onChange={(event) => updateOptions({ catalogName: event.target.value || undefined })}
        />
      </FormField>
      <FormField label="Region">
        <input
          aria-label="Warehouse region"
          value={options.region ?? ''}
          placeholder="optional cloud region"
          onChange={(event) => updateOptions({ region: event.target.value || undefined })}
        />
      </FormField>
    </div>
  )
}

function endpointPlaceholder(engine: ConnectionProfile['engine']) {
  if (engine === 'snowflake') return 'http://localhost:19100/snowflake or account host'
  if (engine === 'bigquery') return 'http://localhost:19050/bq or bigquery.googleapis.com'
  if (engine === 'clickhouse') return 'http://localhost:8123 or ClickHouse Cloud endpoint'
  return ''
}

function scopeLabel(engine: ConnectionProfile['engine']) {
  if (engine === 'bigquery') return 'Dataset'
  if (engine === 'snowflake') return 'Database'
  return 'Database'
}

function scopePlaceholder(engine: ConnectionProfile['engine']) {
  if (engine === 'bigquery') return 'dataset'
  if (engine === 'snowflake') return 'ANALYTICS'
  return 'default'
}
