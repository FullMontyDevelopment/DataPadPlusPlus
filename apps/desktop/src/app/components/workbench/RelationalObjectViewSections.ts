export type RelationalSectionIcon = 'table' | 'index' | 'security' | 'job'
export type RelationalSectionCandidate = {
  key: string
  title: string
  columns: string[]
  emptyText: string
  icon: RelationalSectionIcon
}

export function sectionCandidates(kind: string) {
  const common = [
    section('databases', 'Databases', ['name', 'state', 'owner', 'size', 'readOnly'], 'No databases were returned.'),
    section('schemas', 'Schemas', ['name', 'owner', 'type', 'objectCount'], 'No schemas were returned.'),
    section('tables', 'Tables', ['schema', 'name', 'type', 'rows', 'size', 'owner'], 'No tables were returned.'),
    section('views', 'Views', ['schema', 'name', 'definition', 'status'], 'No views were returned.'),
    section('pragmas', 'Pragmas', ['name', 'value', 'status', 'detail'], 'No PRAGMA rows were returned.'),
    section('attachedDatabases', 'Attached Databases', ['seq', 'name', 'file', 'status'], 'No attached databases were returned.'),
    section('schemaObjects', 'Schema Objects', ['type', 'name', 'tableName', 'definition'], 'No schema objects were returned.'),
    section('virtualTables', 'Virtual Tables', ['schema', 'name', 'module', 'detail'], 'No virtual tables were returned.'),
    section('generatedColumns', 'Generated Columns', ['table', 'name', 'type', 'generated', 'hidden'], 'No generated columns were returned.'),
    section('materializedViews', 'Materialized Views', ['schema', 'name', 'rows', 'size', 'lastRefresh'], 'No materialized views were returned.'),
    section('hypertables', 'Hypertables', ['schema', 'name', 'timeColumn', 'dimensions', 'chunks', 'compressed', 'retention', 'size'], 'No hypertables were returned.'),
    section('chunks', 'Chunks', ['hypertable', 'chunk', 'rangeStart', 'rangeEnd', 'compressed', 'size'], 'No chunks were returned.'),
    section('compressionPolicies', 'Compression Policies', ['hypertable', 'enabled', 'segmentBy', 'orderBy', 'policy'], 'No compression policies were returned.', 'job'),
    section('retentionPolicies', 'Retention Policies', ['hypertable', 'window', 'jobStatus', 'lastRun'], 'No retention policies were returned.', 'job'),
    section('continuousAggregates', 'Continuous Aggregates', ['schema', 'name', 'source', 'bucket', 'materializedOnly', 'lastRefresh', 'lag'], 'No continuous aggregates were returned.'),
    section('columns', 'Columns', ['name', 'type', 'nullable', 'default', 'identity', 'collation'], 'No columns were returned.'),
    section('indexes', 'Indexes', ['name', 'type', 'columns', 'unique', 'valid', 'size', 'usage'], 'No indexes were returned.', 'index'),
    section('constraints', 'Constraints', ['name', 'type', 'columns', 'status', 'definition'], 'No constraints were returned.'),
    section('triggers', 'Triggers', ['name', 'timing', 'event', 'enabled', 'function'], 'No triggers were returned.'),
    section('foreignKeys', 'Foreign Keys', ['id', 'from', 'table', 'to', 'onUpdate', 'onDelete'], 'No foreign keys were returned.'),
    section('parameters', 'Parameters', ['name', 'type', 'mode', 'default', 'ordinal'], 'No parameters were returned.'),
    section('dependencies', 'Dependencies', ['name', 'type', 'referencedName', 'referencedType', 'direction'], 'No dependencies were returned.'),
    section('partitions', 'Partitions', ['name', 'number', 'rows', 'range', 'compression', 'size'], 'No partitions were returned.'),
    section('functions', 'Functions', ['schema', 'name', 'arguments', 'returns', 'language', 'volatility'], 'No functions were returned.'),
    section('procedures', 'Procedures', ['schema', 'name', 'arguments', 'language', 'security'], 'No procedures were returned.'),
    section('routines', 'Routines', ['schema', 'name', 'type', 'arguments', 'returns', 'language'], 'No routines were returned.'),
    section('events', 'Events', ['schema', 'name', 'status', 'schedule', 'lastExecuted', 'definer'], 'No events were returned.', 'job'),
    section('sequences', 'Sequences', ['schema', 'name', 'dataType', 'increment', 'cache', 'cycles'], 'No sequences were returned.'),
    section('types', 'Types', ['schema', 'name', 'type', 'owner'], 'No types were returned.'),
    section('extensions', 'Extensions', ['name', 'version', 'defaultVersion', 'status', 'schema', 'updateAvailable', 'description'], 'No extensions were returned.'),
    section('extensionObjects', 'Extension Objects', ['extension', 'catalog', 'object', 'dependency'], 'No extension-owned objects were returned.'),
    section('statistics', 'Statistics', ['name', 'rows', 'scans', 'lastVacuum', 'lastAnalyze', 'size'], 'No statistics were returned.'),
    section('checks', 'Checks', ['name', 'status', 'detail'], 'No checks were returned.'),
    section('maintenance', 'Maintenance', ['name', 'scope', 'status', 'risk'], 'No maintenance workflows were returned.', 'job'),
    section('histograms', 'Histograms', ['name', 'step', 'rangeHiKey', 'equalRows', 'rangeRows', 'distinctRangeRows'], 'No histogram rows were returned.'),
    section('permissions', 'Permissions', ['principal', 'privilege', 'object', 'objectKind', 'state', 'grantable', 'grantor'], 'No permissions were returned.', 'security'),
    section('grants', 'Grants', ['principal', 'privilege', 'object', 'objectKind', 'state', 'grantable', 'grantor'], 'No grants were returned.', 'security'),
    section('roles', 'Roles', ['name', 'login', 'superuser', 'inherit', 'createRole', 'createDb', 'memberships', 'memberCount'], 'No roles were returned.', 'security'),
    section('roleMemberships', 'Role Memberships', ['role', 'member', 'memberOf', 'memberType', 'adminOption', 'grantor'], 'No role memberships were returned.', 'security'),
    section('roleMappings', 'Role Mappings', ['name', 'host', 'member', 'memberHost', 'adminOption', 'memberships'], 'No role mappings were returned.', 'security'),
    section('defaultPrivileges', 'Default Privileges', ['schema', 'owner', 'objectKind', 'principal', 'privilege', 'state', 'grantable', 'grantor'], 'No default privileges were returned.', 'security'),
    section('users', 'Users', ['name', 'host', 'type', 'defaultSchema', 'authenticationType', 'login', 'accountLocked'], 'No users were returned.', 'security'),
    section('certificates', 'Certificates', ['name', 'subject', 'issuer', 'expires', 'privateKey', 'status'], 'No certificates were returned.', 'security'),
    section('symmetricKeys', 'Symmetric Keys', ['name', 'algorithm', 'keyLength', 'owner', 'created', 'modified'], 'No symmetric keys were returned.', 'security'),
    section('asymmetricKeys', 'Asymmetric Keys', ['name', 'algorithm', 'keyLength', 'owner', 'privateKey', 'created', 'modified'], 'No asymmetric keys were returned.', 'security'),
    section('credentials', 'Credentials', ['name', 'identity', 'provider', 'created', 'modified'], 'No credentials were returned.', 'security'),
    section('audits', 'Audit Specifications', ['name', 'status', 'audit', 'actionCount', 'created', 'modified'], 'No audit specifications were returned.', 'security'),
    section('replication', 'Replication', ['channel', 'role', 'state', 'lagSeconds', 'sourceHost', 'gtid'], 'No replication rows were returned.', 'job'),
    section('statusCounters', 'Status Counters', ['name', 'value', 'rows', 'status', 'detail'], 'No status counters were returned.', 'job'),
    section('slowQueries', 'Slow Queries', ['digest', 'count', 'avgMs', 'maxMs', 'rowsExamined'], 'No slow-query rows were returned.', 'job'),
    section('statementDigests', 'Statement Digests', ['schema', 'digestId', 'digest', 'count', 'totalMs', 'avgMs', 'maxMs', 'rowsExamined', 'rowsSent', 'fullScans'], 'No statement digest rows were returned.', 'job'),
    section('tableIo', 'Table / Index I/O', ['schema', 'table', 'index', 'operations', 'reads', 'writes', 'totalMs'], 'No table/index I/O rows were returned.', 'job'),
    section('metadataLocks', 'Metadata Locks', ['schema', 'object', 'type', 'lockType', 'duration', 'status', 'sessionId', 'user'], 'No metadata locks were returned.', 'job'),
    section('optimizerTrace', 'Optimizer Trace', ['name', 'enabled', 'traceLimit', 'maxMemSize', 'recentTraceCount'], 'No optimizer trace rows were returned.', 'job'),
    section('serverVariables', 'Server Variables', ['name', 'value', 'status', 'detail'], 'No server variables were returned.', 'job'),
    section('analyzeProfile', 'ANALYZE FORMAT=JSON', ['name', 'status', 'detail', 'queryTemplate'], 'No ANALYZE profile rows were returned.', 'job'),
    section('innodbStatus', 'InnoDB Status', ['name', 'value', 'status', 'detail'], 'No InnoDB status rows were returned.', 'job'),
    section('nodes', 'Nodes', ['nodeId', 'address', 'locality', 'ranges', 'liveBytes', 'status'], 'No nodes were returned.', 'job'),
    section('ranges', 'Ranges', ['rangeId', 'table', 'replicas', 'leaseholder', 'qps', 'size'], 'No ranges were returned.', 'job'),
    section('regions', 'Regions / Localities', ['region', 'locality', 'nodes', 'survivalGoal', 'constraints'], 'No regions were returned.', 'job'),
    section('agentServices', 'Agent Service', ['name', 'status', 'startupType', 'processId', 'lastStartup'], 'No Agent service rows were returned.', 'job'),
    section('jobs', 'Jobs', ['name', 'id', 'type', 'jobType', 'object', 'status', 'enabled', 'scheduled', 'lastRun', 'nextRun', 'created', 'modified'], 'No jobs were returned.', 'job'),
    section('schedules', 'Schedules', ['name', 'enabled', 'frequency', 'activeStart', 'activeEnd', 'jobCount'], 'No schedules were returned.', 'job'),
    section('alerts', 'Alerts', ['name', 'enabled', 'severity', 'messageId', 'databaseName', 'lastOccurrence', 'delaySeconds'], 'No alerts were returned.', 'job'),
    section('operators', 'Operators', ['name', 'enabled', 'email', 'pager', 'netSend', 'lastEmail'], 'No operators were returned.', 'security'),
    section('proxies', 'Proxies', ['name', 'enabled', 'credential', 'subsystemCount', 'description'], 'No proxies were returned.', 'security'),
    section('contention', 'Contention', ['key', 'table', 'waiter', 'durationMs', 'blockingTxn'], 'No contention rows were returned.', 'job'),
    section('transactions', 'Transactions', ['id', 'state', 'age', 'ageSeconds', 'priority', 'retries', 'logRecords', 'logBytesUsed'], 'No transactions were returned.', 'job'),
    section('statements', 'Statement Stats', ['query', 'queryText', 'durationMs', 'avgMs', 'cpuMs', 'logicalReads', 'executions', 'lastExecutionTime', 'count', 'meanMs', 'p99Ms', 'rows', 'retries'], 'No statement stats were returned.', 'job'),
    section('clusterSettings', 'Cluster Settings', ['name', 'value', 'type', 'description'], 'No cluster settings were returned.'),
    section('zoneConfigurations', 'Zone Configurations', ['target', 'numReplicas', 'constraints', 'leasePreferences', 'gcTtlSeconds'], 'No zone configurations were returned.'),
    section('sessions', 'Sessions', ['pid', 'sessionId', 'user', 'database', 'state', 'command', 'wait', 'blockedBy', 'elapsedMs', 'cpuMs', 'logicalReads'], 'No sessions were returned.', 'job'),
    section('locks', 'Locks', ['pid', 'sessionId', 'object', 'mode', 'granted', 'blocking'], 'No locks were returned.', 'job'),
    section('queryStore', 'Query Store', ['name', 'status', 'durationMs', 'executions', 'planState'], 'No Query Store rows were returned.', 'job'),
    section('eventSessions', 'Extended Events Sessions', ['name', 'scope', 'status', 'startupState', 'eventCount', 'targetCount', 'retentionMode', 'startedAt'], 'No Extended Events sessions were returned.', 'job'),
    section('eventSessionEvents', 'Extended Events', ['sessionName', 'eventName', 'scope', 'package', 'predicate', 'actionCount'], 'No Extended Events definitions were returned.', 'job'),
    section('eventTargets', 'Extended Events Targets', ['sessionName', 'targetName', 'scope', 'package', 'executionCount', 'droppedEventCount', 'targetDataAvailable'], 'No Extended Events targets were returned.', 'job'),
    section('waits', 'Waits', ['waitType', 'waitingTasks', 'waitMs', 'signalWaitMs', 'resource'], 'No wait stats were returned.', 'job'),
    section('ioStats', 'I/O Stats', ['name', 'type', 'reads', 'readMb', 'writes', 'writeMb', 'ioStallMs', 'readStallMs'], 'No SQL Server file I/O stats were returned.', 'job'),
    section('memoryGrants', 'Memory Grants', ['sessionId', 'requestId', 'requestedKb', 'grantedKb', 'usedKb', 'maxUsedKb', 'waitMs', 'dop'], 'No active memory grants were returned.', 'job'),
    section('missingIndexes', 'Missing Indexes', ['table', 'equalityColumns', 'inequalityColumns', 'includedColumns', 'impact'], 'No missing-index hints were returned.', 'index'),
    section('indexHealth', 'Index Health', ['table', 'index', 'scans', 'tuplesRead', 'tuplesFetched', 'bloatRisk', 'lastVacuum'], 'No index-health rows were returned.', 'index'),
    section('files', 'Files', ['name', 'type', 'size', 'growth', 'maxSize', 'state', 'dataSpace', 'physicalName'], 'No files were returned.'),
    section('filegroups', 'Filegroups', ['name', 'type', 'default', 'readOnly', 'fileCount', 'sizeMb'], 'No filegroups were returned.'),
    section('partitionSchemes', 'Partition Schemes', ['name', 'function', 'destinationCount', 'dataSpaces'], 'No partition schemes were returned.'),
    section('partitionFunctions', 'Partition Functions', ['name', 'type', 'fanout', 'boundary', 'created', 'modified'], 'No partition functions were returned.'),
    section('partitionBoundaries', 'Partition Boundaries', ['partitionFunction', 'boundary', 'value', 'rangeSide'], 'No partition boundaries were returned.'),
    section('allocationUnits', 'Allocation Units', ['name', 'type', 'totalMb', 'usedMb', 'dataMb'], 'No allocation rows were returned.'),
    section('engines', 'Storage Engines', ['name', 'support', 'transactions', 'xa', 'savepoints'], 'No storage engines were returned.'),
  ]

  if (kind === 'cluster') {
    return common.filter((candidate) => ['nodes', 'ranges', 'regions', 'jobs', 'clusterSettings'].includes(candidate.key))
  }

  if (kind === 'diagnostics') {
    return common.filter((candidate) =>
      ['sessions', 'locks', 'statistics', 'statusCounters', 'queryStore', 'eventSessions', 'eventSessionEvents', 'eventTargets', 'agentServices', 'statements', 'transactions', 'contention', 'waits', 'ioStats', 'memoryGrants', 'missingIndexes', 'indexHealth', 'slowQueries', 'statementDigests', 'tableIo', 'metadataLocks', 'optimizerTrace', 'serverVariables', 'analyzeProfile', 'innodbStatus', 'replication', 'hypertables', 'chunks', 'compressionPolicies', 'retentionPolicies', 'continuousAggregates', 'jobs', 'engines'].includes(candidate.key),
    )
  }

  if (['hypertables', 'hypertable'].includes(kind)) {
    return common.filter((candidate) =>
      ['hypertables', 'chunks', 'compressionPolicies', 'retentionPolicies', 'indexes', 'statistics'].includes(candidate.key),
    )
  }

  if (['chunks', 'chunk', 'compression', 'retention'].includes(kind)) {
    return common.filter((candidate) =>
      ['chunks', 'compressionPolicies', 'retentionPolicies', 'jobs', 'statistics'].includes(candidate.key),
    )
  }

  if (['continuous-aggregates', 'continuous-aggregate'].includes(kind)) {
    return common.filter((candidate) =>
      ['continuousAggregates', 'materializedViews', 'jobs', 'statistics'].includes(candidate.key),
    )
  }

  if (kind === 'sessions') {
    return common.filter((candidate) => ['sessions', 'locks', 'waits'].includes(candidate.key))
  }

  if (kind === 'locks') {
    return common.filter((candidate) => ['locks', 'sessions'].includes(candidate.key))
  }

  if (kind === 'waits') {
    return common.filter((candidate) => ['waits', 'sessions'].includes(candidate.key))
  }

  if (kind === 'statements') {
    return common.filter((candidate) => ['statements', 'sessions', 'memoryGrants', 'statistics'].includes(candidate.key))
  }

  if (kind === 'slow-queries') {
    return common.filter((candidate) => ['slowQueries', 'statementDigests', 'statistics', 'statusCounters'].includes(candidate.key))
  }

  if (kind === 'performance-schema') {
    return orderedSections(common, ['statementDigests', 'tableIo', 'metadataLocks', 'optimizerTrace', 'statistics'])
  }

  if (kind === 'metadata-locks') {
    return orderedSections(common, ['metadataLocks', 'sessions'])
  }

  if (kind === 'optimizer-trace') {
    return orderedSections(common, ['optimizerTrace', 'statementDigests'])
  }

  if (kind === 'server-variables') {
    return orderedSections(common, ['serverVariables', 'statusCounters', 'statistics'])
  }

  if (kind === 'storage-engines') {
    return orderedSections(common, ['engines', 'statistics'])
  }

  if (kind === 'analyze-profile') {
    return orderedSections(common, ['analyzeProfile', 'statementDigests'])
  }

  if (kind === 'innodb-status') {
    return common.filter((candidate) => ['innodbStatus', 'statistics', 'statusCounters'].includes(candidate.key))
  }

  if (kind === 'status-counters') {
    return common.filter((candidate) => ['statusCounters', 'statistics', 'sessions'].includes(candidate.key))
  }

  if (kind === 'index-health') {
    return common.filter((candidate) => ['indexHealth', 'indexes', 'statistics'].includes(candidate.key))
  }

  if (kind === 'performance' || kind === 'waits' || kind === 'missing-indexes') {
    return common.filter((candidate) =>
      ['statements', 'sessions', 'locks', 'waits', 'ioStats', 'memoryGrants', 'transactions', 'missingIndexes', 'statistics', 'queryStore', 'eventSessions', 'eventTargets'].includes(candidate.key),
    )
  }

  if (['io-stats', 'io-stat'].includes(kind)) {
    return orderedSections(common, ['ioStats', 'waits'])
  }

  if (['memory-grants', 'memory-grant'].includes(kind)) {
    return orderedSections(common, ['memoryGrants', 'sessions', 'statements'])
  }

  if (kind === 'transactions' || kind === 'transaction') {
    return orderedSections(common, ['transactions', 'sessions', 'locks'])
  }

  if (kind === 'extended-events' || kind === 'xevent-profiler') {
    return orderedSections(common, ['eventSessions', 'eventSessionEvents', 'eventTargets'])
  }

  if (kind === 'sql-server-agent' || kind === 'agent') {
    return orderedSections(common, ['agentServices', 'jobs', 'schedules', 'alerts', 'operators', 'proxies'])
  }

  if (kind === 'jobs') {
    return orderedSections(common, ['jobs', 'schedules'])
  }

  if (['schedules', 'alerts', 'operators', 'proxies'].includes(kind)) {
    return orderedSections(common, [kind, 'jobs'])
  }

  if (kind === 'security') {
    return orderedSections(common, [
      'users',
      'roles',
      'roleMappings',
      'roleMemberships',
      'permissions',
      'schemas',
      'certificates',
      'symmetricKeys',
      'asymmetricKeys',
      'credentials',
      'audits',
      'defaultPrivileges',
    ])
  }

  if (['users', 'roles', 'schemas', 'permissions'].includes(kind)) {
    return orderedSections(common, [kind, 'roleMappings', 'roleMemberships', 'permissions', 'schemas'])
  }

  if (kind === 'role-mappings') {
    return orderedSections(common, ['roleMappings', 'roles', 'permissions'])
  }

  if (['certificates', 'certificate'].includes(kind)) {
    return orderedSections(common, ['certificates', 'symmetricKeys', 'asymmetricKeys', 'permissions'])
  }

  if (['credentials', 'credential', 'database-scoped-credentials', 'database-scoped-credential'].includes(kind)) {
    return orderedSections(common, ['credentials', 'permissions'])
  }

  if (['audits', 'audit'].includes(kind)) {
    return orderedSections(common, ['audits', 'permissions'])
  }

  if (['symmetric-keys', 'symmetric-key'].includes(kind)) {
    return orderedSections(common, ['symmetricKeys', 'certificates', 'permissions'])
  }

  if (['asymmetric-keys', 'asymmetric-key'].includes(kind)) {
    return orderedSections(common, ['asymmetricKeys', 'certificates', 'permissions'])
  }

  if (kind === 'storage') {
    return orderedSections(common, [
      'files',
      'filegroups',
      'partitionSchemes',
      'partitionFunctions',
      'partitionBoundaries',
      'allocationUnits',
      'statistics',
      'engines',
    ])
  }

  if (['files', 'file'].includes(kind)) {
    return orderedSections(common, ['files', 'filegroups', 'allocationUnits'])
  }

  if (['filegroups', 'filegroup'].includes(kind)) {
    return orderedSections(common, ['filegroups', 'files', 'allocationUnits'])
  }

  if (['partition-schemes', 'partition-scheme'].includes(kind)) {
    return orderedSections(common, ['partitionSchemes', 'partitionFunctions', 'partitionBoundaries'])
  }

  if (['partition-functions', 'partition-function'].includes(kind)) {
    return orderedSections(common, ['partitionFunctions', 'partitionBoundaries', 'partitionSchemes'])
  }

  if (kind === 'database') {
    return common.filter((candidate) =>
      ['attachedDatabases', 'tables', 'views', 'indexes', 'triggers', 'pragmas', 'schemaObjects', 'procedures', 'functions', 'events', 'permissions', 'statistics'].includes(candidate.key),
    )
  }

  if (kind === 'pragmas' || kind === 'pragma') {
    return common.filter((candidate) => ['pragmas', 'checks', 'attachedDatabases', 'extensions'].includes(candidate.key))
  }

  if (kind === 'maintenance') {
    return common.filter((candidate) => ['checks', 'pragmas', 'maintenance', 'statistics'].includes(candidate.key))
  }

  if (kind === 'schema') {
    return common.filter((candidate) => ['schemaObjects'].includes(candidate.key))
  }

  if (kind === 'virtual-tables' || kind === 'fts-tables' || kind === 'rtree-tables') {
    return common.filter((candidate) => ['virtualTables'].includes(candidate.key))
  }

  if (kind === 'generated-columns') {
    return common.filter((candidate) => ['generatedColumns', 'columns'].includes(candidate.key))
  }

  if (kind === 'events' || kind === 'event') {
    return common.filter((candidate) => ['events'].includes(candidate.key))
  }

  if (kind === 'extensions' || kind === 'extension') {
    return common.filter((candidate) => ['extensions', 'extensionObjects', 'dependencies'].includes(candidate.key))
  }

  if (kind === 'replication') {
    return common.filter((candidate) => ['replication'].includes(candidate.key))
  }

  return common
}

function section(
  key: string,
  title: string,
  columns: string[],
  emptyText: string,
  icon: RelationalSectionIcon = 'table',
): RelationalSectionCandidate {
  return { key, title, columns, emptyText, icon }
}

function orderedSections(
  sections: RelationalSectionCandidate[],
  keys: string[],
) {
  return keys.flatMap((key) => {
    const found = sections.find((candidate) => candidate.key === key)
    return found ? [found] : []
  })
}
