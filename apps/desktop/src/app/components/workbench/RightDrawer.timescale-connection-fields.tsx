import type { ConnectionProfile, PostgresConnectionOptions } from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

type CapabilityKey = keyof NonNullable<PostgresConnectionOptions['timescaleCapabilities']>

const TIMESCALE_CAPABILITIES: Array<{ key: CapabilityKey; label: string; defaultValue?: boolean }> = [
  { key: 'inspectHypertables', label: 'Hypertables' },
  { key: 'inspectChunks', label: 'Chunks' },
  { key: 'inspectCompression', label: 'Compression' },
  { key: 'inspectRetention', label: 'Retention' },
  { key: 'inspectContinuousAggregates', label: 'Aggregates' },
  { key: 'inspectJobs', label: 'Jobs' },
  { key: 'inspectToolkit', label: 'Toolkit' },
  { key: 'explainAnalyze', label: 'EXPLAIN ANALYZE' },
  { key: 'livePolicyExecution', label: 'Live policy execution', defaultValue: false },
]

export function TimescaleProfileFields({
  connectionDraft,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.postgresOptions ?? {}
  const capabilities = options.timescaleCapabilities ?? {}
  const updateOptions = (patch: Partial<PostgresConnectionOptions>) =>
    onUpdateConnectionDraft({
      postgresOptions: {
        ...options,
        ...patch,
      },
    })
  const updateCapability = (key: CapabilityKey, value: boolean) =>
    updateOptions({
      timescaleCapabilities: {
        ...capabilities,
        [key]: value,
      },
    })

  return (
    <div className="connection-advanced-section" aria-label="TimescaleDB profile options">
      <strong>TimescaleDB profile</strong>

      <FormField label="Deployment mode">
        <select
          aria-label="TimescaleDB deployment mode"
          value={options.timescaleDeploymentMode ?? 'self-hosted'}
          onChange={(event) =>
            updateOptions({
              timescaleDeploymentMode: event.target
                .value as PostgresConnectionOptions['timescaleDeploymentMode'],
            })
          }
        >
          <option value="local-dev">Local development</option>
          <option value="self-hosted">Self-hosted TimescaleDB</option>
          <option value="managed-postgres">Managed PostgreSQL with extension</option>
          <option value="timescale-cloud">Timescale Cloud</option>
          <option value="postgres-wire">PostgreSQL wire compatibility only</option>
        </select>
      </FormField>

      <div className="connection-advanced-grid">
        <FormField label="Project">
          <input
            aria-label="TimescaleDB project"
            value={options.timescaleProject ?? ''}
            onChange={(event) => updateOptions({ timescaleProject: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="Service id">
          <input
            aria-label="TimescaleDB service id"
            value={options.timescaleServiceId ?? ''}
            onChange={(event) => updateOptions({ timescaleServiceId: event.target.value || undefined })}
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Region">
          <input
            aria-label="TimescaleDB region"
            value={options.timescaleRegion ?? ''}
            placeholder="aws-us-east-1"
            onChange={(event) => updateOptions({ timescaleRegion: event.target.value || undefined })}
          />
        </FormField>
        <FormField label="License">
          <select
            aria-label="TimescaleDB license"
            value={options.timescaleLicense ?? 'unknown'}
            onChange={(event) =>
              updateOptions({
                timescaleLicense: event.target.value as PostgresConnectionOptions['timescaleLicense'],
              })
            }
          >
            <option value="unknown">Unknown</option>
            <option value="apache">Apache-only</option>
            <option value="community">Community</option>
            <option value="timescale">Timescale</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Extension schema">
          <input
            aria-label="TimescaleDB extension schema"
            value={options.timescaleExtensionSchema ?? ''}
            placeholder="public"
            onChange={(event) =>
              updateOptions({ timescaleExtensionSchema: event.target.value || undefined })
            }
          />
        </FormField>
        <FormField label="Extension version">
          <input
            aria-label="TimescaleDB extension version"
            value={options.timescaleExtensionVersion ?? ''}
            placeholder="2.15.0"
            onChange={(event) =>
              updateOptions({ timescaleExtensionVersion: event.target.value || undefined })
            }
          />
        </FormField>
      </div>

      <FormField label="Server version">
        <input
          aria-label="TimescaleDB server version"
          value={options.timescaleServerVersion ?? ''}
          placeholder="PostgreSQL 16 / Timescale Cloud"
          onChange={(event) =>
            updateOptions({ timescaleServerVersion: event.target.value || undefined })
          }
        />
      </FormField>

      <FormField label="Policy execution disabled reason">
        <input
          aria-label="TimescaleDB policy execution disabled reason"
          value={options.timescalePolicyExecutionDisabledReason ?? ''}
          onChange={(event) =>
            updateOptions({
              timescalePolicyExecutionDisabledReason: event.target.value || undefined,
            })
          }
        />
      </FormField>

      <div className="connection-advanced-grid">
        <FormField label="Compression disabled reason">
          <input
            aria-label="TimescaleDB compression disabled reason"
            value={options.timescaleCompressionDisabledReason ?? ''}
            onChange={(event) =>
              updateOptions({ timescaleCompressionDisabledReason: event.target.value || undefined })
            }
          />
        </FormField>
        <FormField label="Retention disabled reason">
          <input
            aria-label="TimescaleDB retention disabled reason"
            value={options.timescaleRetentionDisabledReason ?? ''}
            onChange={(event) =>
              updateOptions({ timescaleRetentionDisabledReason: event.target.value || undefined })
            }
          />
        </FormField>
      </div>

      <FormField label="Aggregate disabled reason">
        <input
          aria-label="TimescaleDB continuous aggregate disabled reason"
          value={options.timescaleContinuousAggregateDisabledReason ?? ''}
          onChange={(event) =>
            updateOptions({
              timescaleContinuousAggregateDisabledReason: event.target.value || undefined,
            })
          }
        />
      </FormField>

      <div className="drawer-checkbox-grid">
        {TIMESCALE_CAPABILITIES.map((capability) => (
          <label key={capability.key}>
            <input
              type="checkbox"
              checked={capabilities[capability.key] ?? capability.defaultValue ?? true}
              onChange={(event) => updateCapability(capability.key, event.target.checked)}
            />
            {capability.label}
          </label>
        ))}
      </div>
    </div>
  )
}
