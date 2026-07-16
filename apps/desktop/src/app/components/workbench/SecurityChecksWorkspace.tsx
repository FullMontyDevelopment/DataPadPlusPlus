import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  DatastoreSecurityCheckSnapshot,
  DatastoreSecurityChecksRefreshRequest,
  DatastoreSecurityFinding,
  DatastoreSecurityPostureCheckResult,
  DatastoreSecurityTarget,
  DatastoreSecuritySeverity,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import {
  formatDate,
  formatTimestamp,
  highestFindingSeverity,
  highestPostureSeverityForChecks,
  nextManualRefreshMs,
  postureStatusRank,
  SEVERITIES,
  severityRank,
  titleCase,
  versionGuidanceLabel,
  versionGuidanceTooltip,
} from './SecurityChecksWorkspace.helpers'
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

const EMPTY_MUTED_FINDING_IDS: string[] = []

type SecurityChecksView = 'vulnerabilities' | 'posture'

interface TooltipPosition {
  left: number
  top: number
}

export function SecurityChecksWorkspace({
  enabled,
  snapshot,
  onOpenExperimentalSettings,
  onMutedFindingIdsChange,
  onRefresh,
}: SecurityChecksWorkspaceProps) {
  const [activeView, setActiveView] = useState<SecurityChecksView>('vulnerabilities')
  const [selectedFindingId, setSelectedFindingId] = useState<string>()
  const [selectedPostureCheckId, setSelectedPostureCheckId] = useState<string>()
  const [expandedTargetIds, setExpandedTargetIds] = useState<Record<string, boolean>>({})
  const [showMutedFindings, setShowMutedFindings] = useState(false)
  const [showPassingPostureChecks, setShowPassingPostureChecks] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const preferences = snapshot.preferences.datastoreSecurityChecks ?? {
    enabled: false,
    refreshIntervalDays: 7,
  }
  const securitySnapshot = snapshot.datastoreSecurityChecks
  const mutedFindingIds = preferences.mutedFindingIds ?? EMPTY_MUTED_FINDING_IDS
  const mutedFindingIdSet = useMemo(
    () => new Set(mutedFindingIds),
    [mutedFindingIds],
  )
  const selectedFinding = useMemo(() => {
    const finding = securitySnapshot?.findings.find((item) => item.id === selectedFindingId)

    if (!finding || (!showMutedFindings && mutedFindingIdSet.has(finding.id))) {
      return undefined
    }

    return finding
  }, [mutedFindingIdSet, securitySnapshot?.findings, selectedFindingId, showMutedFindings])
  const selectedPostureCheck = useMemo(() => {
    const check = securitySnapshot?.postureChecks.find((item) => item.id === selectedPostureCheckId)

    if (!check || (!showMutedFindings && mutedFindingIdSet.has(check.id))) {
      return undefined
    }

    return check
  }, [mutedFindingIdSet, securitySnapshot?.postureChecks, selectedPostureCheckId, showMutedFindings])
  const mutedFindingCount = securitySnapshot?.findings.filter((finding) =>
    mutedFindingIdSet.has(finding.id),
  ).length ?? 0
  const mutedPostureCount = securitySnapshot?.postureChecks.filter((check) =>
    mutedFindingIdSet.has(check.id),
  ).length ?? 0
  const mutedActiveCount = activeView === 'posture' ? mutedPostureCount : mutedFindingCount
  const cooldownMs = nextManualRefreshMs(preferences.nextManualRefreshAllowedAt, now)
  const refreshDisabled = refreshing || cooldownMs > 0 || !enabled
  const findingsByTargetId = useMemo(
    () => groupFindingsByTargetId(securitySnapshot, mutedFindingIdSet, showMutedFindings),
    [mutedFindingIdSet, securitySnapshot, showMutedFindings],
  )
  const postureChecksByTargetId = useMemo(
    () =>
      groupPostureChecksByTargetId(
        securitySnapshot,
        mutedFindingIdSet,
        showMutedFindings,
        showPassingPostureChecks,
      ),
    [mutedFindingIdSet, securitySnapshot, showMutedFindings, showPassingPostureChecks],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

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
      setSelectedPostureCheckId(undefined)
      setShowMutedFindings(false)
    }
  }

  const switchView = (view: SecurityChecksView) => {
    setActiveView(view)
    setSelectedFindingId(undefined)
    setSelectedPostureCheckId(undefined)
  }

  if (!enabled) {
    return (
      <section className="environment-workspace security-checks-workspace" aria-label="Security Checks">
        <div className="security-checks-empty">
          <ObjectSecurityIcon className="empty-icon" />
          <h2>Datastore Security Checks is experimental</h2>
          <p>Enable it in Plugins settings to scan datastore product versions against official vulnerability sources.</p>
          <button type="button" className="drawer-button drawer-button--primary" onClick={onOpenExperimentalSettings}>
            Open Plugins Settings
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
          <span>Posture Issues</span>
          <strong>{counts.postureIssues}</strong>
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

      <div className={`security-checks-grid${selectedFinding || selectedPostureCheck ? ' has-detail' : ''}`}>
        <section className="security-checks-panel security-checks-connections-panel">
          <header>
            <div className="security-checks-panel-title">
              <h2>Connections</h2>
              <div className="security-checks-view-toggle" role="tablist" aria-label="Security check view">
                <button
                  type="button"
                  role="tab"
                  aria-label={`Vulnerabilities ${counts.vulnerabilityIssues}`}
                  aria-selected={activeView === 'vulnerabilities'}
                  className={activeView === 'vulnerabilities' ? 'is-active' : ''}
                  onClick={() => switchView('vulnerabilities')}
                >
                  <span>Vulnerabilities</span>
                  <span className="security-checks-view-count">{counts.vulnerabilityIssues}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-label={`Posture ${counts.postureIssues}`}
                  aria-selected={activeView === 'posture'}
                  className={activeView === 'posture' ? 'is-active' : ''}
                  onClick={() => switchView('posture')}
                >
                  <span>Posture</span>
                  <span className="security-checks-view-count">{counts.postureIssues}</span>
                </button>
              </div>
            </div>
            <div className="security-checks-panel-header-actions">
              <span>{securitySnapshot?.targets.length ?? 0}</span>
              {activeView === 'posture' ? (
                <button
                  type="button"
                  className="drawer-button drawer-button--compact"
                  aria-pressed={showPassingPostureChecks}
                  onClick={() => setShowPassingPostureChecks((current) => !current)}
                >
                  {showPassingPostureChecks ? 'Hide Passing' : 'Show Passing'}
                </button>
              ) : null}
              {mutedActiveCount > 0 ? (
                <button
                  type="button"
                  className="drawer-button drawer-button--compact"
                  aria-pressed={showMutedFindings}
                  onClick={() => setShowMutedFindings((current) => !current)}
                >
                  {showMutedFindings ? 'Hide Muted' : `Show Muted (${mutedActiveCount})`}
                </button>
              ) : null}
            </div>
          </header>
          <div className="security-checks-table security-checks-connections" role="table" aria-label="Security check connections and findings">
            <div role="row" className="security-checks-table-head">
              <span>Connection</span>
              <span>Environment</span>
              <span>Version</span>
              <span>Guidance</span>
              <span>{activeView === 'posture' ? 'Posture' : 'Findings'}</span>
            </div>
            {(securitySnapshot?.targets ?? []).map((target) => {
              const findings = findingsByTargetId.get(target.id) ?? []
              const postureChecks = postureChecksByTargetId.get(target.id) ?? []
              const activeRows = activeView === 'posture' ? postureChecks : findings
              const expanded = expandedTargetIds[target.id] ?? activeRows.length > 0
              return (
                <SecurityConnectionRows
                  key={target.id}
                  activeView={activeView}
                  expanded={expanded}
                  findings={findings}
                  mutedFindingIds={mutedFindingIdSet}
                  postureChecks={postureChecks}
                  selectedFindingId={selectedFinding?.id}
                  selectedPostureCheckId={selectedPostureCheck?.id}
                  target={target}
                  onSelectFinding={(findingId) => {
                    setSelectedPostureCheckId(undefined)
                    setSelectedFindingId(findingId)
                  }}
                  onSelectPostureCheck={(checkId) => {
                    setSelectedFindingId(undefined)
                    setSelectedPostureCheckId(checkId)
                  }}
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
        ) : selectedPostureCheck ? (
          <PostureCheckDetail
            check={selectedPostureCheck}
            muted={mutedFindingIdSet.has(selectedPostureCheck.id)}
            onClose={() => setSelectedPostureCheckId(undefined)}
            onMute={() => void updateFindingMute(selectedPostureCheck.id, true)}
            onUnmute={() => void updateFindingMute(selectedPostureCheck.id, false)}
          />
        ) : null}
      </div>
    </section>
  )
}

function SecurityConnectionRows({
  activeView,
  expanded,
  findings,
  mutedFindingIds,
  postureChecks,
  selectedFindingId,
  selectedPostureCheckId,
  target,
  onSelectFinding,
  onSelectPostureCheck,
  onToggle,
}: {
  activeView: SecurityChecksView
  expanded: boolean
  findings: DatastoreSecurityFinding[]
  mutedFindingIds: Set<string>
  postureChecks: DatastoreSecurityPostureCheckResult[]
  selectedFindingId?: string
  selectedPostureCheckId?: string
  target: DatastoreSecurityTarget
  onSelectFinding(findingId: string): void
  onSelectPostureCheck(checkId: string): void
  onToggle(): void
}) {
  const findingsId = `security-findings-${target.id}`
  const highestSeverity = highestFindingSeverity(findings)
  const highestPostureSeverity = highestPostureSeverityForChecks(postureChecks)
  const visibleRows = activeView === 'posture' ? postureChecks : findings
  const guidanceLabel = versionGuidanceLabel(target)
  const guidanceDetail = target.versionSourceUpdatedAt
    ? `Catalog: ${formatDate(target.versionSourceUpdatedAt)}`
    : undefined
  const guidanceTooltip = versionGuidanceTooltip(target)

  return (
    <>
      <div role="row" className="security-checks-table-row security-checks-connection-row">
        <span>
          <button
            type="button"
            className="security-checks-target-toggle"
            disabled={!visibleRows.length}
            aria-expanded={visibleRows.length ? expanded : undefined}
            aria-controls={visibleRows.length ? findingsId : undefined}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${activeView === 'posture' ? 'posture checks' : 'findings'} for ${target.connectionName}`}
            onClick={onToggle}
          >
            {visibleRows.length ? (
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
        <span>
          <span className="security-checks-version-stack">
            <strong>{target.detectedVersion ?? 'Unavailable'}</strong>
            {target.knownLatestVersion && target.versionStatus !== 'current' ? (
              <small>Known newer: {target.knownLatestVersion}</small>
            ) : target.versionStatus === 'current' ? (
              <small>Current in bundled catalog</small>
            ) : null}
          </span>
        </span>
        <span>
          <GuidanceTooltip
            detail={guidanceDetail}
            label={guidanceLabel}
            tooltip={guidanceTooltip}
          />
        </span>
        <span>
          {activeView === 'posture' ? postureChecks.length : findings.length}
          {activeView === 'posture' ? (
            highestPostureSeverity ? <small>{highestPostureSeverity}</small> : null
          ) : highestSeverity ? (
            <small>{highestSeverity}</small>
          ) : null}
        </span>
      </div>
      {expanded && visibleRows.length ? (
        <div
          id={findingsId}
          role="rowgroup"
          className="security-checks-finding-group"
        >
          {activeView === 'posture'
            ? postureChecks.map((check) => (
                <div
                  key={`${target.id}-${check.id}`}
                  role="row"
                  className={`security-checks-finding-row${
                    mutedFindingIds.has(check.id) ? ' is-muted' : ''
                  }`}
                >
                  <button
                    type="button"
                    className={`security-checks-finding-row-button${selectedPostureCheckId === check.id ? ' is-active' : ''}`}
                    aria-label={`View ${check.title} posture check for ${target.connectionName}`}
                    onClick={() => onSelectPostureCheck(check.id)}
                  >
                    <span className={`security-checks-severity status-${check.status}`}>
                      {check.status}
                    </span>
                    <strong>{titleCase(check.category)}</strong>
                    <span>{check.title || check.summary}</span>
                    {mutedFindingIds.has(check.id) ? (
                      <em>Muted</em>
                    ) : check.source === 'read-only-probe' ? (
                      <em>Probe</em>
                    ) : null}
                  </button>
                </div>
              ))
            : findings.map((finding) => (
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

function GuidanceTooltip({
  detail,
  label,
  tooltip,
}: {
  detail?: string
  label: string
  tooltip: string
}) {
  const tooltipId = useId()
  const [position, setPosition] = useState<TooltipPosition>()

  const openTooltip = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const viewportWidth = window.innerWidth || 1280
    const viewportHeight = window.innerHeight || 720
    const maxWidth = 360
    const estimatedHeight = Math.min(220, 36 + tooltip.split('\n').length * 22)
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, viewportWidth - maxWidth - 8),
    )
    const below = rect.bottom + 8
    const top =
      below + estimatedHeight > viewportHeight - 8
        ? Math.max(8, rect.top - estimatedHeight - 8)
        : below

    setPosition({ left, top })
  }

  return (
    <>
      <span
        className="security-checks-version-stack security-checks-guidance-trigger"
        tabIndex={0}
        aria-describedby={position ? tooltipId : undefined}
        onBlur={() => setPosition(undefined)}
        onFocus={(event) => openTooltip(event.currentTarget)}
        onMouseEnter={(event) => openTooltip(event.currentTarget)}
        onMouseLeave={() => setPosition(undefined)}
      >
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      {position && typeof document !== 'undefined'
        ? createPortal(
            <div
              id={tooltipId}
              role="tooltip"
              className="security-checks-guidance-tooltip"
              style={{ left: position.left, top: position.top }}
            >
              {tooltip.split('\n').map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>,
            document.body,
          )
        : null}
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
            <dd>{finding.affectedProduct}{finding.affectedVersion ? ` ${finding.affectedVersion}` : ''}{finding.affectedVersionRange ? ` (${finding.affectedVersionRange})` : ''}</dd>
          </div>
          {finding.fixedVersionHint ? (
            <div>
              <dt>Fixed Version Hint</dt>
              <dd>{finding.fixedVersionHint}</dd>
            </div>
          ) : null}
          {finding.affectedVersionRange ? (
            <div>
              <dt>NVD Affected Range</dt>
              <dd>{finding.affectedVersionRange}</dd>
            </div>
          ) : null}
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

function PostureCheckDetail({
  check,
  muted,
  onClose,
  onMute,
  onUnmute,
}: {
  check: DatastoreSecurityPostureCheckResult
  muted: boolean
  onClose(): void
  onMute(): void
  onUnmute(): void
}) {
  return (
    <section className="security-checks-panel security-checks-detail" aria-label={`${check.title} posture check`}>
      <header>
        <h2>{check.title}</h2>
        <div className="security-checks-detail-actions">
          <span className={`security-checks-severity status-${check.status}`}>
            {check.status}
          </span>
          <button
            type="button"
            className="drawer-button drawer-button--compact"
            aria-label={`${muted ? 'Unmute' : 'Mute'} ${check.title}`}
            onClick={muted ? onUnmute : onMute}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            className="sidebar-icon-button sidebar-icon-button--inline"
            aria-label="Close posture details"
            title="Close"
            onClick={onClose}
          >
            <CloseIcon className="sidebar-icon" />
          </button>
        </div>
      </header>
      <div className="security-checks-detail-body">
        <p>{check.summary}</p>
        <dl>
          <div>
            <dt>Severity</dt>
            <dd>{check.severity}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{titleCase(check.status)}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{titleCase(check.category)}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{check.source === 'read-only-probe' ? 'Read-only probe' : 'Profile'}</dd>
          </div>
          {check.evidence ? (
            <div>
              <dt>Evidence</dt>
              <dd>{check.evidence}</dd>
            </div>
          ) : null}
          <div>
            <dt>What To Do Next</dt>
            <dd>{check.remediation}</dd>
          </div>
        </dl>
        {check.references.length ? (
          <div className="security-checks-links">
            {check.references.slice(0, 8).map((reference) => (
              <a key={`${reference.label}-${reference.url}`} href={reference.url} target="_blank" rel="noreferrer">
                {reference.label}
              </a>
            ))}
          </div>
        ) : null}
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

function groupPostureChecksByTargetId(
  snapshot: DatastoreSecurityCheckSnapshot | undefined,
  mutedFindingIds: Set<string>,
  includeMuted: boolean,
  includePassing: boolean,
) {
  const grouped = new Map<string, DatastoreSecurityPostureCheckResult[]>()

  for (const target of snapshot?.targets ?? []) {
    grouped.set(target.id, [])
  }

  for (const check of snapshot?.postureChecks ?? []) {
    if (!includeMuted && mutedFindingIds.has(check.id)) {
      continue
    }
    if (!includePassing && (check.status === 'pass' || check.status === 'notApplicable')) {
      continue
    }
    for (const targetId of check.targetIds) {
      const targetChecks = grouped.get(targetId)
      if (targetChecks) {
        targetChecks.push(check)
      }
    }
  }

  for (const checks of grouped.values()) {
    checks.sort((left, right) => {
      const statusDelta = postureStatusRank(left.status) - postureStatusRank(right.status)
      if (statusDelta) return statusDelta
      return severityRank(left.severity) - severityRank(right.severity)
    })
  }

  return grouped
}

function securitySummaryCounts(
  snapshot: DatastoreSecurityCheckSnapshot | undefined,
  mutedFindingIds: Set<string>,
) {
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<DatastoreSecuritySeverity, number>
  let kev = 0
  let vulnerabilityIssues = 0
  let postureIssues = 0

  for (const finding of snapshot?.findings ?? []) {
    if (mutedFindingIds.has(finding.id)) {
      continue
    }
    vulnerabilityIssues += 1
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1
    if (finding.knownExploited) {
      kev += 1
    }
  }
  for (const check of snapshot?.postureChecks ?? []) {
    if (mutedFindingIds.has(check.id)) {
      continue
    }
    if (check.status === 'fail' || check.status === 'warn' || check.status === 'unknown') {
      postureIssues += 1
      bySeverity[check.severity] = (bySeverity[check.severity] ?? 0) + 1
    }
  }

  const postureTargetIds = new Set(
    (snapshot?.postureChecks ?? [])
      .filter(
        (check) =>
          !mutedFindingIds.has(check.id) &&
          (check.status === 'fail' || check.status === 'warn' || check.status === 'unknown'),
      )
      .flatMap((check) => check.targetIds),
  )
  const findingTargetIds = new Set(
    (snapshot?.findings ?? [])
      .filter((finding) => !mutedFindingIds.has(finding.id))
      .flatMap((finding) => finding.targetIds),
  )
  const needsAttention = (snapshot?.targets ?? []).filter(
    (target) =>
      ['versionUnavailable', 'mappingUnavailable', 'error'].includes(target.status) ||
      target.versionStatus === 'updateAvailable' ||
      target.versionStatus === 'unsupported' ||
      findingTargetIds.has(target.id) ||
      postureTargetIds.has(target.id),
  ).length

  return { bySeverity, kev, postureIssues, vulnerabilityIssues, needsAttention }
}
