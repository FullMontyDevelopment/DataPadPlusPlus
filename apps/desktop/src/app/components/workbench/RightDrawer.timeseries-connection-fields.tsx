import type { ConnectionProfile, TimeSeriesConnectionOptions } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

export function TimeSeriesConnectionFields({
  connectionDraft,
  secretDraft,
  onSecretDraftChange,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  secretDraft: string
  onSecretDraftChange(value: string): void
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.timeSeriesOptions ?? {}
  const connectMode = options.connectMode ?? defaultConnectMode(connectionDraft.engine)
  const authMode = options.authMode ?? 'none'
  const showCredential =
    authMode === 'basic' ||
    authMode === 'bearer-token' ||
    authMode === 'api-token' ||
    authMode === 'custom-header'
  const updateOptions = (patch: Partial<TimeSeriesConnectionOptions>) =>
    onUpdateConnectionDraft({
      timeSeriesOptions: {
        connectMode,
        authMode,
        ...options,
        ...patch,
      },
    })

  return (
    <div className="connection-advanced-section" aria-label="Time-series connection options">
      <strong>{engineLabel(connectionDraft.engine)} options</strong>

      <div className="connection-advanced-grid">
        <FormField label="Mode">
          <select
            aria-label="Time-series connection mode"
            value={connectMode}
            onChange={(event) =>
              updateOptions({
                connectMode: event.target.value as TimeSeriesConnectionOptions['connectMode'],
              })
            }
          >
            {connectionModes(connectionDraft.engine).map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Auth">
          <select
            aria-label="Time-series auth mode"
            value={authMode}
            onChange={(event) =>
              updateOptions({
                authMode: event.target.value as TimeSeriesConnectionOptions['authMode'],
              })
            }
          >
            <option value="none">None</option>
            <option value="basic">Basic</option>
            <option value="bearer-token">Bearer token</option>
            <option value="api-token">API token</option>
            <option value="custom-header">Custom header</option>
          </select>
        </FormField>
      </div>

      <FormField label="Endpoint">
        <input
          aria-label="Time-series endpoint URL"
          value={options.endpointUrl ?? ''}
          placeholder={endpointPlaceholder(connectionDraft.engine)}
          onChange={(event) => {
            updateOptions({ endpointUrl: event.target.value || undefined })
            onUpdateConnectionDraft(
              { host: event.target.value || connectionDraft.host },
              { preserveName: true },
            )
          }}
        />
      </FormField>

      <div className="connection-advanced-grid">
        <FormField label="Path prefix">
          <input
            aria-label="Time-series path prefix"
            value={options.pathPrefix ?? ''}
            placeholder="/prometheus"
            onChange={(event) => updateOptions({ pathPrefix: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Query timeout ms">
          <input
            aria-label="Time-series query timeout"
            type="number"
            min={1}
            value={options.queryTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ queryTimeoutMs: Number(event.target.value) || undefined })
            }
          />
        </FormField>
      </div>

      {connectionDraft.engine === 'influxdb' ? (
        <InfluxFields
          connectionDraft={connectionDraft}
          options={options}
          updateOptions={updateOptions}
          onUpdateConnectionDraft={onUpdateConnectionDraft}
        />
      ) : (
        <MetricFields options={options} updateOptions={updateOptions} />
      )}

      {authMode === 'custom-header' ? (
        <FormField label="Header name">
          <input
            aria-label="Time-series custom header name"
            value={options.customHeaderName ?? ''}
            placeholder="X-Scope-OrgID"
            onChange={(event) => updateOptions({ customHeaderName: event.target.value || undefined })}
          />
        </FormField>
      ) : null}

      <FormField label="Credential">
        <input
          aria-label="Time-series credential"
          type="password"
          autoComplete="new-password"
          disabled={!showCredential}
          value={showCredential ? secretDraft : ''}
          placeholder={
            connectionDraft.auth.secretRef
              ? 'Stored credential'
              : showCredential
                ? credentialPlaceholder(authMode)
                : 'Not required'
          }
          onChange={(event) => onSecretDraftChange(event.target.value)}
        />
      </FormField>

      <div className="connection-advanced-grid">
        <FormField label="Tenant header">
          <input
            aria-label="Time-series tenant header"
            value={options.tenantHeaderName ?? ''}
            placeholder="X-Scope-OrgID"
            onChange={(event) => updateOptions({ tenantHeaderName: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Tenant id">
          <input
            aria-label="Time-series tenant id"
            value={options.tenantId ?? ''}
            placeholder="team-a"
            onChange={(event) => updateOptions({ tenantId: event.target.value || undefined })}
          />
        </FormField>
      </div>

      <div className="drawer-checkbox-grid">
        <label>
          <input
            type="checkbox"
            checked={options.useTls ?? false}
            onChange={(event) => updateOptions({ useTls: event.target.checked })}
          />
          TLS
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.verifyCertificates ?? true}
            onChange={(event) => updateOptions({ verifyCertificates: event.target.checked })}
          />
          Verify certs
        </label>
      </div>
    </div>
  )
}

function InfluxFields({
  connectionDraft,
  options,
  updateOptions,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  options: TimeSeriesConnectionOptions
  updateOptions(patch: Partial<TimeSeriesConnectionOptions>): void
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  return (
    <>
      <div className="connection-advanced-grid">
        <FormField label="Organization">
          <input
            aria-label="InfluxDB organization"
            value={options.organization ?? ''}
            placeholder="my-org"
            onChange={(event) => updateOptions({ organization: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Bucket">
          <input
            aria-label="InfluxDB bucket"
            value={options.bucket ?? connectionDraft.database ?? ''}
            placeholder="telemetry"
            onChange={(event) => {
              updateOptions({ bucket: event.target.value || undefined })
              onUpdateConnectionDraft(
                { database: event.target.value || undefined },
                { preserveName: true },
              )
            }}
          />
        </FormField>
      </div>
      <div className="connection-advanced-grid">
        <FormField label="Database">
          <input
            aria-label="InfluxDB database"
            value={options.databaseName ?? ''}
            placeholder="v1 database"
            onChange={(event) => updateOptions({ databaseName: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Retention">
          <input
            aria-label="InfluxDB retention policy"
            value={options.retentionPolicy ?? ''}
            placeholder="autogen"
            onChange={(event) =>
              updateOptions({ retentionPolicy: event.target.value || undefined })
            }
          />
        </FormField>
      </div>
      <FormField label="Query language">
        <select
          aria-label="Time-series query language"
          value={options.defaultQueryLanguage ?? 'influxql'}
          onChange={(event) =>
            updateOptions({
              defaultQueryLanguage: event.target.value as TimeSeriesConnectionOptions['defaultQueryLanguage'],
            })
          }
        >
          <option value="influxql">InfluxQL</option>
          <option value="flux">Flux</option>
          <option value="sql">InfluxDB SQL</option>
        </select>
      </FormField>
    </>
  )
}

function MetricFields({
  options,
  updateOptions,
}: {
  options: TimeSeriesConnectionOptions
  updateOptions(patch: Partial<TimeSeriesConnectionOptions>): void
}) {
  return (
    <div className="connection-advanced-grid">
      <FormField label="Default metric">
        <input
          aria-label="Time-series default metric"
          value={options.defaultMetric ?? ''}
          placeholder="http_requests_total"
          onChange={(event) => updateOptions({ defaultMetric: event.target.value || undefined })}
        />
      </FormField>
      <FormField label="Default range">
        <input
          aria-label="Time-series default range"
          value={options.defaultRange ?? ''}
          placeholder="-1h"
          onChange={(event) => updateOptions({ defaultRange: event.target.value || undefined })}
        />
      </FormField>
    </div>
  )
}

function connectionModes(engine: ConnectionProfile['engine']) {
  if (engine === 'influxdb') {
    return [
      { value: 'influx-v1', label: 'InfluxDB v1' },
      { value: 'influx-v2', label: 'InfluxDB v2' },
      { value: 'influx-v3', label: 'InfluxDB v3 / Cloud' },
      { value: 'http', label: 'HTTP endpoint' },
    ] as const
  }
  if (engine === 'opentsdb') {
    return [
      { value: 'opentsdb-http', label: 'HTTP API' },
      { value: 'http', label: 'HTTP endpoint' },
    ] as const
  }
  return [
    { value: 'http', label: 'HTTP API' },
    { value: 'cloud', label: 'Managed endpoint' },
  ] as const
}

function defaultConnectMode(engine: ConnectionProfile['engine']): TimeSeriesConnectionOptions['connectMode'] {
  if (engine === 'influxdb') return 'influx-v2'
  if (engine === 'opentsdb') return 'opentsdb-http'
  return 'http'
}

function endpointPlaceholder(engine: ConnectionProfile['engine']) {
  if (engine === 'influxdb') return 'http://localhost:8086'
  if (engine === 'opentsdb') return 'http://localhost:4242'
  return 'http://localhost:9090'
}

function engineLabel(engine: ConnectionProfile['engine']) {
  if (engine === 'influxdb') return 'InfluxDB'
  if (engine === 'opentsdb') return 'OpenTSDB'
  return 'Prometheus'
}

function credentialPlaceholder(authMode: TimeSeriesConnectionOptions['authMode']) {
  if (authMode === 'basic') return 'Password'
  if (authMode === 'api-token') return 'API token'
  if (authMode === 'custom-header') return 'Header value'
  return 'Bearer token'
}
