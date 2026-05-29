import {
  ObjectIndexIcon,
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
} from './icons'
import type { JsonRecord } from './RelationalObjectViewWorkspace.helpers'

interface MysqlObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function MysqlObjectViewInsights({ kind, payload }: MysqlObjectViewInsightsProps) {
  if (payload.engine !== 'mysql' && payload.engine !== 'mariadb') {
    return null
  }

  const tables = records(payload.tables)
  const indexes = records(payload.indexes)
  const statistics = records(payload.statistics)
  const users = records(payload.users)
  const roles = records(payload.roles)
  const permissions = records(payload.permissions)
  const sessions = records(payload.sessions)
  const slowQueries = records(payload.slowQueries)
  const innodbStatus = records(payload.innodbStatus)
  const replication = records(payload.replication)
  const engines = records(payload.engines)

  if (
    !tables.length &&
    !indexes.length &&
    !statistics.length &&
    !users.length &&
    !roles.length &&
    !permissions.length &&
    !sessions.length &&
    !slowQueries.length &&
    !innodbStatus.length &&
    !replication.length &&
    !engines.length
  ) {
    return null
  }

  return (
    <>
      {(tables.length || statistics.length || engines.length) ? (
        <section className="object-view-section" aria-label="MySQL storage posture">
          <MysqlSectionHeading icon="table" title="Storage" unit={engineLabel(payload)} />
          <div className="object-view-card-grid">
            <Card label="Tables" value={firstDisplay(payload.tableCount, tables.length || undefined)} />
            <Card label="Rows" value={sumField(statistics.length ? statistics : tables, 'rows')} />
            <Card label="Size" value={bytesLabel(firstDisplay(payload.databaseSize, payload.size, sumField(statistics, 'size')))} />
            <Card label="Engine" value={firstField(tables, 'engine') || firstField(engines, 'name')} />
          </div>
          <ChipRows rows={statistics.length ? statistics : tables} labelKey="name" valueKey="engine" />
        </section>
      ) : null}

      {indexes.length ? (
        <section className="object-view-section" aria-label="MySQL index posture">
          <MysqlSectionHeading icon="index" title="Indexes" unit={`${indexes.length} index(es)`} />
          <div className="object-view-card-grid">
            <Card label="Unique" value={countTruthy(indexes, 'unique')} />
            <Card label="BTREE" value={countMatching(indexes, 'type', 'btree')} />
            <Card label="FULLTEXT" value={countMatching(indexes, 'type', 'fulltext')} />
            <Card label="Cardinality" value={sumField(indexes, 'usage')} />
          </div>
          <ChipRows rows={indexes} labelKey="name" valueKey="columns" />
        </section>
      ) : null}

      {(users.length || roles.length || permissions.length) ? (
        <section className="object-view-section" aria-label="MySQL security posture">
          <MysqlSectionHeading icon="security" title="Security" unit={`${users.length + roles.length} principal(s)`} />
          <div className="object-view-card-grid">
            <Card label="Users" value={users.length || '-'} />
            <Card label="Roles" value={roles.length || '-'} />
            <Card label="Grants" value={permissions.length || '-'} />
            <Card label="Plugin" value={firstField(users, 'authenticationType')} />
          </div>
          <ChipRows rows={users.length ? users : permissions} labelKey="name" valueKey="host" />
        </section>
      ) : null}

      {(sessions.length || slowQueries.length || innodbStatus.length || replication.length) ? (
        <section className="object-view-section" aria-label="MySQL diagnostics posture">
          <MysqlSectionHeading icon="diagnostics" title="Diagnostics" unit={scopeLabel(kind)} />
          <div className="object-view-card-grid">
            <Card label="Sessions" value={firstDisplay(payload.activeSessions, sessions.length || undefined)} />
            <Card label="Slow Queries" value={slowQueries.length || '-'} />
            <Card label="InnoDB" value={firstField(innodbStatus, 'status')} />
            <Card label="Replica Lag" value={firstField(replication, 'lagSeconds')} />
          </div>
          <ChipRows rows={slowQueries.length ? slowQueries : innodbStatus} labelKey={slowQueries.length ? 'digest' : 'name'} valueKey={slowQueries.length ? 'avgMs' : 'value'} />
        </section>
      ) : null}
    </>
  )
}

function MysqlSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: 'table' | 'index' | 'security' | 'diagnostics'
  title: string
  unit?: string
}) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
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
  return rows.length ? `${count}/${rows.length}` : '-'
}

function countMatching(rows: JsonRecord[], key: string, needle: string) {
  return rows.filter((row) => display(row[key]).toLowerCase().includes(needle)).length || '-'
}

function bytesLabel(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return display(value)
  }
  if (numeric >= 1024 * 1024 * 1024) {
    return `${(numeric / 1024 / 1024 / 1024).toFixed(1)} GB`
  }
  if (numeric >= 1024 * 1024) {
    return `${(numeric / 1024 / 1024).toFixed(1)} MB`
  }
  if (numeric >= 1024) {
    return `${(numeric / 1024).toFixed(1)} KB`
  }
  return `${numeric.toLocaleString()} B`
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

function engineLabel(payload: JsonRecord) {
  return payload.engine === 'mariadb' ? 'MariaDB' : 'MySQL'
}

function scopeLabel(kind: string) {
  return kind === 'diagnostics' ? 'server' : kind
}
