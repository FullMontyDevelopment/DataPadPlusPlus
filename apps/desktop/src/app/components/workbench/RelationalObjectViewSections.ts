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
    section('extensions', 'Extensions', ['name', 'version', 'schema', 'description'], 'No extensions were returned.'),
    section('statistics', 'Statistics', ['name', 'rows', 'scans', 'lastVacuum', 'lastAnalyze', 'size'], 'No statistics were returned.'),
    section('checks', 'Checks', ['name', 'status', 'detail'], 'No checks were returned.'),
    section('maintenance', 'Maintenance', ['name', 'scope', 'status', 'risk'], 'No maintenance workflows were returned.', 'job'),
    section('histograms', 'Histograms', ['name', 'step', 'rangeHiKey', 'equalRows', 'rangeRows', 'distinctRangeRows'], 'No histogram rows were returned.'),
    section('permissions', 'Permissions', ['principal', 'privilege', 'object', 'state', 'grantor'], 'No permissions were returned.', 'security'),
    section('grants', 'Grants', ['principal', 'privilege', 'object', 'state', 'grantor'], 'No grants were returned.', 'security'),
    section('roles', 'Roles', ['name', 'login', 'superuser', 'inherit', 'memberships'], 'No roles were returned.', 'security'),
    section('users', 'Users', ['name', 'host', 'type', 'defaultSchema', 'authenticationType', 'accountLocked'], 'No users were returned.', 'security'),
    section('replication', 'Replication', ['channel', 'role', 'state', 'lagSeconds', 'sourceHost', 'gtid'], 'No replication rows were returned.', 'job'),
    section('slowQueries', 'Slow Queries', ['digest', 'count', 'avgMs', 'maxMs', 'rowsExamined'], 'No slow-query rows were returned.', 'job'),
    section('innodbStatus', 'InnoDB Status', ['name', 'value', 'status', 'detail'], 'No InnoDB status rows were returned.', 'job'),
    section('nodes', 'Nodes', ['nodeId', 'address', 'locality', 'ranges', 'liveBytes', 'status'], 'No nodes were returned.', 'job'),
    section('ranges', 'Ranges', ['rangeId', 'table', 'replicas', 'leaseholder', 'qps', 'size'], 'No ranges were returned.', 'job'),
    section('regions', 'Regions / Localities', ['region', 'locality', 'nodes', 'survivalGoal', 'constraints'], 'No regions were returned.', 'job'),
    section('jobs', 'Jobs', ['id', 'type', 'jobType', 'object', 'status', 'fractionCompleted', 'schedule', 'lastRun', 'created', 'modified'], 'No jobs were returned.', 'job'),
    section('contention', 'Contention', ['key', 'table', 'waiter', 'durationMs', 'blockingTxn'], 'No contention rows were returned.', 'job'),
    section('transactions', 'Transactions', ['id', 'state', 'age', 'priority', 'retries'], 'No transactions were returned.', 'job'),
    section('statements', 'Statement Stats', ['query', 'count', 'meanMs', 'p99Ms', 'rows', 'retries'], 'No statement stats were returned.', 'job'),
    section('clusterSettings', 'Cluster Settings', ['name', 'value', 'type', 'description'], 'No cluster settings were returned.'),
    section('zoneConfigurations', 'Zone Configurations', ['target', 'numReplicas', 'constraints', 'leasePreferences', 'gcTtlSeconds'], 'No zone configurations were returned.'),
    section('sessions', 'Sessions', ['pid', 'sessionId', 'user', 'database', 'state', 'wait', 'blockedBy'], 'No sessions were returned.', 'job'),
    section('locks', 'Locks', ['pid', 'sessionId', 'object', 'mode', 'granted', 'blocking'], 'No locks were returned.', 'job'),
    section('queryStore', 'Query Store', ['name', 'status', 'durationMs', 'executions', 'planState'], 'No Query Store rows were returned.', 'job'),
    section('waits', 'Waits', ['waitType', 'waitingTasks', 'waitMs', 'signalWaitMs', 'resource'], 'No wait stats were returned.', 'job'),
    section('missingIndexes', 'Missing Indexes', ['table', 'equalityColumns', 'inequalityColumns', 'includedColumns', 'impact'], 'No missing-index hints were returned.', 'index'),
    section('indexHealth', 'Index Health', ['table', 'index', 'scans', 'tuplesRead', 'tuplesFetched', 'bloatRisk', 'lastVacuum'], 'No index-health rows were returned.', 'index'),
    section('files', 'Files', ['name', 'type', 'size', 'growth', 'state'], 'No files were returned.'),
    section('filegroups', 'Filegroups', ['name', 'type', 'default', 'readOnly'], 'No filegroups were returned.'),
    section('engines', 'Storage Engines', ['name', 'support', 'transactions', 'xa', 'savepoints'], 'No storage engines were returned.'),
  ]

  if (kind === 'cluster') {
    return common.filter((candidate) => ['nodes', 'ranges', 'regions', 'jobs', 'clusterSettings'].includes(candidate.key))
  }

  if (kind === 'diagnostics') {
    return common.filter((candidate) =>
      ['sessions', 'locks', 'statistics', 'queryStore', 'statements', 'transactions', 'contention', 'waits', 'missingIndexes', 'indexHealth', 'slowQueries', 'innodbStatus', 'replication', 'hypertables', 'chunks', 'compressionPolicies', 'retentionPolicies', 'continuousAggregates', 'jobs'].includes(candidate.key),
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
    return common.filter((candidate) => ['statements', 'statistics'].includes(candidate.key))
  }

  if (kind === 'slow-queries') {
    return common.filter((candidate) => ['slowQueries', 'statistics'].includes(candidate.key))
  }

  if (kind === 'innodb-status') {
    return common.filter((candidate) => ['innodbStatus', 'statistics'].includes(candidate.key))
  }

  if (kind === 'status-counters') {
    return common.filter((candidate) => ['statistics', 'sessions'].includes(candidate.key))
  }

  if (kind === 'index-health') {
    return common.filter((candidate) => ['indexHealth', 'indexes', 'statistics'].includes(candidate.key))
  }

  if (kind === 'performance' || kind === 'waits' || kind === 'missing-indexes') {
    return common.filter((candidate) =>
      ['sessions', 'locks', 'waits', 'missingIndexes', 'statistics', 'queryStore'].includes(candidate.key),
    )
  }

  if (kind === 'security') {
    return common.filter((candidate) => ['users', 'roles', 'permissions', 'schemas'].includes(candidate.key))
  }

  if (kind === 'storage') {
    return common.filter((candidate) => ['files', 'filegroups', 'statistics', 'engines'].includes(candidate.key))
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
    return common.filter((candidate) => ['extensions', 'diagnostics'].includes(candidate.key))
  }

  if (kind === 'files') {
    return common.filter((candidate) => ['files', 'tables', 'diagnostics'].includes(candidate.key))
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
