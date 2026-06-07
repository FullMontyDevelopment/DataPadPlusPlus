import type { ConnectionProfile, PostgresConnectionOptions } from '@datapadplusplus/shared-types'

export type CockroachCapabilityKey = keyof NonNullable<
  PostgresConnectionOptions['cockroachCapabilities']
>

const CAPABILITY_WARNINGS: Record<CockroachCapabilityKey, string> = {
  inspectJobs:
    'CockroachDB job metadata is hidden because this profile has not enabled job inspection.',
  inspectRanges:
    'CockroachDB range metadata is hidden because this profile has not enabled crdb_internal range inspection.',
  inspectRegions:
    'CockroachDB region and locality metadata is hidden because this profile has not enabled region inspection.',
  inspectClusterStatus:
    'CockroachDB node and cluster-status metadata is hidden because this profile has not enabled cluster-status inspection.',
  inspectClusterSettings:
    'CockroachDB cluster settings are hidden because this profile has not enabled cluster-setting inspection.',
  inspectSessions:
    'CockroachDB session metadata is hidden because this profile has not enabled session inspection.',
  inspectContention:
    'CockroachDB contention, lock, transaction, and statement-stat metadata is hidden because this profile has not enabled contention inspection.',
  inspectRolesAndGrants:
    'CockroachDB roles and grants are hidden because this profile has not enabled role/grant inspection.',
  inspectCertificates:
    'CockroachDB certificate metadata is hidden because this profile has not enabled certificate inspection.',
  inspectZoneConfigurations:
    'CockroachDB zone configurations are hidden because this profile has not enabled zone-configuration inspection.',
  explainAnalyze:
    'CockroachDB EXPLAIN ANALYZE is hidden because this profile has not enabled live distributed profile collection.',
}

export function cockroachCapability(
  connection: ConnectionProfile,
  key: CockroachCapabilityKey,
): boolean {
  if (connection.engine !== 'cockroachdb') {
    return true
  }
  return connection.postgresOptions?.cockroachCapabilities?.[key] !== false
}

export function cockroachCapabilityWarning(
  connection: ConnectionProfile,
  key: CockroachCapabilityKey,
): string | undefined {
  return cockroachCapability(connection, key) ? undefined : CAPABILITY_WARNINGS[key]
}

export function cockroachCapabilityWarnings(
  connection: ConnectionProfile,
  keys: CockroachCapabilityKey[],
): string[] {
  return keys
    .map((key) => cockroachCapabilityWarning(connection, key))
    .filter((warning): warning is string => Boolean(warning))
}
