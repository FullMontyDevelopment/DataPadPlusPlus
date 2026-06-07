import type { ConnectionProfile, PostgresConnectionOptions } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

type CapabilityKey = keyof NonNullable<PostgresConnectionOptions['cockroachCapabilities']>

const COCKROACH_CAPABILITIES: Array<{ key: CapabilityKey; label: string }> = [
  { key: 'inspectJobs', label: 'Jobs' },
  { key: 'inspectRanges', label: 'Ranges' },
  { key: 'inspectRegions', label: 'Regions' },
  { key: 'inspectClusterStatus', label: 'Cluster status' },
  { key: 'inspectClusterSettings', label: 'Cluster settings' },
  { key: 'inspectSessions', label: 'Sessions' },
  { key: 'inspectContention', label: 'Contention' },
  { key: 'inspectRolesAndGrants', label: 'Roles / grants' },
  { key: 'inspectCertificates', label: 'Certificates' },
  { key: 'inspectZoneConfigurations', label: 'Zone configs' },
  { key: 'explainAnalyze', label: 'EXPLAIN ANALYZE' },
]

export function CockroachProfileFields({
  connectionDraft,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.postgresOptions ?? {}
  const capabilities = options.cockroachCapabilities ?? {}
  const updateOptions = (patch: Partial<PostgresConnectionOptions>) =>
    onUpdateConnectionDraft({
      postgresOptions: {
        ...options,
        ...patch,
      },
    })
  const updateCapability = (key: CapabilityKey, value: boolean) =>
    updateOptions({
      cockroachCapabilities: {
        ...capabilities,
        [key]: value,
      },
    })

  return (
    <div className="connection-advanced-section" aria-label="CockroachDB profile options">
      <strong>CockroachDB profile</strong>

      <FormField label="Deployment mode">
        <select
          aria-label="CockroachDB deployment mode"
          value={options.cockroachDeploymentMode ?? 'self-hosted'}
          onChange={(event) =>
            updateOptions({
              cockroachDeploymentMode: event.target
                .value as PostgresConnectionOptions['cockroachDeploymentMode'],
            })
          }
        >
          <option value="local-single-node">Local single-node</option>
          <option value="self-hosted">Self-hosted cluster</option>
          <option value="cockroach-cloud-dedicated">Cockroach Cloud dedicated</option>
          <option value="cockroach-cloud-serverless">Cockroach Cloud serverless</option>
        </select>
      </FormField>

      <div className="connection-advanced-grid">
        <FormField label="Organization">
          <input
            aria-label="CockroachDB organization"
            value={options.cockroachOrganization ?? ''}
            onChange={(event) =>
              updateOptions({ cockroachOrganization: event.target.value || undefined })
            }
          />
        </FormField>
        <FormField label="Cluster name">
          <input
            aria-label="CockroachDB cluster name"
            value={options.cockroachClusterName ?? ''}
            onChange={(event) =>
              updateOptions({ cockroachClusterName: event.target.value || undefined })
            }
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Cluster id">
          <input
            aria-label="CockroachDB cluster id"
            value={options.cockroachClusterId ?? ''}
            onChange={(event) =>
              updateOptions({ cockroachClusterId: event.target.value || undefined })
            }
          />
        </FormField>
        <FormField label="Cloud region">
          <input
            aria-label="CockroachDB cloud region"
            value={options.cockroachCloudRegion ?? ''}
            placeholder="aws-us-east-1"
            onChange={(event) =>
              updateOptions({ cockroachCloudRegion: event.target.value || undefined })
            }
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Default region">
          <input
            aria-label="CockroachDB default region"
            value={options.cockroachDefaultRegion ?? ''}
            placeholder="us-east"
            onChange={(event) =>
              updateOptions({ cockroachDefaultRegion: event.target.value || undefined })
            }
          />
        </FormField>
        <FormField label="Locality">
          <input
            aria-label="CockroachDB locality"
            value={options.cockroachLocality ?? ''}
            placeholder="region=us-east,az=a"
            onChange={(event) =>
              updateOptions({ cockroachLocality: event.target.value || undefined })
            }
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Server version">
          <input
            aria-label="CockroachDB server version"
            value={options.cockroachServerVersion ?? ''}
            placeholder="v24.3"
            onChange={(event) =>
              updateOptions({ cockroachServerVersion: event.target.value || undefined })
            }
          />
        </FormField>
        <FormField label="Build tag">
          <input
            aria-label="CockroachDB build tag"
            value={options.cockroachBuildTag ?? ''}
            placeholder="v24.3.5"
            onChange={(event) =>
              updateOptions({ cockroachBuildTag: event.target.value || undefined })
            }
          />
        </FormField>
      </div>

      <FormField label="Auth disabled reason">
        <input
          aria-label="CockroachDB auth disabled reason"
          value={options.cockroachAuthDisabledReason ?? ''}
          onChange={(event) =>
            updateOptions({ cockroachAuthDisabledReason: event.target.value || undefined })
          }
        />
      </FormField>

      <FormField label="TLS disabled reason">
        <input
          aria-label="CockroachDB TLS disabled reason"
          value={options.cockroachTlsDisabledReason ?? ''}
          onChange={(event) =>
            updateOptions({ cockroachTlsDisabledReason: event.target.value || undefined })
          }
        />
      </FormField>

      <div className="drawer-checkbox-grid">
        {COCKROACH_CAPABILITIES.map((capability) => (
          <label key={capability.key}>
            <input
              type="checkbox"
              checked={capabilities[capability.key] ?? true}
              onChange={(event) => updateCapability(capability.key, event.target.checked)}
            />
            {capability.label}
          </label>
        ))}
      </div>
    </div>
  )
}
