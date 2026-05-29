import type { CassandraConnectionOptions, ConnectionProfile } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

export function CassandraAdvancedFields({
  connectionDraft,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.cassandraOptions ?? {}
  const updateOptions = (patch: Partial<CassandraConnectionOptions>) =>
    onUpdateConnectionDraft({
      cassandraOptions: {
        ...options,
        ...patch,
      },
    })

  const contactPoints = options.contactPoints?.length
    ? options.contactPoints.join('\n')
    : connectionDraft.host

  return (
    <div className="connection-advanced-section" aria-label="Cassandra connection options">
      <strong>Cassandra options</strong>

      <FormField label="Contact points">
        <textarea
          aria-label="Cassandra contact points"
          value={contactPoints}
          placeholder="node1:9042&#10;node2:9042"
          onChange={(event) => {
            const contactPoints = event.target.value
              .split(/\r?\n|,/)
              .map((value) => value.trim())
              .filter(Boolean)
            updateOptions({ contactPoints })
            onUpdateConnectionDraft(
              { host: contactPoints[0]?.replace(/:\d+$/, '') ?? '' },
              { preserveName: true },
            )
          }}
        />
      </FormField>

      <div className="connection-advanced-grid">
        <FormField label="Keyspace">
          <input
            aria-label="Cassandra default keyspace"
            value={options.defaultKeyspace ?? connectionDraft.database ?? ''}
            placeholder="catalog"
            onChange={(event) => {
              updateOptions({ defaultKeyspace: event.target.value || undefined })
              onUpdateConnectionDraft(
                { database: event.target.value || undefined },
                { preserveName: true },
              )
            }}
          />
        </FormField>
        <FormField label="Datacenter">
          <input
            aria-label="Cassandra local datacenter"
            value={options.localDatacenter ?? ''}
            placeholder="datacenter1"
            onChange={(event) =>
              updateOptions({ localDatacenter: event.target.value || undefined })
            }
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Connect mode">
          <select
            aria-label="Cassandra connect mode"
            value={options.connectMode ?? 'contact-points'}
            onChange={(event) =>
              updateOptions({
                connectMode: event.target.value as CassandraConnectionOptions['connectMode'],
              })
            }
          >
            <option value="contact-points">Contact points</option>
            <option value="connection-string">Connection string</option>
            <option value="secure-connect-bundle">Secure bundle</option>
          </select>
        </FormField>
        <FormField label="Auth">
          <select
            aria-label="Cassandra auth provider"
            value={options.authProvider ?? 'password'}
            onChange={(event) =>
              updateOptions({
                authProvider: event.target.value as CassandraConnectionOptions['authProvider'],
              })
            }
          >
            <option value="password">Password</option>
            <option value="none">None</option>
            <option value="kerberos">Kerberos</option>
            <option value="secure-connect-bundle">Secure bundle</option>
          </select>
        </FormField>
      </div>

      {options.connectMode === 'secure-connect-bundle' ||
      options.authProvider === 'secure-connect-bundle' ? (
        <FormField label="Bundle">
          <input
            aria-label="Cassandra secure connect bundle path"
            value={options.secureConnectBundlePath ?? ''}
            placeholder="C:/secure-connect.zip"
            onChange={(event) =>
              updateOptions({ secureConnectBundlePath: event.target.value || undefined })
            }
          />
        </FormField>
      ) : null}

      <div className="connection-advanced-grid">
        <FormField label="Consistency">
          <select
            aria-label="Cassandra consistency level"
            value={options.consistencyLevel ?? 'local-quorum'}
            onChange={(event) =>
              updateOptions({
                consistencyLevel:
                  event.target.value as CassandraConnectionOptions['consistencyLevel'],
              })
            }
          >
            {CONSISTENCY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Load balancing">
          <select
            aria-label="Cassandra load balancing policy"
            value={options.loadBalancingPolicy ?? 'token-aware'}
            onChange={(event) =>
              updateOptions({
                loadBalancingPolicy:
                  event.target.value as CassandraConnectionOptions['loadBalancingPolicy'],
              })
            }
          >
            <option value="token-aware">Token aware</option>
            <option value="dc-aware-round-robin">DC aware</option>
            <option value="round-robin">Round robin</option>
          </select>
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Page size">
          <input
            aria-label="Cassandra page size"
            type="number"
            min={1}
            max={10000}
            value={options.pageSize ?? ''}
            onChange={(event) =>
              updateOptions({ pageSize: Number(event.target.value) || undefined })
            }
          />
        </FormField>
        <FormField label="Request ms">
          <input
            aria-label="Cassandra request timeout"
            type="number"
            min={1}
            value={options.requestTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ requestTimeoutMs: Number(event.target.value) || undefined })
            }
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
            checked={options.enableTracingDefault ?? false}
            onChange={(event) => updateOptions({ enableTracingDefault: event.target.checked })}
          />
          Trace queries
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.allowBetaProtocol ?? false}
            onChange={(event) => updateOptions({ allowBetaProtocol: event.target.checked })}
          />
          Beta protocol
        </label>
      </div>

      {options.useTls ? (
        <div className="connection-advanced-grid">
          <FormField label="CA cert">
            <input
              aria-label="Cassandra CA certificate path"
              value={options.caCertificatePath ?? ''}
              onChange={(event) =>
                updateOptions({ caCertificatePath: event.target.value || undefined })
              }
            />
          </FormField>
          <FormField label="Client cert">
            <input
              aria-label="Cassandra client certificate path"
              value={options.clientCertificatePath ?? ''}
              onChange={(event) =>
                updateOptions({ clientCertificatePath: event.target.value || undefined })
              }
            />
          </FormField>
        </div>
      ) : null}
    </div>
  )
}

const CONSISTENCY_LEVELS: Array<NonNullable<CassandraConnectionOptions['consistencyLevel']>> = [
  'one',
  'two',
  'three',
  'quorum',
  'all',
  'local-quorum',
  'each-quorum',
  'local-one',
  'serial',
  'local-serial',
]
