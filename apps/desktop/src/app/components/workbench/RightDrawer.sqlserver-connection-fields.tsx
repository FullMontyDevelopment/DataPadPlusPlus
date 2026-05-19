import type { ConnectionProfile, SqlServerConnectionOptions } from '@datapadplusplus/shared-types'
import { FormField } from './RightDrawer.primitives'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'

export function SqlServerAdvancedFields({
  connectionDraft,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.sqlServerOptions ?? {}
  const updateOptions = (patch: Partial<SqlServerConnectionOptions>) =>
    onUpdateConnectionDraft({
      sqlServerOptions: {
        ...options,
        ...patch,
      },
    })

  return (
    <div className="connection-advanced-section" aria-label="SQL Server connection options">
      <strong>SQL Server options</strong>

      <FormField label="Connection mode">
        <select
          aria-label="SQL Server connection mode"
          value={options.connectMode ?? 'tcp'}
          onChange={(event) =>
            updateOptions({
              connectMode: event.target.value as SqlServerConnectionOptions['connectMode'],
            })
          }
        >
          <option value="tcp">TCP host / port</option>
          <option value="named-instance">Named instance</option>
          <option value="azure-sql">Azure SQL</option>
          <option value="localdb">LocalDB</option>
          <option value="shared-memory">Shared memory</option>
          <option value="named-pipes">Named pipes</option>
        </select>
      </FormField>

      {options.connectMode === 'named-instance' ? (
        <FormField label="Instance name">
          <input
            aria-label="SQL Server instance name"
            value={options.instanceName ?? ''}
            placeholder="SQLEXPRESS"
            onChange={(event) => updateOptions({ instanceName: event.target.value || undefined })}
          />
        </FormField>
      ) : null}

      {options.connectMode === 'localdb' ? (
        <FormField label="LocalDB instance">
          <input
            aria-label="SQL Server LocalDB instance"
            value={options.localDbInstance ?? ''}
            placeholder="MSSQLLocalDB"
            onChange={(event) => updateOptions({ localDbInstance: event.target.value || undefined })}
          />
        </FormField>
      ) : null}

      {options.connectMode === 'named-pipes' ? (
        <FormField label="Named pipe path">
          <input
            aria-label="SQL Server named pipe path"
            value={options.namedPipePath ?? ''}
            placeholder="\\\\.\\pipe\\MSSQL$SQLEXPRESS\\sql\\query"
            onChange={(event) => updateOptions({ namedPipePath: event.target.value || undefined })}
          />
        </FormField>
      ) : null}

      {options.connectMode === 'shared-memory' ? (
        <FormField label="Shared memory server">
          <input
            aria-label="SQL Server shared memory server"
            value={options.sharedMemoryServer ?? ''}
            placeholder="localhost"
            onChange={(event) =>
              updateOptions({ sharedMemoryServer: event.target.value || undefined })
            }
          />
        </FormField>
      ) : null}

      <FormField label="Authentication">
        <select
          aria-label="SQL Server authentication mode"
          value={options.authenticationMode ?? 'sql-server'}
          onChange={(event) =>
            updateOptions({
              authenticationMode: event.target
                .value as SqlServerConnectionOptions['authenticationMode'],
            })
          }
        >
          <option value="sql-server">SQL Server login</option>
          <option value="windows">Windows Integrated</option>
          <option value="azure-ad-password">Microsoft Entra password</option>
          <option value="azure-ad-integrated">Microsoft Entra integrated</option>
          <option value="azure-ad-interactive">Microsoft Entra interactive</option>
          <option value="azure-ad-managed-identity">Managed identity</option>
          <option value="azure-ad-service-principal">Service principal</option>
          <option value="certificate">Certificate</option>
        </select>
      </FormField>

      {options.authenticationMode && options.authenticationMode !== 'sql-server' ? (
        <div className="drawer-callout">
          <strong>Stored profile mode</strong>
          <span>
            This mode is saved for the connection profile. Live execution needs a configured token,
            certificate, or platform runtime path.
          </span>
        </div>
      ) : null}

      <div className="drawer-checkbox-grid">
        <label>
          <input
            type="checkbox"
            checked={options.encryptConnection ?? options.connectMode === 'azure-sql'}
            onChange={(event) => updateOptions({ encryptConnection: event.target.checked })}
          />
          Encrypt
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.trustServerCertificate ?? true}
            onChange={(event) => updateOptions({ trustServerCertificate: event.target.checked })}
          />
          Trust certificate
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.readOnlyIntent ?? options.applicationIntent === 'readonly'}
            onChange={(event) => {
              const readOnly = event.target.checked
              updateOptions({
                readOnlyIntent: readOnly,
                applicationIntent: readOnly ? 'readonly' : 'default',
              })
            }}
          />
          Read-only intent
        </label>
      </div>

      <FormField label="Application intent">
        <select
          aria-label="SQL Server application intent"
          value={options.applicationIntent ?? 'default'}
          onChange={(event) =>
            updateOptions({
              applicationIntent: event.target
                .value as SqlServerConnectionOptions['applicationIntent'],
              readOnlyIntent: event.target.value === 'readonly',
            })
          }
        >
          <option value="default">Default</option>
          <option value="readwrite">Read/write</option>
          <option value="readonly">Read-only</option>
        </select>
      </FormField>

      <FormField label="Application name">
        <input
          aria-label="SQL Server application name"
          value={options.applicationName ?? ''}
          placeholder="DataPad++"
          onChange={(event) => updateOptions({ applicationName: event.target.value || undefined })}
        />
      </FormField>

      <FormField label="CA certificate path">
        <input
          aria-label="SQL Server CA certificate path"
          value={options.trustServerCertificateCaPath ?? ''}
          onChange={(event) =>
            updateOptions({ trustServerCertificateCaPath: event.target.value || undefined })
          }
        />
      </FormField>

      <FormField label="Host name in certificate">
        <input
          aria-label="SQL Server host name in certificate"
          value={options.hostNameInCertificate ?? ''}
          placeholder="server.database.windows.net"
          onChange={(event) =>
            updateOptions({ hostNameInCertificate: event.target.value || undefined })
          }
        />
      </FormField>

      <div className="connection-advanced-grid">
        <FormField label="Connect timeout ms">
          <input
            type="number"
            min={1}
            value={options.connectionTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ connectionTimeoutMs: Number(event.target.value) || undefined })
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

      <div className="connection-advanced-grid">
        <FormField label="Retry count">
          <input
            type="number"
            min={0}
            value={options.connectRetryCount ?? ''}
            onChange={(event) =>
              updateOptions({ connectRetryCount: Number(event.target.value) || undefined })
            }
          />
        </FormField>
        <FormField label="Retry interval sec">
          <input
            type="number"
            min={0}
            value={options.connectRetryIntervalSeconds ?? ''}
            onChange={(event) =>
              updateOptions({
                connectRetryIntervalSeconds: Number(event.target.value) || undefined,
              })
            }
          />
        </FormField>
      </div>

      <FormField label="Failover partner">
        <input
          aria-label="SQL Server failover partner"
          value={options.failoverPartner ?? ''}
          onChange={(event) => updateOptions({ failoverPartner: event.target.value || undefined })}
        />
      </FormField>
    </div>
  )
}
