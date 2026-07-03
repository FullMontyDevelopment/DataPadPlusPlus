import { useEffect, useMemo, useState } from 'react'
import type {
  DatastoreSecurityCheckSnapshot,
  DatastoreSecurityChecksRefreshRequest,
  DatastoreSecurityFinding,
  DatastoreSecurityTarget,
  DatastoreSecuritySeverity,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  ObjectSecurityIcon,
  RefreshIcon,
  WarningIcon,
} from './icons'

interface SecurityChecksWorkspaceProps {
  enabled: boolean
  snapshot: WorkspaceSnapshot
  onOpenExperimentalSettings(): void
  onMutedFindingIdsChange?(mutedFindingIds: string[]): Promise<boolean>
  onRefresh(request?: DatastoreSecurityChecksRefreshRequest): Promise<boolean>
}

const SEVERITIES: DatastoreSecuritySeverity[] = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'NONE',
  'UNKNOWN',
]

const EMPTY_MUTED_FINDING_IDS: string[] = []

export function SecurityChecksWorkspace({
  enabled,
  snapshot,
  onOpenExperimentalSettings,
  onMutedFindingIdsChange,
  onRefresh,
}: SecurityChecksWorkspaceProps) {
  const [selectedFindingId, setSelectedFindingId] = useState<string>()
  const [expandedTargetIds, setExpandedTargetIds] = useState<Record<string, boolean>>({})
  const [showMutedFindings, setShowMutedFindings] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const preferences = snapshot.preferences.datastoreSecurityChecks ?? {
    enabled: false,
    refreshIntervalDays: 7,
  }
  const securitySnapshot = snapshot.datastoreSecurityChecks
  const selectedFinding = securitySnapshot?.findings.find((finding) => finding.id === selectedFindingId)
  const mutedFindingIds = preferences.mutedFindingIds ?? EMPTY_MUTED_FINDING_IDS
  const mutedFindingIdSet = useMemo(
    () => new Set(mutedFindingIds),
    [mutedFindingIds],
  )
  const mutedFindingCount = securitySnapshot?.findings.filter((finding) =>
    mutedFindingIdSet.has(finding.id),
  ).length ?? 0
  const cooldownMs = nextManualRefreshMs(preferences.nextManualRefreshAllowedAt, now)
  const refreshDisabled = refreshing || cooldownMs > 0 || !enabled
  const findingsByTargetId = useMemo(
    () => groupFindingsByTargetId(securitySnapshot, mutedFindingIdSet, showMutedFindings),
    [mutedFindingIdSet, securitySnapshot, showMutedFindings],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (
      selectedFindingId && (
        !securitySnapshot?.findings.some((finding) => finding.id === selectedFindingId) ||
        (!showMutedFindings && mutedFindingIdSet.has(selectedFindingId))
      )
    ) {
      setSelectedFindingId(undefined)
    }
  }, [mutedFindingIdSet, securitySnapshot?.findings, selectedFindingId, showMutedFindings])

  const counts = useMemo(
    () => securitySummaryCounts(securitySnapshot, mutedFindingIdSet),
    [mutedFindingIdSet, securitySnapshot],
  )

  const refresh = async () => {
    setRefreshing(true)
    await onRefresh({ manual: true })
    setRefreshing(false)
  }

  const updateFindingMute = async (findingId: string, muted: boolean) => {
    const nextMutedFindingIds = muted
      ? Array.from(new Set([...mutedFindingIds, findingId])).sort()
      : mutedFindingIds.filter((item) => item !== findingId)
    const saved = await onMutedFindingIdsChange?.(nextMutedFindingIds)

    if (saved && muted) {
      setSelectedFindingId(undefined)
      setShowMutedFindings(false)
    }
  }

  if (!enabled) {
    return (
      <section className="environment-workspace security-checks-workspace" aria-label="Security Checks">
        <div className="security-checks-empty">
          <ObjectSecurityIcon className="empty-icon" />
          <h2>Datastore Security Checks is experimental</h2>
          <p>Enable it in Experimental settings to scan datastore product versions against official vulnerability sources.</p>
          <button type="button" className="drawer-button drawer-button--primary" onClick={onOpenExperimentalSettings}>
            Open Experimental Settings
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="environment-workspace security-checks-workspace" aria-label="Security Checks">
      <header className="security-checks-header">
        <div>
          <span className="sidebar-eyebrow">Experimental</span>
          <h1>Security Checks</h1>
        </div>
        <div className="security-checks-header-actions">
          <span className="security-checks-muted">
            Updated weekly
          </span>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            disabled={refreshDisabled}
            onClick={() => void refresh()}
          >
            <RefreshIcon className="panel-inline-icon" />
            {refreshing ? 'Refreshing' : cooldownMs > 0 ? `Refresh in ${Math.ceil(cooldownMs / 1000)}s` : 'Refresh'}
          </button>
        </div>
      </header>

      <div className="security-checks-summary">
        {SEVERITIES.slice(0, 4).map((severity) => (
          <div key={severity} className={`security-checks-summary-card severity-${severity.toLowerCase()}`}>
            <span>{severity}</span>
            <strong>{counts.bySeverity[severity] ?? 0}</strong>
          </div>
        ))}
        <div className="security-checks-summary-card">
          <span>CISA KEV</span>
          <strong>{counts.kev}</strong>
        </div>
        <div className="security-checks-summary-card">
          <span>Needs Attention</span>
          <strong>{counts.needsAttention}</strong>
        </div>
      </div>

      {securitySnapshot ? (
        <div className="security-checks-meta">
          <span>Status: {titleCase(securitySnapshot.status)}</span>
          <span>Checked: {formatTimestamp(securitySnapshot.checkedAt)}</span>
          <span>Expires: {formatTimestamp(securitySnapshot.expiresAt)}</span>
        </div>
      ) : (
        <div className="security-checks-callout">
          <WarningIcon className="panel-inline-icon" />
          <span>No cached scan exists yet. Refresh to scan saved datastore connections.</span>
        </div>
      )}

      {(securitySnapshot?.warnings.length || securitySnapshot?.errors.length) ? (
        <div className="security-checks-notices">
          {securitySnapshot.errors.map((error) => (
            <p key={`error-${error}`} className="security-checks-error">{error}</p>
          ))}
          {securitySnapshot.warnings.map((warning) => (
            <p key={`warning-${warning}`}>{warning}</p>
          ))}
        </div>
      ) : null}

      <div className={`security-checks-grid${selectedFinding ? ' has-detail' : ''}`}>
        <section className="security-checks-panel security-checks-connections-panel">
          <header>
            <h2>Connections</h2>
            <div className="security-checks-panel-header-actions">
              <span>{securitySnapshot?.targets.length ?? 0}</span>
              {mutedFindingCount > 0 ? (
                <button
                  type="button"
                  className="drawer-button drawer-button--compact"
                  aria-pressed={showMutedFindings}
                  onClick={() => setShowMutedFindings((current) => !current)}
                >
                  {showMutedFindings ? 'Hide Muted' : `Show Muted (${mutedFindingCount})`}
                </button>
              ) : null}
            </div>
          </header>
          <div className="security-checks-table security-checks-connections" role="table" aria-label="Security check connections and findings">
            <div role="row" className="security-checks-table-head">
              <span>Connection</span>
              <span>Environment</span>
              <span>Version</span>
              <span>Status</span>
              <span>Findings</span>
            </div>
            {(securitySnapshot?.targets ?? []).map((target) => {
              const findings = findingsByTargetId.get(target.id) ?? []
              const expanded = expandedTargetIds[target.id] ?? findings.length > 0
              return (
                <SecurityConnectionRows
                  key={target.id}
                  expanded={expanded}
                  findings={findings}
                  mutedFindingIds={mutedFindingIdSet}
                  selectedFindingId={selectedFinding?.id}
                  target={target}
                  onSelectFinding={setSelectedFindingId}
                  onToggle={() =>
                    setExpandedTargetIds((current) => ({
                      ...current,
                      [target.id]: !expanded,
                    }))
                  }
                />
              )
            })}
            {!securitySnapshot?.targets.length ? (
              <div className="security-checks-empty-row">No targets scanned yet.</div>
            ) : null}
          </div>
        </section>

        {selectedFinding ? (
          <FindingDetail
            finding={selectedFinding}
            muted={mutedFindingIdSet.has(selectedFinding.id)}
            onClose={() => setSelectedFindingId(undefined)}
            onMute={() => void updateFindingMute(selectedFinding.id, true)}
            onUnmute={() => void updateFindingMute(selectedFinding.id, false)}
          />
        ) : null}
      </div>
    </section>
  )
}

function SecurityConnectionRows({
  expanded,
  findings,
  mutedFindingIds,
  selectedFindingId,
  target,
  onSelectFinding,
  onToggle,
}: {
  expanded: boolean
  findings: DatastoreSecurityFinding[]
  mutedFindingIds: Set<string>
  selectedFindingId?: string
  target: DatastoreSecurityTarget
  onSelectFinding(findingId: string): void
  onToggle(): void
}) {
  const findingsId = `security-findings-${target.id}`
  const highestSeverity = highestFindingSeverity(findings)

  return (
    <>
      <div role="row" className="security-checks-table-row security-checks-connection-row">
        <span>
          <button
            type="button"
            className="security-checks-target-toggle"
            disabled={!findings.length}
            aria-expanded={findings.length ? expanded : undefined}
            aria-controls={findings.length ? findingsId : undefined}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} findings for ${target.connectionName}`}
            onClick={onToggle}
          >
            {findings.length ? (
              expanded ? (
                <ChevronDownIcon className="panel-inline-icon" />
              ) : (
                <ChevronRightIcon className="panel-inline-icon" />
              )
            ) : (
              <span className="security-checks-toggle-spacer" />
            )}
            <span>
              <strong>{target.connectionName}</strong>
              <small>{target.engine} / {target.family}</small>
            </span>
          </button>
        </span>
        <span>{target.environmentName}</span>
        <span>{target.detectedVersion ?? 'Unavailable'}</span>
        <span>{target.message ?? titleCase(target.status)}</span>
        <span>
          {findings.length}
          {highestSeverity ? (
            <small>{highestSeverity}</small>
          ) : null}
        </span>
      </div>
      {expanded && findings.length ? (
        <div
          id={findingsId}
          role="rowgroup"
          className="security-checks-finding-group"
        >
          {findings.map((finding) => (
            <div
              key={`${target.id}-${finding.id}`}
              role="row"
              className={`security-checks-finding-row${
                mutedFindingIds.has(finding.id) ? ' is-muted' : ''
              }`}
            >
              <button
                type="button"
                className={`security-checks-finding-row-button${selectedFindingId === finding.id ? ' is-active' : ''}`}
                aria-label={`View ${finding.cveId} details for ${target.connectionName}`}
                onClick={() => onSelectFinding(finding.id)}
              >
                <span className={`security-checks-severity severity-${finding.severity.toLowerCase()}`}>
                  {finding.severity}
                </span>
                <strong>{finding.cveId}</strong>
                <span>{finding.title || finding.summary}</span>
                {mutedFindingIds.has(finding.id) ? (
                  <em>Muted</em>
                ) : finding.knownExploited ? (
                  <em>CISA KEV</em>
                ) : null}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

function FindingDetail({
  finding,
  muted,
  onClose,
  onMute,
  onUnmute,
}: {
  finding: DatastoreSecurityFinding
  muted: boolean
  onClose(): void
  onMute(): void
  onUnmute(): void
}) {
  return (
    <section className="security-checks-panel security-checks-detail" aria-label={`${finding.cveId} details`}>
      <header>
        <h2>{finding.cveId}</h2>
        <div className="security-checks-detail-actions">
          <span className={`security-checks-severity severity-${finding.severity.toLowerCase()}`}>
            {finding.severity}
          </span>
          <button
            type="button"
            className="drawer-button drawer-button--compact"
            aria-label={`${muted ? 'Unmute' : 'Mute'} ${finding.cveId}`}
            onClick={muted ? onUnmute : onMute}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            className="sidebar-icon-button sidebar-icon-button--inline"
            aria-label="Close finding details"
            title="Close"
            onClick={onClose}
          >
            <CloseIcon className="sidebar-icon" />
          </button>
        </div>
      </header>
      <div className="security-checks-detail-body">
        <p>{finding.summary}</p>
        <dl>
          <div>
            <dt>CVSS</dt>
            <dd>{finding.cvssScore ?? 'Unknown'} {finding.cvssVector ? `(${finding.cvssVector})` : ''}</dd>
          </div>
          <div>
            <dt>Published</dt>
            <dd>{formatTimestamp(finding.publishedAt)}</dd>
          </div>
          <div>
            <dt>Modified</dt>
            <dd>{formatTimestamp(finding.modifiedAt)}</dd>
          </div>
          <div>
            <dt>Affected</dt>
            <dd>{finding.affectedProduct}{finding.affectedVersion ? ` ${finding.affectedVersion}` : ''}</dd>
          </div>
          <div>
            <dt>What To Do Next</dt>
            <dd>{finding.remediation}</dd>
          </div>
        </dl>
        {finding.kev ? (
          <div className="security-checks-kev">
            <strong>CISA KEV</strong>
            <span>Required action: {finding.kev.requiredAction ?? 'Review CISA guidance.'}</span>
            <span>Due date: {finding.kev.dueDate ?? 'Not provided'}</span>
          </div>
        ) : null}
        <div className="security-checks-links">
          {finding.references.slice(0, 8).map((reference) => (
            <a key={`${reference.label}-${reference.url}`} href={reference.url} target="_blank" rel="noreferrer">
              {reference.label}
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}

function groupFindingsByTargetId(
  snapshot: DatastoreSecurityCheckSnapshot | undefined,
  mutedFindingIds: Set<string>,
  includeMuted: boolean,
) {
  const grouped = new Map<string, DatastoreSecurityFinding[]>()

  for (const target of snapshot?.targets ?? []) {
    grouped.set(target.id, [])
  }

  for (const finding of snapshot?.findings ?? []) {
    if (!includeMuted && mutedFindingIds.has(finding.id)) {
      continue
    }
    for (const targetId of finding.targetIds) {
      const targetFindings = grouped.get(targetId)
      if (targetFindings) {
        targetFindings.push(finding)
      }
    }
  }

  return grouped
}

function securitySummaryCounts(
  snapshot: DatastoreSecurityCheckSnapshot | undefined,
  mutedFindingIds: Set<string>,
) {
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<DatastoreSecuritySeverity, number>
  let kev = 0

  for (const finding of snapshot?.findings ?? []) {
    if (mutedFindingIds.has(finding.id)) {
      continue
    }
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1
    if (finding.knownExploited) {
      kev += 1
    }
  }

  const needsAttention = (snapshot?.targets ?? []).filter((target) =>
    ['versionUnavailable', 'mappingUnavailable', 'error'].includes(target.status),
  ).length

  return { bySeverity, kev, needsAttention }
}

function highestFindingSeverity(findings: DatastoreSecurityFinding[]) {
  let highest: DatastoreSecuritySeverity | undefined
  for (const finding of findings) {
    if (!highest || severityRank(finding.severity) < severityRank(highest)) {
      highest = finding.severity
    }
  }
  return highest
}

function severityRank(severity: DatastoreSecuritySeverity) {
  const index = SEVERITIES.indexOf(severity)
  return index === -1 ? SEVERITIES.length : index
}

function nextManualRefreshMs(value: string | undefined, now: number) {
  const next = timestampToMs(value)
  return next && next > now ? next - now : 0
}

function formatTimestamp(value: string | undefined) {
  const ms = timestampToMs(value)
  if (!ms) return 'Never'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ms))
}

function timestampToMs(value: string | undefined) {
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function titleCase(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
