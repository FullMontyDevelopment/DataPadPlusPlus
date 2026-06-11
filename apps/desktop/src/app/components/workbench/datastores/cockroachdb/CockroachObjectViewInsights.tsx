import {
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
} from '../../icons'
import type { JsonRecord } from '../common/sql/RelationalObjectViewWorkspace.helpers'

interface CockroachObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function CockroachObjectViewInsights({ kind, payload }: CockroachObjectViewInsightsProps) {
  if (payload.engine !== 'cockroachdb') {
    return null
  }

  const tables = records(payload.tables)
  const indexes = records(payload.indexes)
  const statistics = records(payload.statistics)
  const zones = records(payload.zoneConfigurations)
  const nodes = records(payload.nodes)
  const ranges = records(payload.ranges)
  const regions = records(payload.regions)
  const jobs = records(payload.jobs)
  const settings = records(payload.clusterSettings)
  const sessions = records(payload.sessions)
  const transactions = records(payload.transactions)
  const contention = records(payload.contention)
  const locks = records(payload.locks)
  const statements = records(payload.statements)
  const roles = records(payload.roles)
  const permissions = records(payload.permissions)
  const grants = records(payload.grants)
  const certificates = records(payload.certificates)

  if (
    !tables.length &&
    !indexes.length &&
    !statistics.length &&
    !zones.length &&
    !nodes.length &&
    !ranges.length &&
    !regions.length &&
    !jobs.length &&
    !settings.length &&
    !sessions.length &&
    !transactions.length &&
    !contention.length &&
    !locks.length &&
    !statements.length &&
    !roles.length &&
    !permissions.length &&
    !grants.length &&
    !certificates.length
  ) {
    return null
  }

  return (
    <>
      {(tables.length || indexes.length || statistics.length || zones.length) ? (
        <section className="object-view-section" aria-label="CockroachDB table posture">
          <CockroachSectionHeading icon="table" title="Tables" unit={scopeLabel(kind)} />
          <div className="object-view-card-grid">
            <Card label="Tables" value={firstDisplay(payload.tableCount, tables.length || undefined)} />
            <Card label="Rows" value={firstDisplay(payload.rowCount, sumField(statistics.length ? statistics : tables, 'rows'))} />
            <Card label="Indexes" value={firstDisplay(payload.indexCount, indexes.length || undefined)} />
            <Card label="Zones" value={zones.length || undefined} />
          </div>
          <ChipRows rows={zones.length ? zones : tables} labelKey={zones.length ? 'target' : 'name'} valueKey={zones.length ? 'constraints' : 'type'} />
        </section>
      ) : null}

      {(nodes.length || ranges.length || regions.length || settings.length) ? (
        <section className="object-view-section" aria-label="CockroachDB cluster posture">
          <CockroachSectionHeading icon="cluster" title="Cluster" unit={`${nodes.length || firstDisplay(payload.nodeCount)} node(s)`} />
          <div className="object-view-card-grid">
            <Card label="Nodes" value={firstDisplay(payload.nodeCount, nodes.length || undefined)} />
            <Card label="Ranges" value={firstDisplay(payload.rangeCount, ranges.length || undefined)} />
            <Card label="Regions" value={firstDisplay(payload.regionCount, regions.length || undefined)} />
            <Card label="Settings" value={settings.length || undefined} />
          </div>
          <ChipRows rows={nodes.length ? nodes : regions} labelKey={nodes.length ? 'address' : 'region'} valueKey={nodes.length ? 'status' : 'survivalGoal'} />
        </section>
      ) : null}

      {(regions.length || zones.length) ? (
        <section className="object-view-section" aria-label="CockroachDB locality posture">
          <CockroachSectionHeading icon="index" title="Locality" unit="placement" />
          <div className="object-view-card-grid">
            <Card label="Regions" value={regions.length || undefined} />
            <Card label="Constraints" value={countFilled([...regions, ...zones], 'constraints')} />
            <Card label="Lease Prefs" value={countFilled(zones, 'leasePreferences')} />
            <Card label="Replicas" value={sumField(zones, 'numReplicas')} />
          </div>
          <ChipRows rows={regions.length ? regions : zones} labelKey={regions.length ? 'region' : 'target'} valueKey={regions.length ? 'constraints' : 'leasePreferences'} />
        </section>
      ) : null}

      {jobs.length ? (
        <section className="object-view-section" aria-label="CockroachDB job posture">
          <CockroachSectionHeading icon="job" title="Jobs" unit={`${jobs.length} job(s)`} />
          <div className="object-view-card-grid">
            <Card label="Running" value={countMatching(jobs, 'status', 'running')} />
            <Card label="Paused" value={countMatching(jobs, 'status', 'paused')} />
            <Card label="Failed" value={countMatching(jobs, 'status', 'failed')} />
            <Card label="Complete" value={countAny(jobs, 'status', ['succeeded', 'success', 'complete'])} />
          </div>
          <ChipRows rows={jobs} labelKey="type" valueKey="status" />
        </section>
      ) : null}

      {(sessions.length || transactions.length || contention.length || locks.length || statements.length) ? (
        <section className="object-view-section" aria-label="CockroachDB contention posture">
          <CockroachSectionHeading icon="activity" title="Activity" unit="SQL/KV" />
          <div className="object-view-card-grid">
            <Card label="Sessions" value={firstDisplay(payload.activeSessions, sessions.length || undefined)} />
            <Card label="Blocked" value={firstDisplay(payload.blockedSessions, blockedCount(sessions, locks))} />
            <Card label="Retries" value={firstDisplay(payload.retryCount, sumField(statements, 'retries'))} />
            <Card label="Contention" value={contention.length || undefined} />
          </div>
          <ChipRows rows={contention.length ? contention : statements.length ? statements : sessions} labelKey={contention.length ? 'table' : statements.length ? 'query' : 'user'} valueKey={contention.length ? 'durationMs' : statements.length ? 'meanMs' : 'state'} />
        </section>
      ) : null}

      {(roles.length || permissions.length || grants.length || certificates.length) ? (
        <section className="object-view-section" aria-label="CockroachDB security posture">
          <CockroachSectionHeading icon="security" title="Security" unit={`${roles.length} role(s)`} />
          <div className="object-view-card-grid">
            <Card label="Roles" value={roles.length || undefined} />
            <Card label="Logins" value={countTruthy(roles, 'login')} />
            <Card label="Admins" value={countTruthy(roles, 'superuser')} />
            <Card label="Grants" value={permissions.length || grants.length || undefined} />
            <Card label="Certs" value={certificates.length || undefined} />
          </div>
          <ChipRows
            rows={roles.length ? roles : permissions.length ? permissions : grants.length ? grants : certificates}
            labelKey={roles.length ? 'name' : certificates.length ? 'subject' : 'principal'}
            valueKey={roles.length ? 'memberships' : certificates.length ? 'validUntil' : 'privilege'}
          />
        </section>
      ) : null}
    </>
  )
}

function CockroachSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: 'activity' | 'cluster' | 'index' | 'job' | 'security' | 'table'
  title: string
  unit?: string
}) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'job'
          ? ObjectJobIcon
          : icon === 'activity' || icon === 'cluster'
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
          {shorten(chip.label)}
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

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function firstDisplay(...values: unknown[]) {
  return values.find((value) => display(value) && display(value) !== '-')
}

function sumField(rows: JsonRecord[], key: string) {
  const total = rows.reduce((sum, row) => {
    const value = Number(row[key])
    return Number.isFinite(value) ? sum + value : sum
  }, 0)
  return total || undefined
}

function countFilled(rows: JsonRecord[], key: string) {
  const count = rows.filter((row) => display(row[key]) && display(row[key]) !== '-').length
  return count || undefined
}

function countTruthy(rows: JsonRecord[], key: string) {
  const count = rows.filter((row) => /true|yes|1/i.test(display(row[key]))).length
  return rows.length ? `${count}/${rows.length}` : undefined
}

function countMatching(rows: JsonRecord[], key: string, needle: string) {
  return rows.filter((row) => display(row[key]).toLowerCase().includes(needle)).length || undefined
}

function countAny(rows: JsonRecord[], key: string, needles: string[]) {
  const normalized = needles.map((needle) => needle.toLowerCase())
  const count = rows.filter((row) => normalized.some((needle) => display(row[key]).toLowerCase().includes(needle))).length
  return count || undefined
}

function blockedCount(sessions: JsonRecord[], locks: JsonRecord[]) {
  const blockedSessions = sessions.filter((row) => display(row.blockedBy) && display(row.blockedBy) !== '-').length
  const waitingLocks = locks.filter((row) => !/true|yes|1/i.test(display(row.granted))).length
  return blockedSessions + waitingLocks || undefined
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

function shorten(value: string) {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value
}

function scopeLabel(kind: string) {
  return kind === 'table' || kind === 'index' ? 'object' : 'database'
}
