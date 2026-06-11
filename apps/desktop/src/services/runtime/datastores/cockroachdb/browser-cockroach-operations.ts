export function cockroachOperationRequest(
  operationId: string,
  objectName: string,
  parameters: Record<string, unknown> = {},
) {
  if (operationId.endsWith('data.import-export')) {
    return cockroachImportExportRequest(objectName, parameters)
  }

  if (operationId.endsWith('data.backup-restore')) {
    return cockroachBackupRestoreRequest(objectName, parameters)
  }

  if (operationId.endsWith('cockroach.jobs')) {
    return 'show jobs;'
  }

  if (operationId.endsWith('cockroach.ranges')) {
    return 'select * from crdb_internal.ranges_no_leases limit 100;'
  }

  if (operationId.endsWith('cockroach.regions')) {
    return 'show regions;\nshow localities;'
  }

  if (operationId.endsWith('cockroach.sessions')) {
    return 'show sessions;'
  }

  if (operationId.endsWith('cockroach.contention')) {
    return 'show sessions;\nselect * from crdb_internal.cluster_locks limit 100;\nselect * from crdb_internal.cluster_contention_events limit 100;'
  }

  if (operationId.endsWith('cockroach.roles-grants')) {
    return cockroachRolesAndGrantsRequest(objectName, parameters)
  }

  if (operationId.endsWith('cockroach.backup')) {
    return cockroachBackupRestoreRequest(objectName, { ...parameters, mode: 'backup' })
  }

  if (operationId.endsWith('cockroach.restore')) {
    return cockroachBackupRestoreRequest(objectName, { ...parameters, mode: 'restore' })
  }

  if (operationId.endsWith('cockroach.export')) {
    return cockroachImportExportRequest(objectName, { ...parameters, mode: 'export' })
  }

  if (operationId.endsWith('cockroach.import')) {
    return cockroachImportExportRequest(objectName, { ...parameters, mode: 'import' })
  }

  if (operationId.endsWith('cockroach.zone-configs')) {
    return cockroachZoneConfigRequest(objectName, parameters)
  }

  return undefined
}

function cockroachImportExportRequest(
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const mode = String(parameters.mode ?? 'export').toLowerCase()
  const format = String(parameters.format ?? 'csv').toLowerCase()
  const externalUri = sqlStringLiteral(stringParameter(parameters, 'externalUri') ?? `external://${mode}-location/data.${format}`)
  const target = stringParameter(parameters, 'table') ?? objectName

  if (['import', 'append', 'insert'].includes(mode)) {
    const skipRows = numericParameter(parameters, 'skipRows') ?? 1
    return [
      '-- CockroachDB IMPORT is preview-first until external storage and target schema validation pass.',
      `import into ${target} ${format} data (${externalUri}) with skip = '${skipRows}';`,
      'show jobs;',
    ].join('\n')
  }

  return [
    '-- CockroachDB EXPORT scans the selected query and writes to external storage.',
    `export into ${format} ${externalUri} from select * from ${target};`,
    'show jobs;',
  ].join('\n')
}

function cockroachBackupRestoreRequest(
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const mode = String(parameters.mode ?? 'backup').toLowerCase()
  const database = stringParameter(parameters, 'database') ?? objectName
  const externalUri = sqlStringLiteral(stringParameter(parameters, 'externalUri') ?? 'external://backup-location')

  if (mode === 'restore') {
    return [
      '-- CockroachDB RESTORE is destructive and remains preview-first.',
      `restore database ${database} from ${externalUri};`,
      'show jobs;',
    ].join('\n')
  }

  const options = [
    booleanParameter(parameters, 'includeRevisionHistory') === false ? undefined : 'revision_history',
    booleanParameter(parameters, 'detached') === false ? undefined : 'detached',
  ].filter(Boolean)
  const withClause = options.length ? ` with ${options.join(', ')}` : ''
  return [
    '-- CockroachDB BACKUP can consume cluster and external storage resources.',
    `backup database ${database} into ${externalUri}${withClause};`,
    'show jobs;',
  ].join('\n')
}

function cockroachRolesAndGrantsRequest(
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const roleName = stringParameter(parameters, 'roleName') ?? '<role>'
  return [
    'show roles;',
    'show grants;',
    'show default privileges;',
    `show grants on ${objectName};`,
    `-- Optional membership preview: grant ${quoteCockroachIdentifier(roleName)} to <member_role>;`,
  ].join('\n')
}

function cockroachZoneConfigRequest(
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const numReplicas = numericParameter(parameters, 'numReplicas')
  const constraints = stringParameter(parameters, 'constraints')
  const leasePreferences = stringParameter(parameters, 'leasePreferences')
  const gcTtlSeconds = numericParameter(parameters, 'gcTtlSeconds')
  const zoneParts = [
    numReplicas === undefined ? undefined : `num_replicas = ${numReplicas}`,
    constraints ? `constraints = ${sqlStringLiteral(constraints)}` : undefined,
    leasePreferences ? `lease_preferences = ${sqlStringLiteral(leasePreferences)}` : undefined,
    gcTtlSeconds === undefined ? undefined : `gc.ttlseconds = ${gcTtlSeconds}`,
  ].filter(Boolean)

  return [
    `show zone configuration for ${objectName};`,
    zoneParts.length
      ? `-- Preview only: alter ${objectName} configure zone using ${zoneParts.join(', ')};`
      : '-- Preview only: provide placement intent before ALTER ... CONFIGURE ZONE.',
  ].join('\n')
}

function stringParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numericParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function booleanParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'boolean' ? value : undefined
}

function sqlStringLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function quoteCockroachIdentifier(value: string) {
  if (value.startsWith('<') && value.endsWith('>')) {
    return value
  }
  return `"${value.replace(/"/g, '""')}"`
}
