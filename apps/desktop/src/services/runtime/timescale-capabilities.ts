import type { ConnectionProfile, PostgresConnectionOptions } from '@datapadplusplus/shared-types'

export type TimescaleCapabilityKey = keyof NonNullable<
  PostgresConnectionOptions['timescaleCapabilities']
>

const CAPABILITY_WARNINGS: Record<TimescaleCapabilityKey, string> = {
  inspectHypertables:
    'TimescaleDB hypertable metadata is hidden because this profile has not enabled hypertable inspection.',
  inspectChunks:
    'TimescaleDB chunk metadata is hidden because this profile has not enabled chunk inspection.',
  inspectCompression:
    'TimescaleDB compression metadata is hidden because this profile has not enabled compression inspection.',
  inspectRetention:
    'TimescaleDB retention metadata is hidden because this profile has not enabled retention inspection.',
  inspectContinuousAggregates:
    'TimescaleDB continuous aggregate metadata is hidden because this profile has not enabled aggregate inspection.',
  inspectJobs:
    'TimescaleDB job metadata is hidden because this profile has not enabled job inspection.',
  inspectToolkit:
    'TimescaleDB Toolkit metadata is hidden because this profile has not enabled Toolkit inspection.',
  explainAnalyze:
    'TimescaleDB EXPLAIN ANALYZE is hidden because this profile has not enabled live profile collection.',
  livePolicyExecution:
    'TimescaleDB live policy execution is disabled; policy, retention, and refresh actions stay preview-first.',
}

export function timescaleCapability(
  connection: ConnectionProfile,
  key: TimescaleCapabilityKey,
): boolean {
  if (connection.engine !== 'timescaledb') {
    return true
  }
  const value = connection.postgresOptions?.timescaleCapabilities?.[key]
  if (value !== undefined) {
    return value
  }
  return key !== 'livePolicyExecution'
}

export function timescaleCapabilityWarning(
  connection: ConnectionProfile,
  key: TimescaleCapabilityKey,
): string | undefined {
  return timescaleCapability(connection, key) ? undefined : CAPABILITY_WARNINGS[key]
}

export function timescaleCapabilityWarnings(
  connection: ConnectionProfile,
  keys: TimescaleCapabilityKey[],
): string[] {
  return keys
    .map((key) => timescaleCapabilityWarning(connection, key))
    .filter((warning): warning is string => Boolean(warning))
}

export function timescalePolicyDisabledReason(
  connection: ConnectionProfile,
  kind: 'compression' | 'retention' | 'aggregate',
): string {
  const options = connection.postgresOptions
  const specific =
    kind === 'compression'
      ? options?.timescaleCompressionDisabledReason
      : kind === 'retention'
        ? options?.timescaleRetentionDisabledReason
        : options?.timescaleContinuousAggregateDisabledReason
  return (
    specific ||
    options?.timescalePolicyExecutionDisabledReason ||
    timescaleCapabilityWarning(connection, 'livePolicyExecution') ||
    'TimescaleDB policy and refresh execution is guarded and adapter-specific.'
  )
}
