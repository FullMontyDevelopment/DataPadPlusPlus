import type { ConnectionProfile, OracleConnectionOptions } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

export function OracleAdvancedFields({
  connectionDraft,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.oracleOptions ?? {}
  const updateOptions = (patch: Partial<OracleConnectionOptions>) =>
    onUpdateConnectionDraft({
      oracleOptions: {
        ...options,
        ...patch,
      },
    })

  const tlsEnabled =
    options.useTls ?? (options.connectMode === 'tcps' || options.connectMode === 'cloud-wallet')
  const executionRuntime = options.executionRuntime ?? 'managed'

  return (
    <div className="connection-advanced-section" aria-label="Oracle connection options">
      <strong>Oracle options</strong>
      <FormField label="Connect mode">
        <select
          aria-label="Oracle connect mode"
          value={options.connectMode ?? 'service-name'}
          onChange={(event) =>
            updateOptions({
              connectMode: event.target.value as OracleConnectionOptions['connectMode'],
              useTls:
                event.target.value === 'tcps' || event.target.value === 'cloud-wallet'
                  ? true
                  : options.useTls,
            })
          }
        >
          <option value="service-name">Service name</option>
          <option value="sid">SID</option>
          <option value="tns-alias">TNS alias</option>
          <option value="easy-connect">Easy Connect</option>
          <option value="tcps">TCPS</option>
          <option value="cloud-wallet">Cloud wallet</option>
        </select>
      </FormField>

      {options.connectMode === 'sid' ? (
        <FormField label="SID">
          <input
            aria-label="Oracle SID"
            value={options.sid ?? ''}
            placeholder="ORCL"
            onChange={(event) => updateOptions({ sid: event.target.value || undefined })}
          />
        </FormField>
      ) : null}

      {options.connectMode === 'tns-alias' ? (
        <FormField label="TNS alias">
          <input
            aria-label="Oracle TNS alias"
            value={options.tnsAlias ?? ''}
            placeholder="SALES_PDB"
            onChange={(event) => updateOptions({ tnsAlias: event.target.value || undefined })}
          />
        </FormField>
      ) : null}

      {options.connectMode === 'easy-connect' ? (
        <FormField label="Easy Connect">
          <input
            aria-label="Oracle Easy Connect string"
            value={options.easyConnectString ?? ''}
            placeholder="host:1521/service_name"
            onChange={(event) =>
              updateOptions({ easyConnectString: event.target.value || undefined })
            }
          />
        </FormField>
      ) : null}

      {options.connectMode !== 'sid' &&
      options.connectMode !== 'tns-alias' &&
      options.connectMode !== 'easy-connect' ? (
        <FormField label="Service name">
          <input
            aria-label="Oracle service name"
            value={options.serviceName ?? connectionDraft.database ?? ''}
            placeholder="ORCLPDB1"
            onChange={(event) => {
              updateOptions({ serviceName: event.target.value || undefined })
              onUpdateConnectionDraft({ database: event.target.value || undefined }, { preserveName: true })
            }}
          />
        </FormField>
      ) : null}

      <div className="connection-advanced-grid">
        <FormField label="Execution runtime">
          <select
            aria-label="Oracle execution runtime"
            value={executionRuntime}
            onChange={(event) =>
              updateOptions({
                executionRuntime: event.target.value as OracleConnectionOptions['executionRuntime'],
              })
            }
          >
            <option value="managed">Built-in Oracle driver</option>
            <option value="sqlplus">SQLPlus legacy fallback</option>
            <option value="contract">Preview only (no connection)</option>
          </select>
        </FormField>
        {executionRuntime === 'sqlplus' ? (
          <FormField label="SQLPlus path">
            <input
              aria-label="Oracle SQLPlus path"
              value={options.sqlPlusPath ?? ''}
              placeholder="sqlplus"
              onChange={(event) => updateOptions({ sqlPlusPath: event.target.value || undefined })}
            />
          </FormField>
        ) : <span />}
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Role">
          <select
            aria-label="Oracle connection role"
            value={options.connectionRole ?? 'default'}
            onChange={(event) =>
              updateOptions({
                connectionRole: event.target.value as OracleConnectionOptions['connectionRole'],
              })
            }
          >
            <option value="default">Default</option>
            <option value="sysdba">SYSDBA</option>
            <option value="sysoper">SYSOPER</option>
            <option value="sysbackup">SYSBACKUP</option>
            <option value="sysdg">SYSDG</option>
            <option value="syskm">SYSKM</option>
            <option value="sysrac">SYSRAC</option>
          </select>
        </FormField>
        <FormField label="Fetch size">
          <input
            aria-label="Oracle fetch size"
            type="number"
            min={1}
            value={options.fetchSize ?? ''}
            onChange={(event) =>
              updateOptions({ fetchSize: Number(event.target.value) || undefined })
            }
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Proxy user">
          <input
            aria-label="Oracle proxy user"
            value={options.proxyUser ?? ''}
            placeholder="proxy_user"
            onChange={(event) => updateOptions({ proxyUser: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Client identifier">
          <input
            aria-label="Oracle client identifier"
            value={options.clientIdentifier ?? ''}
            placeholder="audit/client id"
            onChange={(event) =>
              updateOptions({ clientIdentifier: event.target.value || undefined })
            }
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Application name">
          <input
            aria-label="Oracle application name"
            value={options.applicationName ?? ''}
            placeholder="DataPad++"
            onChange={(event) =>
              updateOptions({ applicationName: event.target.value || undefined })
            }
          />
        </FormField>
        <FormField label="Edition">
          <input
            aria-label="Oracle edition"
            value={options.edition ?? ''}
            onChange={(event) => updateOptions({ edition: event.target.value || undefined })}
          />
        </FormField>
      </div>

      <div className="drawer-checkbox-grid">
        <label>
          <input
            type="checkbox"
            checked={tlsEnabled}
            onChange={(event) => updateOptions({ useTls: event.target.checked })}
          />
          TCPS / TLS
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.validateConnection ?? true}
            onChange={(event) => updateOptions({ validateConnection: event.target.checked })}
          />
          Validate connection
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.highAvailabilityEvents ?? false}
            onChange={(event) => updateOptions({ highAvailabilityEvents: event.target.checked })}
          />
          HA events
        </label>
      </div>

      {tlsEnabled ? (
        <>
          <FormField label="Wallet path">
            <input
              aria-label="Oracle wallet path"
              value={options.walletPath ?? ''}
              placeholder="C:/oracle/wallet"
              onChange={(event) =>
                updateOptions({ walletPath: event.target.value || undefined })
              }
            />
          </FormField>
        </>
      ) : null}

      {(options.connectMode === 'tns-alias' || options.connectMode === 'cloud-wallet') ? (
        <FormField label="TNS admin path">
          <input
            aria-label="Oracle TNS admin path"
            value={options.tnsAdminPath ?? ''}
            placeholder="C:/oracle/network/admin"
            onChange={(event) => updateOptions({ tnsAdminPath: event.target.value || undefined })}
          />
        </FormField>
      ) : null}

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
        <FormField label="Statement cache">
          <input
            type="number"
            min={0}
            value={options.statementCacheSize ?? ''}
            onChange={(event) =>
              updateOptions({ statementCacheSize: Number(event.target.value) || undefined })
            }
          />
        </FormField>
      </div>
    </div>
  )
}
