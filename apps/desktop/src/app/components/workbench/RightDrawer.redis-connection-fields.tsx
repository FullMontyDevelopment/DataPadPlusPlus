import type { ConnectionProfile, RedisConnectionOptions } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

export function RedisAdvancedFields({
  connectionDraft,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.redisOptions ?? {}
  const unixSocketUnavailable =
    typeof navigator !== 'undefined' && /win/i.test(navigator.platform)
  const redisDatabaseIndex =
    options.databaseIndex ?? (Number(connectionDraft.database ?? 0) || 0)
  const updateOptions = (patch: Partial<RedisConnectionOptions>) =>
    onUpdateConnectionDraft({
      redisOptions: {
        ...options,
        ...patch,
      },
    })

  return (
    <div className="connection-advanced-section" aria-label="Redis connection options">
      <strong>Redis options</strong>
      <FormField label="Deployment">
        <select
          aria-label="Redis deployment mode"
          value={options.deploymentMode ?? 'standalone'}
          onChange={(event) =>
            updateOptions({
              deploymentMode: event.target.value as RedisConnectionOptions['deploymentMode'],
              useTls: event.target.value === 'tls' ? true : options.useTls,
            })
          }
        >
          <option value="standalone">Standalone</option>
          <option value="tls">TLS / rediss</option>
          <option value="sentinel">Sentinel</option>
          <option value="cluster">Cluster seed</option>
          <option value="unix-socket" disabled={unixSocketUnavailable}>
            Unix socket{unixSocketUnavailable ? ' (not on Windows)' : ''}
          </option>
        </select>
      </FormField>

      <FormField label="Database index">
        <input
          aria-label="Redis database index"
          type="number"
          min={0}
          value={redisDatabaseIndex}
          onChange={(event) => {
            const databaseIndex = Math.max(0, Number(event.target.value) || 0)
            updateOptions({ databaseIndex })
            onUpdateConnectionDraft({ database: String(databaseIndex) }, { preserveName: true })
          }}
        />
      </FormField>

      <FormField label="RESP version">
        <select
          aria-label="Redis RESP version"
          value={options.respVersion ?? 'resp2'}
          onChange={(event) =>
            updateOptions({
              respVersion: event.target.value as RedisConnectionOptions['respVersion'],
            })
          }
        >
          <option value="resp2">RESP2</option>
          <option value="resp3">RESP3</option>
        </select>
      </FormField>

      <FormField label="Client name">
        <input
          aria-label="Redis client name"
          value={options.clientName ?? ''}
          placeholder="DataPadPlusPlus"
          onChange={(event) => updateOptions({ clientName: event.target.value || undefined })}
        />
      </FormField>

      <div className="drawer-checkbox-grid">
        <label>
          <input
            type="checkbox"
            checked={options.useTls ?? options.deploymentMode === 'tls'}
            onChange={(event) => updateOptions({ useTls: event.target.checked })}
          />
          TLS
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.readOnlyMode ?? false}
            onChange={(event) => updateOptions({ readOnlyMode: event.target.checked })}
          />
          Read-only replica
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.autoReconnect ?? true}
            onChange={(event) => updateOptions({ autoReconnect: event.target.checked })}
          />
          Auto reconnect
        </label>
      </div>

      {options.deploymentMode === 'sentinel' ? (
        <>
          <FormField label="Sentinel master">
            <input
              aria-label="Redis Sentinel master name"
              value={options.sentinelMasterName ?? ''}
              placeholder="mymaster"
              onChange={(event) =>
                updateOptions({ sentinelMasterName: event.target.value || undefined })
              }
            />
          </FormField>
          <FormField label="Sentinel hosts">
            <textarea
              aria-label="Redis Sentinel hosts"
              value={(options.sentinelHosts ?? []).join('\n')}
              placeholder="host1:26379&#10;host2:26379"
              onChange={(event) =>
                updateOptions({
                  sentinelHosts: event.target.value
                    .split(/\r?\n|,/)
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </FormField>
        </>
      ) : null}

      {options.deploymentMode === 'cluster' ? (
        <FormField label="Cluster seed nodes">
          <textarea
            aria-label="Redis Cluster seed nodes"
            value={(options.clusterNodes ?? []).join('\n')}
            placeholder="host1:6379&#10;host2:6379"
            onChange={(event) =>
              updateOptions({
                clusterNodes: event.target.value
                  .split(/\r?\n|,/)
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </FormField>
      ) : null}

      {options.deploymentMode === 'unix-socket' ? (
        <FormField label="Unix socket">
          <input
            aria-label="Redis Unix socket path"
            disabled={unixSocketUnavailable}
            value={options.unixSocketPath ?? ''}
            placeholder="/var/run/redis/redis.sock"
            onChange={(event) =>
              updateOptions({ unixSocketPath: event.target.value || undefined })
            }
          />
          {unixSocketUnavailable ? (
            <span className="field-hint">
              Use TCP host and port on Windows.
            </span>
          ) : null}
        </FormField>
      ) : null}

      {options.useTls || options.deploymentMode === 'tls' ? (
        <>
          <FormField label="CA certificate path">
            <input
              aria-label="Redis CA certificate path"
              value={options.caCertificatePath ?? ''}
              onChange={(event) =>
                updateOptions({ caCertificatePath: event.target.value || undefined })
              }
            />
          </FormField>
          <FormField label="Client certificate path">
            <input
              aria-label="Redis client certificate path"
              value={options.clientCertificatePath ?? ''}
              onChange={(event) =>
                updateOptions({ clientCertificatePath: event.target.value || undefined })
              }
            />
          </FormField>
        </>
      ) : null}

      <div className="connection-advanced-grid">
        <FormField label="Connect timeout ms">
          <input
            type="number"
            min={1}
            value={options.connectionTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({
                connectionTimeoutMs: Number(event.target.value) || undefined,
              })
            }
          />
        </FormField>
        <FormField label="Command timeout ms">
          <input
            type="number"
            min={1}
            value={options.commandTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({
                commandTimeoutMs: Number(event.target.value) || undefined,
              })
            }
          />
        </FormField>
      </div>
    </div>
  )
}
