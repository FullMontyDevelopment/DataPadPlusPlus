import type { ConnectionProfile, MySqlConnectionOptions } from '@datapadplusplus/shared-types'
import { mysqlAuthSupport } from '../../../services/runtime/mysql-auth-disabled-reasons'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

export function MySqlAdvancedFields({
  connectionDraft,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.mysqlOptions ?? {}
  const isMariaDb = connectionDraft.engine === 'mariadb'
  const engineLabel = isMariaDb ? 'MariaDB' : 'MySQL'
  const authSupport = mysqlAuthSupport(options, engineLabel)
  const updateOptions = (patch: Partial<MySqlConnectionOptions>) =>
    onUpdateConnectionDraft({
      mysqlOptions: {
        ...options,
        ...patch,
      },
    })
  const sslMode = options.sslMode ?? mysqlSslModeFromShared(connectionDraft.auth.sslMode)
  const tlsEnabled = sslMode !== 'disabled'

  return (
    <div className="connection-advanced-section" aria-label={`${engineLabel} connection options`}>
      <strong>{engineLabel} options</strong>

      <FormField label="Connection mode">
        <select
          aria-label={`${engineLabel} connection mode`}
          value={options.connectMode ?? 'tcp'}
          onChange={(event) =>
            updateOptions({
              connectMode: event.target.value as MySqlConnectionOptions['connectMode'],
            })
          }
        >
          <option value="tcp">TCP host / port</option>
          <option value="unix-socket">Unix socket</option>
          <option value="cloud-sql-proxy">Cloud SQL proxy socket</option>
          <option value={isMariaDb ? 'managed-mariadb' : 'managed-mysql'}>
            {isMariaDb ? 'Managed MariaDB' : 'Managed MySQL'}
          </option>
          <option value="connection-string">Connection string controlled</option>
        </select>
      </FormField>

      {options.connectMode === 'unix-socket' ? (
        <FormField label="Unix socket path">
          <input
            aria-label={`${engineLabel} Unix socket path`}
            value={options.unixSocketPath ?? ''}
            placeholder="/var/run/mysqld/mysqld.sock"
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

      <FormField label="Authentication">
        <select
          aria-label={`${engineLabel} authentication mode`}
          value={options.authMode ?? 'password'}
          onChange={(event) =>
            updateOptions({ authMode: event.target.value as MySqlConnectionOptions['authMode'] })
          }
        >
          <option value="password">Password / server plugin</option>
          <option value="cleartext-plugin">Cleartext plugin metadata</option>
          <option value="iam-token">IAM token metadata</option>
        </select>
      </FormField>

      {!authSupport.live ? (
        <div className="drawer-callout" role="note" aria-label={`${engineLabel} auth disabled reason`}>
          <strong>Plan-only authentication</strong>
          <span>{authSupport.disabledReason}</span>
        </div>
      ) : null}

      <FormField label="SSL mode">
        <select
          aria-label={`${engineLabel} SSL mode`}
          value={sslMode}
          onChange={(event) =>
            updateOptions({
              sslMode: event.target.value as MySqlConnectionOptions['sslMode'],
            })
          }
        >
          <option value="disabled">Disabled</option>
          <option value="preferred">Preferred</option>
          <option value="required">Required</option>
          <option value="verify-ca">Verify CA</option>
          <option value="verify-identity">Verify identity</option>
        </select>
      </FormField>

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
        <FormField label="Server flavor">
          <select
            aria-label={`${engineLabel} server flavor`}
            value={options.serverFlavor ?? (isMariaDb ? 'mariadb' : 'mysql')}
            onChange={(event) =>
              updateOptions({ serverFlavor: event.target.value as MySqlConnectionOptions['serverFlavor'] })
            }
          >
            <option value="mysql">MySQL</option>
            <option value="mariadb">MariaDB</option>
            <option value="percona">Percona Server</option>
            <option value="aurora-mysql">Aurora MySQL-compatible</option>
          </select>
        </FormField>
        <FormField label="Application name">
          <input
            aria-label={`${engineLabel} application name`}
            value={options.applicationName ?? ''}
            placeholder="DataPad++"
            onChange={(event) => updateOptions({ applicationName: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Time zone">
          <input
            aria-label={`${engineLabel} time zone`}
            value={options.timeZone ?? ''}
            placeholder="+00:00"
            onChange={(event) => updateOptions({ timeZone: event.target.value || undefined })}
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Charset">
          <input
            aria-label={`${engineLabel} charset`}
            value={options.charset ?? ''}
            placeholder="utf8mb4"
            onChange={(event) => updateOptions({ charset: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Collation">
          <input
            aria-label={`${engineLabel} collation`}
            value={options.collation ?? ''}
            placeholder={isMariaDb ? 'utf8mb4_unicode_ci' : 'utf8mb4_0900_ai_ci'}
            onChange={(event) => updateOptions({ collation: event.target.value || undefined })}
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="SQL mode">
          <input
            aria-label={`${engineLabel} SQL mode`}
            value={options.sqlMode ?? ''}
            placeholder="STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION"
            onChange={(event) => updateOptions({ sqlMode: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Default storage engine">
          <input
            aria-label={`${engineLabel} default storage engine`}
            value={options.defaultStorageEngine ?? ''}
            placeholder={isMariaDb ? 'InnoDB or Aria' : 'InnoDB'}
            onChange={(event) =>
              updateOptions({ defaultStorageEngine: event.target.value || undefined })
            }
          />
        </FormField>
      </div>

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
        <FormField label="Command timeout ms">
          <input
            type="number"
            min={1}
            value={options.commandTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ commandTimeoutMs: Number(event.target.value) || undefined })
            }
          />
        </FormField>
      </div>

      <FormField label="Statement cache capacity">
        <input
          aria-label={`${engineLabel} statement cache capacity`}
          type="number"
          min={0}
          value={options.statementCacheCapacity ?? ''}
          onChange={(event) =>
            updateOptions({ statementCacheCapacity: Number(event.target.value) || undefined })
          }
        />
      </FormField>

      <label className="connection-toggle">
        <input
          aria-label={`${engineLabel} allow local infile`}
          type="checkbox"
          checked={Boolean(options.allowLocalInfile)}
          onChange={(event) => updateOptions({ allowLocalInfile: event.target.checked || undefined })}
        />
        <span>Allow LOCAL INFILE metadata</span>
      </label>
    </div>
  )
}

function mysqlSslModeFromShared(
  sslMode: ConnectionProfile['auth']['sslMode'],
): MySqlConnectionOptions['sslMode'] {
  if (sslMode === 'disable') {
    return 'disabled'
  }
  if (sslMode === 'require') {
    return 'required'
  }
  if (sslMode === 'verify-ca') {
    return 'verify-ca'
  }
  if (sslMode === 'verify-full') {
    return 'verify-identity'
  }
  return 'preferred'
}
