import {
  ObjectDatabaseIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectSecurityIcon,
} from './icons'
import type { JsonRecord } from './RelationalObjectViewWorkspace.helpers'

interface SqlServerObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function SqlServerObjectViewInsights({ kind, payload }: SqlServerObjectViewInsightsProps) {
  if (payload.engine !== 'sqlserver') {
    return null
  }

  const tables = records(payload.tables)
  const indexes = records(payload.indexes)
  const statistics = records(payload.statistics)
  const missingIndexes = records(payload.missingIndexes)
  const queryStore = records(payload.queryStore)
  const sessions = records(payload.sessions)
  const locks = records(payload.locks)
  const waits = records(payload.waits)
  const users = records(payload.users)
  const roles = records(payload.roles)
  const permissions = records(payload.permissions)
  const files = records(payload.files)
  const filegroups = records(payload.filegroups)
  const jobs = records(payload.jobs)

  if (
    !tables.length &&
    !indexes.length &&
    !statistics.length &&
    !missingIndexes.length &&
    !queryStore.length &&
    !sessions.length &&
    !locks.length &&
    !waits.length &&
    !users.length &&
    !roles.length &&
    !permissions.length &&
    !files.length &&
    !filegroups.length &&
    !jobs.length
  ) {
    return null
  }

  return (
    <>
      {(tables.length || statistics.length || files.length || filegroups.length) ? (
        <section className="object-view-section" aria-label="SQL Server storage posture">
          <SqlServerSectionHeading icon="database" title="Storage" unit={scopeLabel(kind)} />
          <div className="object-view-card-grid">
            <Card label="Tables" value={firstDisplay(payload.tableCount, tables.length || undefined)} />
            <Card label="Rows" value={firstDisplay(payload.rowCount, sumField(statistics.length ? statistics : tables, 'rows'))} />
            <Card label="Size" value={firstDisplay(payload.databaseSize, payload.size, firstField(files, 'size'))} />
            <Card label="Files" value={files.length || undefined} />
          </div>
          <ChipRows rows={files.length ? files : tables} labelKey="name" valueKey={files.length ? 'state' : 'rows'} />
        </section>
      ) : null}

      {(indexes.length || missingIndexes.length || statistics.length) ? (
        <section className="object-view-section" aria-label="SQL Server index posture">
          <SqlServerSectionHeading icon="index" title="Indexes" unit={`${indexes.length + missingIndexes.length} signal(s)`} />
          <div className="object-view-card-grid">
            <Card label="Indexes" value={firstDisplay(payload.indexCount, indexes.length || undefined)} />
            <Card label="Unique" value={countTruthy(indexes, 'unique')} />
            <Card label="Missing" value={missingIndexes.length || undefined} />
            <Card label="Scans" value={sumField(statistics, 'scans')} />
          </div>
          <ChipRows rows={missingIndexes.length ? missingIndexes : indexes} labelKey={missingIndexes.length ? 'table' : 'name'} valueKey={missingIndexes.length ? 'impact' : 'usage'} />
        </section>
      ) : null}

      {(sessions.length || locks.length || waits.length || queryStore.length) ? (
        <section className="object-view-section" aria-label="SQL Server workload posture">
          <SqlServerSectionHeading icon="job" title="Workload" unit="DMV" />
          <div className="object-view-card-grid">
            {sessions.length || payload.activeSessions ? (
              <Card label="Sessions" value={firstDisplay(payload.activeSessions, sessions.length || undefined)} />
            ) : null}
            {sessions.length || locks.length || payload.blockedSessions ? (
              <Card label="Blocked" value={firstDisplay(payload.blockedSessions, blockedCount(sessions, locks))} />
            ) : null}
            {waits.length ? <Card label="Waits" value={waits.length} /> : null}
            {queryStore.length ? <Card label="Query Store" value={queryStore.length} /> : null}
          </div>
          <ChipRows rows={queryStore.length ? queryStore : waits.length ? waits : sessions} labelKey={queryStore.length ? 'name' : waits.length ? 'waitType' : 'user'} valueKey={queryStore.length ? 'durationMs' : waits.length ? 'waitMs' : 'state'} />
        </section>
      ) : null}

      {(users.length || roles.length || permissions.length) ? (
        <section className="object-view-section" aria-label="SQL Server security posture">
          <SqlServerSectionHeading icon="security" title="Security" unit={`${users.length + roles.length} principal(s)`} />
          <div className="object-view-card-grid">
            <Card label="Users" value={users.length || undefined} />
            <Card label="Roles" value={roles.length || undefined} />
            <Card label="Grants" value={permissions.length || undefined} />
            <Card label="Auth" value={firstField(users, 'authenticationType')} />
          </div>
          <ChipRows rows={users.length ? users : permissions} labelKey={users.length ? 'name' : 'principal'} valueKey={users.length ? 'type' : 'privilege'} />
        </section>
      ) : null}

      {jobs.length ? (
        <section className="object-view-section" aria-label="SQL Server Agent posture">
          <SqlServerSectionHeading icon="job" title="Agent" unit={`${jobs.length} job(s)`} />
          <div className="object-view-card-grid">
            <Card label="Enabled" value={countTruthy(jobs, 'enabled')} />
            <Card label="Failed" value={countMatching(jobs, 'lastRun', 'failed')} />
            <Card label="Scheduled" value={countTruthy(jobs, 'scheduled')} />
            <Card label="Jobs" value={jobs.length} />
          </div>
          <ChipRows rows={jobs} labelKey="name" valueKey="lastRun" />
        </section>
      ) : null}
    </>
  )
}

function SqlServerSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: 'database' | 'index' | 'job' | 'security'
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
          : ObjectDatabaseIcon

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
  const count = rows.filter((row) => /true|yes|1|enabled|succeeded/i.test(display(row[key]))).length
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
  return ['table', 'index', 'view', 'procedure', 'function'].includes(kind) ? 'object' : 'database'
}
