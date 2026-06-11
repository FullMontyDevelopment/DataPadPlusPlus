import {
  ObjectIndexIcon,
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
} from '../../../icons'
import type { JsonRecord } from './RelationalObjectViewWorkspace.helpers'

interface MysqlObjectViewInsightsProps {
  kind: string
  payload: JsonRecord
}

export function MysqlObjectViewInsights({ kind, payload }: MysqlObjectViewInsightsProps) {
  if (payload.engine !== 'mysql' && payload.engine !== 'mariadb') {
    return null
  }

  const label = engineLabel(payload)
  const tables = records(payload.tables)
  const indexes = records(payload.indexes)
  const statistics = records(payload.statistics)
  const diagnosticView = isDiagnosticView(kind)
  const storageStatistics = diagnosticView ? [] : statistics
  const explicitStatusCounters = records(payload.statusCounters)
  const statusCounters = explicitStatusCounters.length
    ? explicitStatusCounters
    : diagnosticView
      ? statistics
      : []
  const users = records(payload.users)
  const roles = records(payload.roles)
  const roleMappings = records(payload.roleMappings)
  const permissions = records(payload.permissions)
  const sessions = records(payload.sessions)
  const slowQueries = records(payload.slowQueries)
  const statementDigests = records(payload.statementDigests)
  const tableIo = records(payload.tableIo)
  const metadataLocks = records(payload.metadataLocks)
  const optimizerTrace = records(payload.optimizerTrace)
  const serverVariables = records(payload.serverVariables)
  const analyzeProfile = records(payload.analyzeProfile)
  const innodbStatus = records(payload.innodbStatus)
  const replication = records(payload.replication)
  const engines = records(payload.engines)

  if (
    !tables.length &&
    !indexes.length &&
    !statistics.length &&
    !users.length &&
    !roles.length &&
    !roleMappings.length &&
    !permissions.length &&
    !sessions.length &&
    !slowQueries.length &&
    !statementDigests.length &&
    !tableIo.length &&
    !metadataLocks.length &&
    !optimizerTrace.length &&
    !serverVariables.length &&
    !analyzeProfile.length &&
    !innodbStatus.length &&
    !replication.length &&
    !engines.length
  ) {
    return null
  }

  return (
    <>
      {(tables.length || storageStatistics.length || engines.length) ? (
        <section className="object-view-section" aria-label={`${label} storage posture`}>
          <MysqlSectionHeading icon="table" title="Storage" unit={label} />
          <div className="object-view-card-grid">
            <Card label="Tables" value={firstDisplay(payload.tableCount, tables.length || undefined)} />
            <Card label="Rows" value={sumField(storageStatistics.length ? storageStatistics : tables, 'rows')} />
            <Card label="Size" value={bytesLabel(firstDisplay(payload.databaseSize, payload.size, sumField(storageStatistics, 'size')))} />
            <Card label="Engine" value={firstField(tables, 'engine') || firstField(engines, 'name')} />
          </div>
          <ChipRows rows={storageStatistics.length ? storageStatistics : tables} labelKey="name" valueKey="engine" />
        </section>
      ) : null}

      {indexes.length ? (
        <section className="object-view-section" aria-label={`${label} index posture`}>
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

      {(users.length || roles.length || roleMappings.length || permissions.length) ? (
        <section className="object-view-section" aria-label={`${label} security posture`}>
          <MysqlSectionHeading icon="security" title="Security" unit={`${users.length + roles.length} principal(s)`} />
          <div className="object-view-card-grid">
            <Card label="Users" value={users.length || '-'} />
            <Card label="Roles" value={roles.length || '-'} />
            <Card label="Role Mappings" value={roleMappings.length || '-'} />
            <Card label="Grants" value={permissions.length || '-'} />
          </div>
          <ChipRows rows={users.length ? users : roles.length ? roles : roleMappings.length ? roleMappings : permissions} labelKey="name" valueKey={roleMappings.length && !users.length && !roles.length ? 'member' : 'host'} />
        </section>
      ) : null}

      {(sessions.length || slowQueries.length || statusCounters.length || serverVariables.length || analyzeProfile.length || innodbStatus.length || replication.length) ? (
        <section className="object-view-section" aria-label={`${label} diagnostics posture`}>
          <MysqlSectionHeading icon="diagnostics" title="Diagnostics" unit={scopeLabel(kind)} />
          <div className="object-view-card-grid">
            <Card label="Sessions" value={firstDisplay(payload.activeSessions, sessions.length || undefined)} />
            <Card label="Statements" value={firstDisplay(statementDigests.length || undefined, slowQueries.length || undefined)} />
            <Card label={payload.engine === 'mariadb' ? 'SQL Mode' : 'Status'} value={payload.engine === 'mariadb' ? firstDisplay(variableValue(serverVariables, 'sql_mode'), firstStatusCounter(statusCounters)) : firstStatusCounter(statusCounters)} />
            <Card label="Locks" value={pendingLocks(metadataLocks)} />
          </div>
          <ChipRows
            rows={slowQueries.length ? slowQueries : statusCounters.length ? statusCounters : innodbStatus}
            labelKey={slowQueries.length ? 'digest' : 'name'}
            valueKey={slowQueries.length ? 'avgMs' : statusCounters.length ? 'rows' : 'value'}
          />
        </section>
      ) : null}

      {serverVariables.length ? (
        <section className="object-view-section" aria-label={`${label} server variables posture`}>
          <MysqlSectionHeading icon="diagnostics" title="Server Variables" unit={label} />
          <div className="object-view-card-grid">
            <Card label="Version" value={variableValue(serverVariables, 'version')} />
            <Card label="Comment" value={variableValue(serverVariables, 'version_comment')} />
            <Card label="SQL Mode" value={variableValue(serverVariables, 'sql_mode')} />
            <Card label="Default Engine" value={variableValue(serverVariables, 'default_storage_engine')} />
          </div>
          <ChipRows rows={serverVariables} labelKey="name" valueKey="value" />
        </section>
      ) : null}

      {analyzeProfile.length ? (
        <section className="object-view-section" aria-label={`${label} analyze profile posture`}>
          <MysqlSectionHeading icon="diagnostics" title="ANALYZE FORMAT=JSON" unit={label} />
          <div className="object-view-card-grid">
            <Card label="Status" value={firstField(analyzeProfile, 'status')} />
            <Card label="Profile" value={firstField(analyzeProfile, 'name')} />
            <Card label="Query" value={firstField(analyzeProfile, 'queryTemplate')} />
          </div>
          <ChipRows rows={analyzeProfile} labelKey="name" valueKey="status" />
        </section>
      ) : null}

      {(statementDigests.length || tableIo.length || metadataLocks.length || optimizerTrace.length || analyzeProfile.length) ? (
        <section className="object-view-section" aria-label={`${label} performance schema posture`}>
          <MysqlSectionHeading icon="diagnostics" title={payload.engine === 'mariadb' ? 'Performance / Profile' : 'Performance Schema'} unit={label} />
          <div className="object-view-card-grid">
            <Card label="Digests" value={statementDigests.length || '-'} />
            <Card label="Table I/O" value={tableIo.length || '-'} />
            <Card label="Metadata Locks" value={metadataLocks.length || '-'} />
            <Card label={payload.engine === 'mariadb' ? 'ANALYZE Profile' : 'Optimizer Trace'} value={payload.engine === 'mariadb' ? firstField(analyzeProfile, 'status') : firstField(optimizerTrace, 'enabled')} />
          </div>
          <ChipRows
            rows={statementDigests.length ? statementDigests : tableIo.length ? tableIo : metadataLocks}
            labelKey={statementDigests.length ? 'digest' : tableIo.length ? 'table' : 'object'}
            valueKey={statementDigests.length ? 'avgMs' : tableIo.length ? 'totalMs' : 'status'}
          />
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

function pendingLocks(rows: JsonRecord[]) {
  if (!rows.length) return '-'
  const pending = rows.filter((row) => display(row.status).toLowerCase().includes('pending')).length
  return pending ? `${pending}/${rows.length}` : `0/${rows.length}`
}

function firstStatusCounter(rows: JsonRecord[]) {
  if (!rows.length) {
    return undefined
  }

  const threads = rows.find((row) => /threads_running/i.test(display(row.name)))
  const slowQueries = rows.find((row) => /slow_queries/i.test(display(row.name)))
  return display(threads?.rows ?? threads?.value ?? slowQueries?.rows ?? slowQueries?.value)
}

function variableValue(rows: JsonRecord[], name: string) {
  return display(rows.find((row) => display(row.name).toLowerCase() === name.toLowerCase())?.value)
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

function isDiagnosticView(kind: string) {
  return [
    'diagnostics',
    'sessions',
    'statistics',
    'status-counters',
    'slow-queries',
    'performance-schema',
    'metadata-locks',
    'optimizer-trace',
    'server-variables',
    'storage-engines',
    'analyze-profile',
    'innodb-status',
    'replication',
  ].includes(kind)
}
