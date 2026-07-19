import type {
  DatastoreSecurityCheckSnapshot,
  DatastoreSecurityChecksPreferences,
  DatastoreSecurityFinding,
  DatastoreSecurityPostureCheckResult,
  DatastoreSecuritySeverity,
  DatastoreSecurityTarget,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'

export function normalizeDatastoreSecurityChecksPreferences(
  preferences: DatastoreSecurityChecksPreferences | undefined,
): DatastoreSecurityChecksPreferences {
  return {
    enabled: Boolean(preferences?.enabled),
    refreshIntervalDays: clampNumber(preferences?.refreshIntervalDays, 7, 1, 30),
    mutedFindingIds: normalizeStringList(preferences?.mutedFindingIds),
    lastRefreshAttemptAt:
      typeof preferences?.lastRefreshAttemptAt === 'string'
        ? preferences.lastRefreshAttemptAt
        : undefined,
    lastSuccessfulRefreshAt:
      typeof preferences?.lastSuccessfulRefreshAt === 'string'
        ? preferences.lastSuccessfulRefreshAt
        : undefined,
    nextManualRefreshAllowedAt:
      typeof preferences?.nextManualRefreshAllowedAt === 'string'
        ? preferences.nextManualRefreshAllowedAt
        : undefined,
  }
}

export function normalizeDatastoreSecurityCheckSnapshot(
  snapshot: WorkspaceSnapshot['datastoreSecurityChecks'] | undefined,
): DatastoreSecurityCheckSnapshot | undefined {
  if (!snapshot || typeof snapshot !== 'object') {
    return undefined
  }

  const status = ['idle', 'refreshing', 'ready', 'stale', 'error', 'unsupported'].includes(
    snapshot.status,
  )
    ? snapshot.status
    : 'idle'

  return {
    status,
    checkedAt: typeof snapshot.checkedAt === 'string' ? snapshot.checkedAt : undefined,
    expiresAt: typeof snapshot.expiresAt === 'string' ? snapshot.expiresAt : undefined,
    sourceMetadata: Array.isArray(snapshot.sourceMetadata)
      ? snapshot.sourceMetadata
          .filter((item) => item && typeof item === 'object')
          .map((item) => {
            const source: 'nvd' | 'cisa-kev' | 'version-catalog' =
              item.source === 'cisa-kev'
                ? 'cisa-kev'
                : item.source === 'version-catalog'
                  ? 'version-catalog'
                  : 'nvd'
            return {
              source,
              fetchedAt: typeof item.fetchedAt === 'string' ? item.fetchedAt : undefined,
              url: typeof item.url === 'string' ? item.url : '',
              recordCount: typeof item.recordCount === 'number' ? item.recordCount : undefined,
            }
          })
          .filter((item) => item.url)
      : [],
    targets: Array.isArray(snapshot.targets)
      ? snapshot.targets.map(normalizeDatastoreSecurityTarget)
      : [],
    findings: Array.isArray(snapshot.findings)
      ? snapshot.findings.map(normalizeDatastoreSecurityFinding)
      : [],
    postureChecks: Array.isArray(snapshot.postureChecks)
      ? snapshot.postureChecks.map(normalizeDatastoreSecurityPostureCheck)
      : [],
    warnings: normalizeStringList(snapshot.warnings),
    errors: normalizeStringList(snapshot.errors),
  }
}

function normalizeDatastoreSecurityTarget(
  target: Partial<DatastoreSecurityTarget>,
  index: number,
): DatastoreSecurityTarget {
  const status = [
    'pending',
    'checked',
    'notApplicable',
    'versionUnavailable',
    'mappingUnavailable',
    'error',
  ].includes(target.status ?? '')
    ? target.status
    : 'pending'
  const normalizedStatus = status as DatastoreSecurityTarget['status']

  return {
    id: typeof target.id === 'string' && target.id ? target.id : `security-target-${index + 1}`,
    connectionId: typeof target.connectionId === 'string' ? target.connectionId : '',
    environmentId: typeof target.environmentId === 'string' ? target.environmentId : '',
    connectionName: typeof target.connectionName === 'string' ? target.connectionName : 'Datastore',
    environmentName:
      typeof target.environmentName === 'string' ? target.environmentName : 'Environment',
    engine: typeof target.engine === 'string' ? target.engine : 'unknown',
    family: typeof target.family === 'string' ? target.family : 'unknown',
    status: normalizedStatus,
    detectedProduct:
      typeof target.detectedProduct === 'string' ? target.detectedProduct : undefined,
    detectedVersion:
      typeof target.detectedVersion === 'string' ? target.detectedVersion : undefined,
    knownLatestVersion:
      typeof target.knownLatestVersion === 'string' ? target.knownLatestVersion : undefined,
    recommendedVersion:
      typeof target.recommendedVersion === 'string' ? target.recommendedVersion : undefined,
    versionStatus: normalizeDatastoreVersionStatus(target.versionStatus),
    versionSource: normalizeDatastoreVersionSource(target.versionSource),
    versionSourceLabel:
      typeof target.versionSourceLabel === 'string' ? target.versionSourceLabel : undefined,
    versionSourceUrl:
      typeof target.versionSourceUrl === 'string' ? target.versionSourceUrl : undefined,
    versionSourceUpdatedAt:
      typeof target.versionSourceUpdatedAt === 'string' ? target.versionSourceUpdatedAt : undefined,
    cpeCandidates: Array.isArray(target.cpeCandidates)
      ? target.cpeCandidates
          .filter((candidate) => candidate && typeof candidate.cpeName === 'string')
          .map((candidate) => ({
            cpeName: candidate.cpeName,
            source: candidate.source === 'nvd' ? 'nvd' : 'curated',
            confidence:
              candidate.confidence === 'product' ||
              candidate.confidence === 'version-normalized'
                ? candidate.confidence
                : 'exact',
          }))
      : [],
    findingCount:
      typeof target.findingCount === 'number' && Number.isFinite(target.findingCount)
        ? Math.max(0, Math.floor(target.findingCount))
        : 0,
    highestSeverity: normalizeDatastoreSecuritySeverity(target.highestSeverity),
    lastCheckedAt: typeof target.lastCheckedAt === 'string' ? target.lastCheckedAt : undefined,
    message: typeof target.message === 'string' ? target.message : undefined,
    warnings: normalizeStringList(target.warnings),
  }
}

function normalizeDatastoreSecurityFinding(
  finding: Partial<DatastoreSecurityFinding>,
  index: number,
): DatastoreSecurityFinding {
  const cveId =
    typeof finding.cveId === 'string' && finding.cveId.trim()
      ? finding.cveId.trim()
      : `CVE-UNKNOWN-${index + 1}`
  return {
    id: typeof finding.id === 'string' && finding.id ? finding.id : cveId,
    targetIds: normalizeStringList(finding.targetIds),
    cveId,
    title: typeof finding.title === 'string' && finding.title ? finding.title : cveId,
    summary: typeof finding.summary === 'string' ? finding.summary : '',
    severity: normalizeDatastoreSecuritySeverity(finding.severity) ?? 'UNKNOWN',
    cvssScore:
      typeof finding.cvssScore === 'number' && Number.isFinite(finding.cvssScore)
        ? finding.cvssScore
        : undefined,
    cvssVector: typeof finding.cvssVector === 'string' ? finding.cvssVector : undefined,
    publishedAt: typeof finding.publishedAt === 'string' ? finding.publishedAt : undefined,
    modifiedAt: typeof finding.modifiedAt === 'string' ? finding.modifiedAt : undefined,
    affectedProduct:
      typeof finding.affectedProduct === 'string' ? finding.affectedProduct : 'Datastore',
    affectedVersion:
      typeof finding.affectedVersion === 'string' ? finding.affectedVersion : undefined,
    affectedVersionRange:
      typeof finding.affectedVersionRange === 'string'
        ? finding.affectedVersionRange
        : undefined,
    fixedVersionHint:
      typeof finding.fixedVersionHint === 'string' ? finding.fixedVersionHint : undefined,
    remediation:
      typeof finding.remediation === 'string' && finding.remediation.trim()
        ? finding.remediation
        : 'Review vendor guidance and apply a supported patched version.',
    references: Array.isArray(finding.references)
      ? finding.references
          .filter((reference) => reference && typeof reference.url === 'string')
          .map((reference) => ({
            label:
              typeof reference.label === 'string' && reference.label
                ? reference.label
                : reference.url,
            url: reference.url,
            source: typeof reference.source === 'string' ? reference.source : undefined,
          }))
      : [],
    cwes: normalizeStringList(finding.cwes),
    knownExploited: Boolean(finding.knownExploited),
    kev: finding.kev,
    sourceUrls: normalizeStringList(finding.sourceUrls),
  }
}

function normalizeDatastoreSecurityPostureCheck(
  check: Partial<DatastoreSecurityPostureCheckResult>,
  index: number,
): DatastoreSecurityPostureCheckResult {
  const ruleId =
    typeof check.ruleId === 'string' && check.ruleId.trim()
      ? check.ruleId.trim()
      : `posture.unknown.${index + 1}`
  return {
    id:
      typeof check.id === 'string' && check.id
        ? check.id
        : `posture-${ruleId.replace(/[^a-z0-9]+/gi, '-')}`,
    targetIds: normalizeStringList(check.targetIds),
    ruleId,
    category: normalizeDatastoreSecurityPostureCategory(check.category),
    status: normalizeDatastoreSecurityPostureStatus(check.status),
    severity: normalizeDatastoreSecuritySeverity(check.severity) ?? 'UNKNOWN',
    title: typeof check.title === 'string' && check.title ? check.title : ruleId,
    summary: typeof check.summary === 'string' ? check.summary : '',
    evidence: typeof check.evidence === 'string' ? check.evidence : undefined,
    remediation:
      typeof check.remediation === 'string' && check.remediation.trim()
        ? check.remediation
        : 'Review the datastore posture and apply least-privilege, authenticated, encrypted defaults where practical.',
    source: check.source === 'read-only-probe' ? 'read-only-probe' : 'profile',
    references: Array.isArray(check.references)
      ? check.references
          .filter((reference) => reference && typeof reference.url === 'string')
          .map((reference) => ({
            label:
              typeof reference.label === 'string' && reference.label
                ? reference.label
                : reference.url,
            url: reference.url,
            source: typeof reference.source === 'string' ? reference.source : undefined,
          }))
      : [],
  }
}

function normalizeDatastoreSecuritySeverity(
  severity: unknown,
): DatastoreSecuritySeverity | undefined {
  return severity === 'CRITICAL' ||
    severity === 'HIGH' ||
    severity === 'MEDIUM' ||
    severity === 'LOW' ||
    severity === 'NONE' ||
    severity === 'UNKNOWN'
    ? severity
    : undefined
}

function normalizeDatastoreVersionStatus(status: unknown) {
  return status === 'current' ||
    status === 'updateAvailable' ||
    status === 'unsupported' ||
    status === 'unknown'
    ? status
    : undefined
}

function normalizeDatastoreVersionSource(source: unknown) {
  return source === 'bundled-catalog' ||
    source === 'nvd-range' ||
    source === 'datastore-local'
    ? source
    : undefined
}

function normalizeDatastoreSecurityPostureStatus(status: unknown) {
  return status === 'pass' ||
    status === 'warn' ||
    status === 'fail' ||
    status === 'unknown' ||
    status === 'notApplicable'
    ? status
    : 'unknown'
}

function normalizeDatastoreSecurityPostureCategory(category: unknown) {
  return category === 'transport' ||
    category === 'auth' ||
    category === 'environment' ||
    category === 'secrets' ||
    category === 'privileges' ||
    category === 'durability' ||
    category === 'risky-settings' ||
    category === 'cloud' ||
    category === 'local-file'
    ? category
    : 'environment'
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

function normalizeStringList(values: unknown): string[] {
  return Array.isArray(values)
    ? [...new Set(values.filter((value): value is string => typeof value === 'string'))]
    : []
}
