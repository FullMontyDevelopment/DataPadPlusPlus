import {
  ObjectJobIcon,
  ObjectMetricIcon,
  ObjectTableIcon,
} from './icons'
import type { JsonRecord } from './RelationalObjectViewWorkspace.helpers'

interface TimescaleObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function TimescaleObjectViewInsights({ kind, payload }: TimescaleObjectViewInsightsProps) {
  if (payload.engine !== 'timescaledb') {
    return null
  }

  const hypertables = records(payload.hypertables)
  const chunks = records(payload.chunks)
  const compressionPolicies = records(payload.compressionPolicies)
  const retentionPolicies = records(payload.retentionPolicies)
  const continuousAggregates = records(payload.continuousAggregates)
  const jobs = records(payload.jobs)
  const diagnostics = records(payload.diagnostics)
  const profile = record(payload.timescaleProfile)

  if (
    !profile &&
    !hypertables.length &&
    !chunks.length &&
    !compressionPolicies.length &&
    !retentionPolicies.length &&
    !continuousAggregates.length &&
    !jobs.length &&
    !diagnostics.length
  ) {
    return null
  }

  return (
    <>
      {profile ? (
        <section className="object-view-section" aria-label="Timescale profile posture">
          <TimescaleSectionHeading icon="diagnostics" title="Profile" unit={profileLabel(profile)} />
          <div className="object-view-card-grid">
            <Card label="Deployment" value={profile.deploymentMode} />
            <Card label="Region" value={profile.region} />
            <Card label="Extension" value={profile.extensionVersion} />
            <Card label="Policy Mode" value={profile.policyExecution} />
          </div>
          {display(profile.disabledReason) !== '-' ? (
            <div className="object-view-chip-row">
              <span>
                Policy execution <strong>{display(profile.disabledReason)}</strong>
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="object-view-section" aria-label="Timescale hypertable posture">
        <TimescaleSectionHeading icon="hypertable" title="Hypertables" unit={scopeLabel(kind)} />
        <div className="object-view-card-grid">
          <Card label="Hypertables" value={firstDisplay(payload.hypertableCount, hypertables.length || undefined)} />
          <Card label="Chunks" value={firstDisplay(payload.chunkCount, chunks.length || undefined)} />
          <Card label="Compressed" value={compressedCount(hypertables, chunks)} />
          <Card label="Retention" value={firstDisplay(firstField(retentionPolicies, 'window'), firstField(hypertables, 'retention'))} />
        </div>
        <ChipRows rows={hypertables} labelKey="name" valueKey="retention" />
      </section>

      {(compressionPolicies.length || retentionPolicies.length || jobs.length) ? (
        <section className="object-view-section" aria-label="Timescale policy posture">
          <TimescaleSectionHeading icon="job" title="Policies" unit={`${compressionPolicies.length + retentionPolicies.length} policy(s)`} />
          <div className="object-view-card-grid">
            <Card label="Compression" value={String(compressionPolicies.length || '-')} />
            <Card label="Retention" value={String(retentionPolicies.length || '-')} />
            <Card label="Jobs" value={firstDisplay(payload.jobCount, jobs.length || undefined)} />
            <Card label="Last Run" value={firstDisplay(firstField(jobs, 'lastRun'), firstField(retentionPolicies, 'lastRun'))} />
          </div>
          <ChipRows rows={jobs.length ? jobs : [...compressionPolicies, ...retentionPolicies]} labelKey="object" valueKey="status" />
        </section>
      ) : null}

      {continuousAggregates.length ? (
        <section className="object-view-section" aria-label="Timescale continuous aggregate posture">
          <TimescaleSectionHeading icon="aggregate" title="Aggregates" unit={`${continuousAggregates.length} view(s)`} />
          <div className="object-view-card-grid">
            <Card label="Views" value={firstDisplay(payload.continuousAggregateCount, continuousAggregates.length)} />
            <Card label="Bucket" value={firstField(continuousAggregates, 'bucket')} />
            <Card label="Lag" value={firstField(continuousAggregates, 'lag')} />
            <Card label="Refresh" value={firstField(continuousAggregates, 'lastRefresh')} />
          </div>
          <ChipRows rows={continuousAggregates} labelKey="name" valueKey="lag" />
        </section>
      ) : null}

      {diagnostics.length ? (
        <section className="object-view-section" aria-label="Timescale diagnostics posture">
          <TimescaleSectionHeading icon="diagnostics" title="Diagnostics" unit={`${diagnostics.length} signal(s)`} />
          <div className="object-view-card-grid">
            <Card label="Signals" value={String(diagnostics.length)} />
            <Card label="Compression" value={firstMetric(diagnostics, 'Compression Coverage')} />
            <Card label="Refresh Lag" value={firstMetric(diagnostics, 'Refresh Lag')} />
            <Card label="Retention" value={firstMetric(diagnostics, 'Retention Window')} />
          </div>
          <ChipRows rows={diagnostics} labelKey="signal" valueKey="status" />
        </section>
      ) : null}
    </>
  )
}

function TimescaleSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: 'hypertable' | 'job' | 'aggregate' | 'diagnostics'
  title: string
  unit?: string
}) {
  const Icon =
    icon === 'job'
      ? ObjectJobIcon
      : icon === 'diagnostics'
        ? ObjectMetricIcon
        : ObjectTableIcon

  return (
    <div className="object-view-section-heading">
      <Icon className="panel-inline-icon" />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function Card({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="object-view-card">
      <span>{label}</span>
      <strong>{display(value) || '-'}</strong>
    </div>
  )
}

function ChipRows({
  rows,
  labelKey,
  valueKey,
}: {
  rows: JsonRecord[]
  labelKey: string
  valueKey: string
}) {
  const chips = rows
    .map((row) => ({ label: display(row[labelKey]), value: display(row[valueKey]) }))
    .filter((row) => row.label && row.label !== '-')
    .slice(0, 8)

  if (!chips.length) {
    return null
  }

  return (
    <div className="object-view-chip-row">
      {chips.map((chip) => (
        <span key={`${chip.label}:${chip.value}`}>
          {chip.label}
          {chip.value && chip.value !== '-' ? (
            <>
              {' '}
              <strong>{chip.value}</strong>
            </>
          ) : null}
        </span>
      ))}
    </div>
  )
}

function compressedCount(hypertables: JsonRecord[], chunks: JsonRecord[]) {
  const rows = chunks.length ? chunks : hypertables
  const compressed = rows.filter((row) => /yes|partial|true/i.test(display(row.compressed))).length
  return rows.length ? `${compressed}/${rows.length}` : '-'
}

function firstMetric(rows: JsonRecord[], signal: string) {
  const row = rows.find((item) => display(item.signal).toLowerCase() === signal.toLowerCase())
  return firstDisplay(row?.value)
}

function firstField(rows: JsonRecord[], key: string) {
  return firstDisplay(...rows.map((row) => row[key]))
}

function firstDisplay(...values: unknown[]) {
  return values.find((value) => display(value) && display(value) !== '-')
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function record(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-'
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString() : String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  return String(value)
}

function scopeLabel(kind: string) {
  return kind === 'hypertable' ? 'object' : 'time-series'
}

function profileLabel(profile: JsonRecord) {
  return display(firstDisplay(profile.license, profile.extensionSchema))
}
