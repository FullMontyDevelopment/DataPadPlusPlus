import {
  ObjectIndexIcon,
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
} from '../../icons'
import type { JsonRecord } from '../common/sql/RelationalObjectViewWorkspace.helpers'

interface PostgresObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function PostgresObjectViewInsights({ kind, payload }: PostgresObjectViewInsightsProps) {
  if (payload.engine !== 'postgresql') {
    return null
  }

  const tables = records(payload.tables)
  const indexes = records(payload.indexes)
  const indexHealth = records(payload.indexHealth)
  const statistics = records(payload.statistics)
  const roles = records(payload.roles)
  const permissions = records(payload.permissions)
  const roleMemberships = records(payload.roleMemberships)
  const defaultPrivileges = records(payload.defaultPrivileges)
  const sessions = records(payload.sessions)
  const locks = records(payload.locks)
  const waits = records(payload.waits)
  const statements = records(payload.statements)
  const extensions = records(payload.extensions)
  const extensionObjects = records(payload.extensionObjects)

  if (
    !tables.length &&
    !indexes.length &&
    !indexHealth.length &&
    !statistics.length &&
    !roles.length &&
    !permissions.length &&
    !roleMemberships.length &&
    !defaultPrivileges.length &&
    !sessions.length &&
    !locks.length &&
    !waits.length &&
    !statements.length &&
    !extensions.length &&
    !extensionObjects.length
  ) {
    return null
  }

  return (
    <>
      {(tables.length || statistics.length || extensions.length || extensionObjects.length) ? (
        <section className="object-view-section" aria-label="PostgreSQL storage posture">
          <PostgresSectionHeading icon="table" title="Storage" unit={scopeLabel(kind)} />
          <div className="object-view-card-grid">
            <Card label="Tables" value={firstDisplay(payload.tableCount, tables.length || undefined)} />
            <Card label="Rows" value={firstDisplay(payload.rowCount, sumField(statistics.length ? statistics : tables, 'rows'))} />
            <Card label="Size" value={firstDisplay(payload.size, firstField(statistics, 'size'))} />
            <Card label="Extensions" value={extensions.length || undefined} />
            <Card label="Updates" value={countTruthy(extensions, 'updateAvailable')} />
            <Card label="Ext Objects" value={extensionObjects.length || undefined} />
          </div>
          <ChipRows rows={extensions.length ? extensions : statistics.length ? statistics : tables} labelKey="name" valueKey={extensions.length ? 'status' : 'lastAnalyze'} />
          <ChipRows rows={extensionObjects} labelKey="object" valueKey="extension" />
        </section>
      ) : null}

      {(indexes.length || indexHealth.length) ? (
        <section className="object-view-section" aria-label="PostgreSQL index posture">
          <PostgresSectionHeading icon="index" title="Indexes" unit={`${indexes.length || indexHealth.length} index(es)`} />
          <div className="object-view-card-grid">
            <Card label="Unique" value={countTruthy(indexes, 'unique')} />
            <Card label="Invalid" value={countFalsy(indexes, 'valid')} />
            <Card label="Review" value={countMatching(indexHealth, 'bloatRisk', 'review')} />
            <Card label="Scans" value={sumField(indexHealth, 'scans')} />
          </div>
          <ChipRows rows={indexHealth.length ? indexHealth : indexes} labelKey={indexHealth.length ? 'index' : 'name'} valueKey={indexHealth.length ? 'bloatRisk' : 'columns'} />
        </section>
      ) : null}

      {(roles.length || permissions.length || roleMemberships.length || defaultPrivileges.length) ? (
        <section className="object-view-section" aria-label="PostgreSQL security posture">
          <PostgresSectionHeading icon="security" title="Security" unit={`${roles.length} role(s)`} />
          <div className="object-view-card-grid">
            <Card label="Roles" value={roles.length || undefined} />
            <Card label="Logins" value={countTruthy(roles, 'login')} />
            <Card label="Grants" value={permissions.length || undefined} />
            <Card label="Memberships" value={roleMemberships.length || undefined} />
            <Card label="Defaults" value={defaultPrivileges.length || undefined} />
            <Card label="Superusers" value={countTruthy(roles, 'superuser')} />
          </div>
          <ChipRows rows={roles.length ? roles : permissions} labelKey={roles.length ? 'name' : 'principal'} valueKey={roles.length ? 'memberships' : 'privilege'} />
          <ChipRows rows={roleMemberships} labelKey="role" valueKey="memberOf" />
          <ChipRows rows={defaultPrivileges} labelKey="principal" valueKey="privilege" />
        </section>
      ) : null}

      {(sessions.length || locks.length || waits.length || statements.length) ? (
        <section className="object-view-section" aria-label="PostgreSQL activity posture">
          <PostgresSectionHeading icon="activity" title="Activity" unit="pg_stat" />
          <div className="object-view-card-grid">
            <Card label="Sessions" value={firstDisplay(payload.activeSessions, sessions.length || undefined)} />
            <Card label="Blocked" value={firstDisplay(payload.blockedSessions, blockedCount(sessions, locks))} />
            <Card label="Locks" value={locks.length || undefined} />
            <Card label="Statements" value={statements.length || undefined} />
          </div>
          <ChipRows rows={statements.length ? statements : sessions} labelKey={statements.length ? 'query' : 'user'} valueKey={statements.length ? 'meanMs' : 'state'} />
        </section>
      ) : null}
    </>
  )
}

function PostgresSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: 'activity' | 'index' | 'security' | 'table'
  title: string
  unit?: string
}) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'activity'
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

function firstField(rows: JsonRecord[], key: string) {
  return firstDisplay(...rows.map((row) => row[key]))
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

function countTruthy(rows: JsonRecord[], key: string) {
  const count = rows.filter((row) => /true|yes|1/i.test(display(row[key]))).length
  return rows.length ? `${count}/${rows.length}` : undefined
}

function countFalsy(rows: JsonRecord[], key: string) {
  const count = rows.filter((row) => /false|no|0/i.test(display(row[key]))).length
  return rows.length ? `${count}/${rows.length}` : undefined
}

function countMatching(rows: JsonRecord[], key: string, needle: string) {
  return rows.filter((row) => display(row[key]).toLowerCase().includes(needle)).length || undefined
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
