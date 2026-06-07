import {
  ObjectDatabaseIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectSecurityIcon,
} from './icons'
import {
  agentChipRows,
  blockedCount,
  countMatching,
  countTruthy,
  display,
  firstDisplay,
  firstField,
  firstRecord,
  records,
  scopeLabel,
  securityChipRows,
  shorten,
  storageChipRows,
  sumField,
  workloadChipRows,
} from './SqlServerObjectViewInsights.helpers'
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
  const queryStoreStatus = firstRecord(payload.queryStoreStatus)
  const forcedPlans = records(payload.forcedPlans)
  const regressedQueries = records(payload.regressedQueries)
  const statements = records(payload.statements)
  const ioStats = records(payload.ioStats)
  const memoryGrants = records(payload.memoryGrants)
  const transactions = records(payload.transactions)
  const eventSessions = records(payload.eventSessions)
  const eventSessionEvents = records(payload.eventSessionEvents)
  const eventTargets = records(payload.eventTargets)
  const sessions = records(payload.sessions)
  const locks = records(payload.locks)
  const waits = records(payload.waits)
  const users = records(payload.users)
  const roles = records(payload.roles)
  const roleMemberships = records(payload.roleMemberships)
  const schemas = records(payload.schemas)
  const permissions = records(payload.permissions)
  const certificates = records(payload.certificates)
  const symmetricKeys = records(payload.symmetricKeys)
  const asymmetricKeys = records(payload.asymmetricKeys)
  const credentials = records(payload.credentials)
  const audits = records(payload.audits)
  const files = records(payload.files)
  const filegroups = records(payload.filegroups)
  const partitionSchemes = records(payload.partitionSchemes)
  const partitionFunctions = records(payload.partitionFunctions)
  const partitionBoundaries = records(payload.partitionBoundaries)
  const allocationUnits = records(payload.allocationUnits)
  const agentServices = records(payload.agentServices)
  const jobs = records(payload.jobs)
  const schedules = records(payload.schedules)
  const alerts = records(payload.alerts)
  const operators = records(payload.operators)
  const proxies = records(payload.proxies)

  if (
    !tables.length &&
    !indexes.length &&
    !statistics.length &&
    !missingIndexes.length &&
    !queryStore.length &&
    !queryStoreStatus &&
    !forcedPlans.length &&
    !regressedQueries.length &&
    !statements.length &&
    !ioStats.length &&
    !memoryGrants.length &&
    !transactions.length &&
    !eventSessions.length &&
    !eventSessionEvents.length &&
    !eventTargets.length &&
    !sessions.length &&
    !locks.length &&
    !waits.length &&
    !users.length &&
    !roles.length &&
    !roleMemberships.length &&
    !schemas.length &&
    !permissions.length &&
    !certificates.length &&
    !symmetricKeys.length &&
    !asymmetricKeys.length &&
    !credentials.length &&
    !audits.length &&
    !files.length &&
    !filegroups.length &&
    !partitionSchemes.length &&
    !partitionFunctions.length &&
    !partitionBoundaries.length &&
    !allocationUnits.length &&
    !agentServices.length &&
    !jobs.length &&
    !schedules.length &&
    !alerts.length &&
    !operators.length &&
    !proxies.length
  ) {
    return null
  }

  return (
    <>
      {(tables.length ||
      statistics.length ||
      files.length ||
      filegroups.length ||
      partitionSchemes.length ||
      partitionFunctions.length ||
      allocationUnits.length) ? (
        <section className="object-view-section" aria-label="SQL Server storage posture">
          <SqlServerSectionHeading icon="database" title="Storage" unit={scopeLabel(kind)} />
          <div className="object-view-card-grid">
            <Card label="Tables" value={firstDisplay(payload.tableCount, tables.length || undefined)} />
            <Card label="Rows" value={firstDisplay(payload.rowCount, sumField(statistics.length ? statistics : tables, 'rows'))} />
            <Card label="Size" value={firstDisplay(payload.databaseSize, payload.size, firstField(files, 'size'))} />
            <Card label="Files" value={files.length || undefined} />
            <Card label="Filegroups" value={filegroups.length || undefined} />
            <Card label="Partitions" value={firstDisplay(partitionSchemes.length, partitionFunctions.length, partitionBoundaries.length)} />
            <Card label="Allocation" value={allocationUnits.length || undefined} />
          </div>
          <ChipRows {...storageChipRows({ files, filegroups, partitionSchemes, partitionFunctions, allocationUnits, tables })} />
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

      {(sessions.length ||
      locks.length ||
      waits.length ||
      queryStore.length ||
      queryStoreStatus ||
      forcedPlans.length ||
      regressedQueries.length ||
      statements.length ||
      ioStats.length ||
      memoryGrants.length ||
      transactions.length) ? (
        <section className="object-view-section" aria-label="SQL Server workload posture">
          <SqlServerSectionHeading icon="job" title="Workload" unit="DMV" />
          <div className="object-view-card-grid">
            {statements.length ? <Card label="Runtime Queries" value={statements.length} /> : null}
            {sessions.length || payload.activeSessions ? (
              <Card label="Sessions" value={firstDisplay(payload.activeSessions, sessions.length || undefined)} />
            ) : null}
            {sessions.length || locks.length || payload.blockedSessions ? (
              <Card label="Blocked" value={firstDisplay(payload.blockedSessions, blockedCount(sessions, locks))} />
            ) : null}
            {queryStoreStatus ? <Card label="Query Store" value={firstDisplay(queryStoreStatus.actualState, queryStoreStatus.desiredState)} /> : null}
            {queryStore.length ? <Card label="Top Queries" value={queryStore.length} /> : null}
            {forcedPlans.length ? <Card label="Forced Plans" value={forcedPlans.length} /> : null}
            {regressedQueries.length ? <Card label="Regressions" value={regressedQueries.length} /> : null}
            {statements.length ? <Card label="CPU ms" value={sumField(statements, 'cpuMs')} /> : null}
            {statements.length ? <Card label="Reads" value={sumField(statements, 'logicalReads')} /> : null}
            {memoryGrants.length ? <Card label="Memory Grants" value={memoryGrants.length} /> : null}
            {ioStats.length ? <Card label="I/O Files" value={ioStats.length} /> : null}
            {transactions.length ? <Card label="Transactions" value={transactions.length} /> : null}
            {!queryStore.length && !forcedPlans.length && !regressedQueries.length && waits.length ? <Card label="Waits" value={waits.length} /> : null}
          </div>
          <ChipRows
            {...workloadChipRows({
              queryStore,
              forcedPlans,
              regressedQueries,
              statements,
              memoryGrants,
              ioStats,
              transactions,
              waits,
              sessions,
            })}
          />
        </section>
      ) : null}

      {(eventSessions.length || eventSessionEvents.length || eventTargets.length) ? (
        <section className="object-view-section" aria-label="SQL Server Extended Events posture">
          <SqlServerSectionHeading icon="job" title="Extended Events" unit={`${eventSessions.length} session(s)`} />
          <div className="object-view-card-grid">
            <Card label="Sessions" value={firstDisplay(payload.eventSessionCount, eventSessions.length || undefined)} />
            <Card label="Running" value={firstDisplay(payload.runningEventSessions, countMatching(eventSessions, 'status', 'running'))} />
            <Card label="Events" value={eventSessionEvents.length || undefined} />
            <Card label="Targets" value={eventTargets.length || undefined} />
          </div>
          <ChipRows rows={eventTargets.length ? eventTargets : eventSessions} labelKey={eventTargets.length ? 'targetName' : 'name'} valueKey={eventTargets.length ? 'sessionName' : 'status'} />
        </section>
      ) : null}

      {(users.length ||
      roles.length ||
      roleMemberships.length ||
      schemas.length ||
      permissions.length ||
      certificates.length ||
      symmetricKeys.length ||
      asymmetricKeys.length ||
      credentials.length ||
      audits.length) ? (
        <section className="object-view-section" aria-label="SQL Server security posture">
          <SqlServerSectionHeading icon="security" title="Security" unit={`${users.length + roles.length} principal(s)`} />
          <div className="object-view-card-grid">
            <Card label="Users" value={users.length || undefined} />
            <Card label="Roles" value={roles.length || undefined} />
            <Card label="Schemas" value={schemas.length || undefined} />
            <Card label="Members" value={roleMemberships.length || undefined} />
            <Card label="Grants" value={permissions.length || undefined} />
            <Card label="Keys" value={symmetricKeys.length + asymmetricKeys.length || undefined} />
            <Card label="Credentials" value={credentials.length || undefined} />
            <Card label="Audits" value={audits.length || undefined} />
            <Card label="Auth" value={firstField(users, 'authenticationType')} />
          </div>
          <ChipRows
            {...securityChipRows({
              users,
              roles,
              roleMemberships,
              schemas,
              permissions,
              certificates,
              symmetricKeys,
              asymmetricKeys,
              credentials,
              audits,
            })}
          />
        </section>
      ) : null}

      {(agentServices.length || jobs.length || schedules.length || alerts.length || operators.length || proxies.length) ? (
        <section className="object-view-section" aria-label="SQL Server Agent posture">
          <SqlServerSectionHeading icon="job" title="Agent" unit={`${jobs.length} job(s)`} />
          <div className="object-view-card-grid">
            {agentServices.length ? <Card label="Service" value={firstField(agentServices, 'status')} /> : null}
            <Card label="Enabled" value={countTruthy(jobs, 'enabled')} />
            <Card label="Failed" value={countMatching(jobs, 'lastRun', 'failed')} />
            <Card label="Schedules" value={schedules.length || countTruthy(jobs, 'scheduled')} />
            <Card label="Alerts" value={alerts.length || undefined} />
            <Card label="Operators" value={operators.length || undefined} />
            <Card label="Proxies" value={proxies.length || undefined} />
            <Card label="Jobs" value={firstDisplay(payload.jobCount, jobs.length || undefined)} />
          </div>
          <ChipRows {...agentChipRows({ jobs, schedules, alerts, operators, proxies, agentServices })} />
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
