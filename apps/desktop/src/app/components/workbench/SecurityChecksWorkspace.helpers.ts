import type {
  DatastoreSecurityFinding,
  DatastoreSecurityPostureCheckResult,
  DatastoreSecurityPostureStatus,
  DatastoreSecuritySeverity,
  DatastoreSecurityTarget,
} from '@datapadplusplus/shared-types'

export const SEVERITIES: DatastoreSecuritySeverity[] = [
  'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE', 'UNKNOWN',
]
export const POSTURE_STATUSES: DatastoreSecurityPostureStatus[] = [
  'fail', 'warn', 'unknown', 'pass', 'notApplicable',
]

export function highestFindingSeverity(findings: DatastoreSecurityFinding[]) {
  let highest: DatastoreSecuritySeverity | undefined
  for (const finding of findings) {
    if (!highest || severityRank(finding.severity) < severityRank(highest)) highest = finding.severity
  }
  return highest
}

export function highestPostureSeverityForChecks(checks: DatastoreSecurityPostureCheckResult[]) {
  let highest: DatastoreSecuritySeverity | undefined
  for (const check of checks) {
    if (check.status === 'pass' || check.status === 'notApplicable') continue
    if (!highest || severityRank(check.severity) < severityRank(highest)) highest = check.severity
  }
  return highest
}

export function severityRank(severity: DatastoreSecuritySeverity) {
  const index = SEVERITIES.indexOf(severity)
  return index === -1 ? SEVERITIES.length : index
}

export function postureStatusRank(status: DatastoreSecurityPostureStatus) {
  const index = POSTURE_STATUSES.indexOf(status)
  return index === -1 ? POSTURE_STATUSES.length : index
}

export function nextManualRefreshMs(value: string | undefined, now: number) {
  const next = timestampToMs(value)
  return next && next > now ? next - now : 0
}

export function versionGuidanceLabel(target: DatastoreSecurityTarget) {
  if (target.versionStatus === 'unsupported') {
    return target.recommendedVersion ? `Unsupported. Upgrade to ${target.recommendedVersion}` : 'Unsupported version'
  }
  if (target.versionStatus === 'updateAvailable') {
    return target.recommendedVersion ? `Recommended: ${target.recommendedVersion}` : 'Update available'
  }
  if (target.versionStatus === 'current') return 'No known newer version'
  return target.message ?? titleCase(target.status)
}

export function versionGuidanceTooltip(target: DatastoreSecurityTarget) {
  const guidance = versionGuidanceLabel(target)
  const lines = [
    guidance,
    target.detectedVersion ? `Detected: ${target.detectedVersion}` : undefined,
    target.knownLatestVersion ? `Known newer: ${target.knownLatestVersion}` : undefined,
    target.recommendedVersion ? `Recommended: ${target.recommendedVersion}` : undefined,
    target.versionStatus ? `Version status: ${titleCase(target.versionStatus)}` : undefined,
    target.versionSourceLabel ? `Source: ${target.versionSourceLabel}` : undefined,
    target.versionSourceUpdatedAt ? `Catalog updated: ${formatDate(target.versionSourceUpdatedAt)}` : undefined,
    target.message && target.message !== guidance ? `Scan status: ${target.message}` : undefined,
  ].filter((line): line is string => Boolean(line))
  return Array.from(new Set(lines)).join('\n')
}

export function formatDate(value: string | undefined) {
  const ms = timestampToMs(value)
  return ms ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(ms)) : 'Unknown'
}

export function formatTimestamp(value: string | undefined) {
  const ms = timestampToMs(value)
  return ms
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
    : 'Never'
}

function timestampToMs(value: string | undefined) {
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

export function titleCase(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
