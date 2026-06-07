import type { JsonRecord } from './RelationalObjectViewWorkspace.helpers'

export function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

export function firstRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function workloadChipRows({
  queryStore,
  forcedPlans,
  regressedQueries,
  statements,
  memoryGrants,
  ioStats,
  transactions,
  waits,
  sessions,
}: {
  queryStore: JsonRecord[]
  forcedPlans: JsonRecord[]
  regressedQueries: JsonRecord[]
  statements: JsonRecord[]
  memoryGrants: JsonRecord[]
  ioStats: JsonRecord[]
  transactions: JsonRecord[]
  waits: JsonRecord[]
  sessions: JsonRecord[]
}) {
  if (regressedQueries.length) {
    return {
      rows: regressedQueries,
      labelKey: firstField(regressedQueries, 'queryText') !== '-' ? 'queryText' : 'name',
      valueKey: 'regressionRatio',
    }
  }

  if (forcedPlans.length) {
    return {
      rows: forcedPlans,
      labelKey: firstField(forcedPlans, 'queryText') !== '-' ? 'queryText' : 'name',
      valueKey: 'forceFailureReason',
    }
  }

  if (queryStore.length) {
    return {
      rows: queryStore,
      labelKey: firstField(queryStore, 'queryText') !== '-' ? 'queryText' : 'name',
      valueKey: 'durationMs',
    }
  }

  if (statements.length) {
    return {
      rows: statements,
      labelKey: firstField(statements, 'query') !== '-' ? 'query' : 'queryHash',
      valueKey: 'durationMs',
    }
  }

  if (sessions.length) {
    return { rows: sessions, labelKey: 'user', valueKey: 'state' }
  }

  if (memoryGrants.length) {
    return { rows: memoryGrants, labelKey: 'sessionId', valueKey: 'requestedKb' }
  }

  if (ioStats.length) {
    return { rows: ioStats, labelKey: 'name', valueKey: 'ioStallMs' }
  }

  if (transactions.length) {
    return { rows: transactions, labelKey: 'id', valueKey: 'state' }
  }

  if (waits.length) {
    return { rows: waits, labelKey: 'waitType', valueKey: 'waitMs' }
  }

  return { rows: sessions, labelKey: 'user', valueKey: 'state' }
}

export function storageChipRows({
  files,
  filegroups,
  partitionSchemes,
  partitionFunctions,
  allocationUnits,
  tables,
}: {
  files: JsonRecord[]
  filegroups: JsonRecord[]
  partitionSchemes: JsonRecord[]
  partitionFunctions: JsonRecord[]
  allocationUnits: JsonRecord[]
  tables: JsonRecord[]
}) {
  if (files.length) {
    return { rows: files, labelKey: 'name', valueKey: 'state' }
  }

  if (filegroups.length) {
    return { rows: filegroups, labelKey: 'name', valueKey: 'sizeMb' }
  }

  if (partitionSchemes.length) {
    return { rows: partitionSchemes, labelKey: 'name', valueKey: 'function' }
  }

  if (partitionFunctions.length) {
    return { rows: partitionFunctions, labelKey: 'name', valueKey: 'fanout' }
  }

  if (allocationUnits.length) {
    return { rows: allocationUnits, labelKey: 'name', valueKey: 'usedMb' }
  }

  return { rows: tables, labelKey: 'name', valueKey: 'rows' }
}

export function securityChipRows({
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
}: {
  users: JsonRecord[]
  roles: JsonRecord[]
  roleMemberships: JsonRecord[]
  schemas: JsonRecord[]
  permissions: JsonRecord[]
  certificates: JsonRecord[]
  symmetricKeys: JsonRecord[]
  asymmetricKeys: JsonRecord[]
  credentials: JsonRecord[]
  audits: JsonRecord[]
}) {
  if (users.length) {
    return { rows: users, labelKey: 'name', valueKey: 'authenticationType' }
  }

  if (roles.length) {
    return { rows: roles, labelKey: 'name', valueKey: 'memberCount' }
  }

  if (roleMemberships.length) {
    return { rows: roleMemberships, labelKey: 'member', valueKey: 'role' }
  }

  if (schemas.length) {
    return { rows: schemas, labelKey: 'name', valueKey: 'owner' }
  }

  if (permissions.length) {
    return { rows: permissions, labelKey: 'principal', valueKey: 'privilege' }
  }

  if (certificates.length) {
    return { rows: certificates, labelKey: 'name', valueKey: 'status' }
  }

  if (symmetricKeys.length) {
    return { rows: symmetricKeys, labelKey: 'name', valueKey: 'algorithm' }
  }

  if (asymmetricKeys.length) {
    return { rows: asymmetricKeys, labelKey: 'name', valueKey: 'algorithm' }
  }

  if (credentials.length) {
    return { rows: credentials, labelKey: 'name', valueKey: 'identity' }
  }

  return { rows: audits, labelKey: 'name', valueKey: 'status' }
}

export function agentChipRows({
  jobs,
  schedules,
  alerts,
  operators,
  proxies,
  agentServices,
}: {
  jobs: JsonRecord[]
  schedules: JsonRecord[]
  alerts: JsonRecord[]
  operators: JsonRecord[]
  proxies: JsonRecord[]
  agentServices: JsonRecord[]
}) {
  if (jobs.length) {
    return { rows: jobs, labelKey: 'name', valueKey: 'lastRun' }
  }

  if (schedules.length) {
    return { rows: schedules, labelKey: 'name', valueKey: 'frequency' }
  }

  if (alerts.length) {
    return { rows: alerts, labelKey: 'name', valueKey: 'severity' }
  }

  if (operators.length) {
    return { rows: operators, labelKey: 'name', valueKey: 'email' }
  }

  if (proxies.length) {
    return { rows: proxies, labelKey: 'name', valueKey: 'credential' }
  }

  return { rows: agentServices, labelKey: 'name', valueKey: 'status' }
}

export function firstField(rows: JsonRecord[], key: string) {
  return firstDisplay(...rows.map((row) => row[key]))
}

export function firstDisplay(...values: unknown[]) {
  return values.find((value) => display(value) && display(value) !== '-')
}

export function sumField(rows: JsonRecord[], key: string) {
  const total = rows.reduce((sum, row) => {
    const value = Number(row[key])
    return Number.isFinite(value) ? sum + value : sum
  }, 0)
  return total || undefined
}

export function countTruthy(rows: JsonRecord[], key: string) {
  const count = rows.filter((row) => /true|yes|1|enabled|succeeded/i.test(display(row[key]))).length
  return rows.length ? `${count}/${rows.length}` : undefined
}

export function countMatching(rows: JsonRecord[], key: string, needle: string) {
  return rows.filter((row) => display(row[key]).toLowerCase().includes(needle)).length || undefined
}

export function blockedCount(sessions: JsonRecord[], locks: JsonRecord[]) {
  const blockedSessions = sessions.filter((row) => display(row.blockedBy) && display(row.blockedBy) !== '-').length
  const waitingLocks = locks.filter((row) => !/true|yes|1/i.test(display(row.granted))).length
  return blockedSessions + waitingLocks || undefined
}

export function display(value: unknown): string {
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

export function shorten(value: string) {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value
}

export function scopeLabel(kind: string) {
  return ['table', 'index', 'view', 'procedure', 'function'].includes(kind) ? 'object' : 'database'
}
