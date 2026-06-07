import type { ConnectionProfile, PostgresConnectionOptions } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { CockroachProfileFields } from './RightDrawer.cockroach-connection-fields'
import { FormField } from './RightDrawer.primitives'
import { TimescaleProfileFields } from './RightDrawer.timescale-connection-fields'

export function PostgresAdvancedFields({
  connectionDraft,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.postgresOptions ?? {}
  const engineLabel = connectionDraft.engine === 'cockroachdb'
    ? 'CockroachDB'
    : connectionDraft.engine === 'timescaledb'
      ? 'TimescaleDB'
      : 'PostgreSQL'
  const updateOptions = (patch: Partial<PostgresConnectionOptions>) =>
    onUpdateConnectionDraft({
      postgresOptions: {
        ...options,
        ...patch,
      },
    })

  const tlsEnabled = options.useTls ?? false

  return (
    <>
    <div className="connection-advanced-section" aria-label={`${engineLabel} connection options`}>
      <strong>{engineLabel} options</strong>

      <FormField label="Connect mode">
        <select
          aria-label={`${engineLabel} connect mode`}
          value={options.connectMode ?? 'tcp'}
          onChange={(event) =>
            updateOptions({
              connectMode: event.target.value as PostgresConnectionOptions['connectMode'],
            })
          }
        >
          <option value="tcp">TCP host / port</option>
          <option value="unix-socket">Unix socket</option>
          <option value="cloud-sql-proxy">Cloud SQL proxy</option>
          <option value="managed-postgres">Managed PostgreSQL</option>
          <option value="connection-string">Connection string controlled</option>
        </select>
      </FormField>

      {options.connectMode === 'unix-socket' ? (
        <FormField label="Unix socket path">
          <input
            aria-label={`${engineLabel} Unix socket path`}
            value={options.unixSocketPath ?? ''}
            placeholder="/var/run/postgresql"
            onChange={(event) => updateOptions({ unixSocketPath: event.target.value || undefined })}
          />
        </FormField>
      ) : null}

      {options.connectMode === 'cloud-sql-proxy' ? (
        <FormField label="Cloud SQL instance">
          <input
            aria-label={`${engineLabel} Cloud SQL instance`}
            value={options.cloudSqlInstance ?? ''}
            placeholder="project:region:instance"
            onChange={(event) =>
              updateOptions({ cloudSqlInstance: event.target.value || undefined })
            }
          />
        </FormField>
      ) : null}

      <div className="connection-advanced-grid">
        <FormField label="Application name">
          <input
            aria-label={`${engineLabel} application name`}
            value={options.applicationName ?? ''}
            placeholder="DataPad++"
            onChange={(event) => updateOptions({ applicationName: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Target session">
          <select
            aria-label={`${engineLabel} target session attributes`}
            value={options.targetSessionAttrs ?? 'any'}
            onChange={(event) =>
              updateOptions({
                targetSessionAttrs: event.target
                  .value as PostgresConnectionOptions['targetSessionAttrs'],
              })
            }
          >
            <option value="any">Any</option>
            <option value="read-write">Read/write</option>
            <option value="read-only">Read-only</option>
            <option value="primary">Primary</option>
            <option value="standby">Standby</option>
            <option value="prefer-standby">Prefer standby</option>
          </select>
        </FormField>
      </div>

      <FormField label="Search path">
        <input
          aria-label={`${engineLabel} search path`}
          value={options.searchPath ?? ''}
          placeholder="analytics, public"
          onChange={(event) => updateOptions({ searchPath: event.target.value || undefined })}
        />
      </FormField>

      <div className="drawer-checkbox-grid">
        <label>
          <input
            type="checkbox"
            checked={tlsEnabled}
            onChange={(event) => updateOptions({ useTls: event.target.checked })}
          />
          TLS
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.verifyServerCertificate ?? false}
            disabled={!tlsEnabled}
            onChange={(event) =>
              updateOptions({ verifyServerCertificate: event.target.checked })
            }
          />
          Verify certificate
        </label>
      </div>

      {tlsEnabled ? (
        <>
          <div className="connection-advanced-grid">
            <FormField label="CA certificate">
              <input
                aria-label={`${engineLabel} CA certificate path`}
                value={options.caCertificatePath ?? ''}
                onChange={(event) =>
                  updateOptions({ caCertificatePath: event.target.value || undefined })
                }
              />
            </FormField>
            <FormField label="Client certificate">
              <input
                aria-label={`${engineLabel} client certificate path`}
                value={options.clientCertificatePath ?? ''}
                onChange={(event) =>
                  updateOptions({ clientCertificatePath: event.target.value || undefined })
                }
              />
            </FormField>
          </div>
          <FormField label="Client key">
            <input
              aria-label={`${engineLabel} client key path`}
              value={options.clientKeyPath ?? ''}
              onChange={(event) => updateOptions({ clientKeyPath: event.target.value || undefined })}
            />
          </FormField>
        </>
      ) : null}

      <div className="connection-advanced-grid">
        <FormField label="Connect timeout ms">
          <input
            type="number"
            min={1}
            value={options.connectTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ connectTimeoutMs: Number(event.target.value) || undefined })
            }
          />
        </FormField>
        <FormField label="Statement timeout ms">
          <input
            type="number"
            min={1}
            value={options.statementTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ statementTimeoutMs: Number(event.target.value) || undefined })
            }
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Lock timeout ms">
          <input
            type="number"
            min={1}
            value={options.lockTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ lockTimeoutMs: Number(event.target.value) || undefined })
            }
          />
        </FormField>
        <FormField label="Idle transaction ms">
          <input
            type="number"
            min={1}
            value={options.idleInTransactionSessionTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({
                idleInTransactionSessionTimeoutMs: Number(event.target.value) || undefined,
              })
            }
          />
        </FormField>
      </div>
    </div>
    {connectionDraft.engine === 'cockroachdb' ? (
      <CockroachProfileFields
        connectionDraft={connectionDraft}
        onUpdateConnectionDraft={onUpdateConnectionDraft}
      />
    ) : null}
    {connectionDraft.engine === 'timescaledb' ? (
      <TimescaleProfileFields
        connectionDraft={connectionDraft}
        onUpdateConnectionDraft={onUpdateConnectionDraft}
      />
    ) : null}
    </>
  )
}
