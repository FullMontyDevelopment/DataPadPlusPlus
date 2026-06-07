import type { AdapterDiagnostics, ConnectionProfile } from '@datapadplusplus/shared-types'

export function mysqlDiagnosticsPayload(connection: ConnectionProfile) {
  const database = connection.database || 'datapadplusplus'
  const isMariaDb = connection.engine === 'mariadb'

  return {
    engine: connection.engine,
    objectView: 'diagnostics',
    activeSessions: 3,
    sessions: [
      { sessionId: 11, user: 'app', database, state: 'executing', wait: 'none', blockedBy: '' },
      { sessionId: 12, user: 'reporting', database, state: 'sleep', wait: 'idle', blockedBy: '' },
    ],
    statistics: isMariaDb
      ? [
          { name: 'Questions', rows: 1200, scans: 0, size: '' },
          { name: 'Slow_queries', rows: 2, scans: 0, size: '' },
          { name: 'Threads_running', rows: 3, scans: 0, size: '' },
          { name: 'Aria_pagecache_reads', rows: 24, scans: 0, size: '' },
        ]
      : [
          { name: 'Questions', rows: 1200, scans: 0, size: '' },
          { name: 'Slow_queries', rows: 2, scans: 0, size: '' },
          { name: 'Threads_running', rows: 3, scans: 0, size: '' },
        ],
    slowQueries: [
      { digest: 'SELECT * FROM accounts WHERE status = ?', count: 128, avgMs: 4.2, maxMs: 39.8, rowsExamined: 1280 },
      { digest: 'SELECT * FROM orders WHERE updated_at > ?', count: 42, avgMs: 9.7, maxMs: 87.3, rowsExamined: 4200 },
    ],
    statementDigests: [
      mysqlStatementDigest(database, 'digest-accounts-status', 'SELECT * FROM accounts WHERE status = ?', 128, 537.6, 4.2, 39.8, 1280, 128, 0, 1),
      mysqlStatementDigest(database, 'digest-orders-updated', 'SELECT * FROM orders WHERE updated_at > ?', 42, 407.4, 9.7, 87.3, 4200, 84, 1, 2),
    ],
    tableIo: [
      { schema: database, table: 'orders', index: 'orders_account_id_idx', operations: 420, reads: 390, writes: 30, totalMs: 61.4 },
      { schema: database, table: 'accounts', index: 'PRIMARY', operations: 256, reads: 250, writes: 6, totalMs: 24.8 },
    ],
    metadataLocks: [
      { schema: database, object: 'orders', type: 'TABLE', lockType: 'SHARED_READ', duration: 'TRANSACTION', status: 'GRANTED', sessionId: 11, user: 'app' },
    ],
    optimizerTrace: isMariaDb
      ? []
      : [
          {
            name: 'optimizer_trace',
            enabled: 'enabled=off,one_line=off',
            traceLimit: 1,
            maxMemSize: 1048576,
            recentTraceCount: 0,
            recentTraces: [],
          },
        ],
    serverVariables: isMariaDb
      ? [
          { name: 'version', value: '11.4.2-MariaDB', status: 'info', detail: 'MariaDB server version' },
          { name: 'version_comment', value: 'MariaDB Server', status: 'info', detail: 'Server distribution comment' },
          { name: 'sql_mode', value: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', status: 'info', detail: 'Effective SQL mode' },
          { name: 'default_storage_engine', value: 'Aria', status: 'info', detail: 'Default storage engine' },
        ]
      : [],
    analyzeProfile: isMariaDb
      ? [
          {
            name: 'ANALYZE FORMAT=JSON',
            status: 'preview',
            detail: 'Use the guarded query template to profile a read-only statement.',
            queryTemplate: 'analyze format=json select 1;',
          },
        ]
      : [],
    innodbStatus: [
      { name: 'Buffer pool hit rate', value: '99.1%', status: 'healthy', detail: 'Read pressure is low.' },
      { name: 'Row lock waits', value: '0', status: 'healthy', detail: 'No active row lock pressure.' },
      { name: 'History list length', value: '12', status: 'normal', detail: 'Purge lag is within normal range.' },
    ],
    engines: isMariaDb
      ? [
          { name: 'InnoDB', support: 'YES', transactions: 'YES' },
          { name: 'Aria', support: 'YES', transactions: 'NO' },
        ]
      : [],
    roles: isMariaDb
      ? [
          { name: 'reporting_read', host: '%' },
          { name: 'app_writer', host: '%' },
        ]
      : [],
    roleMappings: isMariaDb
      ? [
          { name: 'reporting', host: '%', member: 'reporting_read', adminOption: 'N', memberships: 'reporting_read (N)' },
          { name: 'app', host: '%', member: 'app_writer', adminOption: 'Y', memberships: 'app_writer (Y)' },
        ]
      : [],
    replication: [
      { channel: 'default', role: 'replica', state: 'not configured', lagSeconds: 0, sourceHost: '', gtid: '' },
    ],
  }
}

export function mysqlDiagnosticsPreview(engine: 'mysql' | 'mariadb', scope: string): AdapterDiagnostics {
  const database = scope.includes(':') ? scope.split(':')[1] ?? 'datapadplusplus' : scope
  const label = mysqlFamilyLabel(engine)
  const metricPrefix = mysqlMetricPrefix(engine)
  const mariaDbProfiles = engine === 'mariadb'
    ? [
        mysqlProfile(`${label} status variables and storage engines`, 'mariadb-status-engines', 12.8, 4, {
          statusVariables: ['Threads_running', 'Aria_pagecache_reads'],
          engines: ['InnoDB', 'Aria'],
          versionProbe: "SHOW VARIABLES LIKE 'version%'",
        }),
        mysqlProfile(`${label} ANALYZE FORMAT=JSON profile request`, 'analyze-format-json', undefined, 1, {
          statement: 'analyze format=json select 1;',
          executesStatement: true,
        }),
      ]
    : [
        mysqlProfile(`${label} optimizer trace availability`, 'optimizer-trace-settings', undefined, 0, {
          optimizerTrace: 'enabled=off,one_line=off',
          traceLimit: 1,
          maxMemSize: 1048576,
        }),
      ]

  return {
    engine,
    plans: [mysqlProbePlan(engine, scope)],
    profiles: [
      mysqlProfile(`${label} sessions, waits, and active statements`, 'session 11 executing', 1200, 1, {
        sessionId: 11,
        user: 'app',
        database,
        state: 'executing',
        waitEvent: 'wait/io/table/sql/handler',
        waitMs: 3.4,
        statement: 'select * from accounts where status = ?',
      }),
      mysqlProfile(`${label} performance_schema statement digests`, 'digest-accounts-status', 537.6, 128, {
        schema: database,
        digestText: 'SELECT * FROM accounts WHERE status = ?',
        calls: 128,
        avgMs: 4.2,
        rowsExamined: 1280,
        fullScans: 1,
      }),
      mysqlProfile(`${label} table and index I/O waits`, `${database}.orders`, 61.4, 420, {
        schema: database,
        table: 'orders',
        index: 'orders_account_id_idx',
        reads: 390,
        writes: 30,
      }),
      ...mariaDbProfiles,
    ],
    metrics: [
      {
        renderer: 'metrics',
        metrics: [
          { name: `${metricPrefix}.threads_connected`, value: 8, unit: 'threads', labels: { source: 'SHOW GLOBAL STATUS' } },
          { name: `${metricPrefix}.threads_running`, value: 2, unit: 'threads', labels: { source: 'SHOW GLOBAL STATUS' } },
          ...(engine === 'mariadb'
            ? [{ name: `${metricPrefix}.aria_pagecache_reads`, value: 24, unit: 'reads', labels: { source: 'SHOW GLOBAL STATUS' } }]
            : [{ name: `${metricPrefix}.innodb_buffer_pool_hit_rate`, value: 99.1, unit: '%', labels: { source: 'SHOW GLOBAL STATUS' } }]),
          { name: `${metricPrefix}.statement_digests_sampled`, value: 2, unit: 'statements', labels: { source: 'performance_schema.events_statements_summary_by_digest' } },
          { name: `${metricPrefix}.table_io_operations`, value: 676, unit: 'operations', labels: { source: 'performance_schema.table_io_waits_summary_by_index_usage', database } },
          { name: `${metricPrefix}.metadata_locks_pending`, value: 0, unit: 'locks', labels: { source: 'performance_schema.metadata_locks', database } },
        ],
      },
      {
        renderer: 'series',
        series: [{
          name: `${metricPrefix}.threads_running`,
          unit: 'threads',
          points: [
            { timestamp: new Date(Date.now() - 120000).toISOString(), value: 1 },
            { timestamp: new Date(Date.now() - 60000).toISOString(), value: 3 },
            { timestamp: new Date().toISOString(), value: 2 },
          ],
        }],
      },
      {
        renderer: 'chart',
        chartType: 'bar',
        xAxis: 'Metric',
        yAxis: 'Value',
        series: [{ name: `${label} diagnostics`, points: [{ x: 'threads', y: 8 }, { x: engine === 'mariadb' ? 'Aria reads' : 'hit rate', y: engine === 'mariadb' ? 24 : 99.1 }, { x: 'digests', y: 2 }] }],
      },
    ],
    queryHistory: [
      { renderer: 'json', value: { kind: `${metricPrefix}_statement_digests`, query: 'performance_schema.events_statements_summary_by_digest ordered by total wait', rowCount: 2 } },
      engine === 'mariadb'
        ? { renderer: 'json', value: { kind: 'mariadb_analyze_format_json', query: 'ANALYZE FORMAT=JSON select 1', rowCount: 1 } }
        : { renderer: 'json', value: { kind: 'mysql_optimizer_trace', query: 'select @@optimizer_trace; select query, trace from information_schema.optimizer_trace limit 5', rowCount: 0 } },
    ],
    costEstimates: [],
    warnings: [`Browser preview diagnostics do not contact ${label}; desktop diagnostics run the native probes live.`],
  }
}

function mysqlStatementDigest(
  schema: string,
  digestId: string,
  digest: string,
  count: number,
  totalMs: number,
  avgMs: number,
  maxMs: number,
  rowsExamined: number,
  rowsSent: number,
  tmpDiskTables: number,
  fullScans: number,
) {
  return {
    schema,
    digestId,
    digest,
    count,
    totalMs,
    avgMs,
    maxMs,
    rowsExamined,
    rowsSent,
    tmpDiskTables,
    fullScans,
    firstSeen: '2026-05-20 02:00:00',
    lastSeen: '2026-05-20 02:05:00',
  }
}

function mysqlProbePlan(engine: 'mysql' | 'mariadb', scope: string): AdapterDiagnostics['plans'][number] {
  const probes = engine === 'mariadb'
    ? [
        'SHOW GLOBAL STATUS',
        "SHOW VARIABLES LIKE 'version%'",
        'SHOW ENGINES',
        'information_schema.processlist',
        'performance_schema.events_statements_summary_by_digest',
        'performance_schema.table_io_waits_summary_by_index_usage',
        'performance_schema.metadata_locks',
        'mysql.roles_mapping',
        'ANALYZE FORMAT=JSON profile sample',
      ]
    : [
        'SHOW GLOBAL STATUS',
        'information_schema.processlist',
        'performance_schema.events_statements_summary_by_digest',
        'performance_schema.table_io_waits_summary_by_index_usage',
        'performance_schema.metadata_locks',
        'information_schema.optimizer_trace',
      ]

  return {
    renderer: 'plan',
    format: 'text',
    value: {
      engine,
      scope,
      probes,
    },
    summary: `${mysqlFamilyLabel(engine)} diagnostics probe plan.`,
  }
}

function mysqlProfile(
  summary: string,
  name: string,
  durationMs: number | undefined,
  rows: number,
  details: Record<string, unknown>,
): AdapterDiagnostics['profiles'][number] {
  const stage = {
    name,
    rows,
    details,
    ...(durationMs === undefined ? {} : { durationMs }),
  }

  return {
    renderer: 'profile',
    summary,
    stages: [stage],
  }
}

function mysqlFamilyLabel(engine: 'mysql' | 'mariadb') {
  return engine === 'mariadb' ? 'MariaDB' : 'MySQL'
}

function mysqlMetricPrefix(engine: 'mysql' | 'mariadb') {
  return engine
}
