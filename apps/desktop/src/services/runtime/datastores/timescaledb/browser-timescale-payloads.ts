import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type { TimescaleCapabilityKey } from '../../timescale-capabilities'
import {
  timescaleCapability,
  timescaleCapabilityWarning,
  timescaleCapabilityWarnings,
} from '../../timescale-capabilities'

type JsonRecord = Record<string, unknown>

export function timescaleInspectQueryTemplate(
  nodeId: string,
  schema: string,
  objectName: string,
) {
  if (nodeId.startsWith('hypertable:') && objectName) {
    return `select * from "${schema}"."${objectName}" limit 100;`
  }

  if (nodeId.startsWith('continuous-aggregate:') && objectName) {
    return `select * from "${schema}"."${objectName}" limit 100;`
  }

  if (nodeId.includes('continuous-aggregates')) {
    return 'select * from timescaledb_information.continuous_aggregates order by view_schema, view_name;'
  }

  if (nodeId.includes('compression')) {
    return 'select * from timescaledb_information.compression_settings order by hypertable_schema, hypertable_name;'
  }

  if (nodeId.includes('retention')) {
    return "select * from timescaledb_information.jobs where proc_name like '%retention%' order by hypertable_schema, hypertable_name;"
  }

  if (nodeId.includes('jobs')) {
    return 'select * from timescaledb_information.jobs order by hypertable_schema, hypertable_name, job_id;'
  }

  if (nodeId.includes('chunks')) {
    return 'select * from timescaledb_information.chunks order by hypertable_schema, hypertable_name, range_start desc;'
  }

  if (nodeId.includes('hypertables')) {
    return 'select * from timescaledb_information.hypertables order by hypertable_schema, hypertable_name;'
  }

  if (nodeId.includes('diagnostics')) {
    return [
      'select * from timescaledb_information.hypertables order by hypertable_schema, hypertable_name;',
      'select * from timescaledb_information.chunks order by hypertable_schema, hypertable_name, range_start desc;',
      'select * from timescaledb_information.jobs order by job_id;',
      "select * from pg_available_extensions where name = 'timescaledb_toolkit';",
      "select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('time_bucket', 'time_bucket_gapfill', 'time_bucket_ng');",
      "select calls, mean_exec_time, query from pg_stat_statements where query ilike '%time_bucket%' order by total_exec_time desc limit 20;",
    ].join('\n')
  }

  return undefined
}

export function timescaleInspectPayload(
  connection: ConnectionProfile,
  base: JsonRecord,
  nodeId: string,
  schema: string,
  objectName: string,
  columns: JsonRecord[],
) {
  const normalizedNodeId = nodeId.toLowerCase()
  const restrictedPayload = restrictedTimescalePayload(connection, normalizedNodeId, base)
  if (restrictedPayload) {
    return restrictedPayload
  }

  const common = timescaleCommonPayload(connection, schema)

  if (nodeId.startsWith('hypertable:')) {
    const hypertable = common.hypertables.find((row) => row.schema === schema && row.name === objectName)
    if (!hypertable) {
      return {
        ...base,
        objectName,
        tableName: objectName,
        columns: [],
        indexes: [],
        statistics: [],
        ...common,
        hypertables: [],
        chunks: [],
        compressionPolicies: [],
        retentionPolicies: [],
        warnings: ['No hypertable metadata is available for this object.'],
      }
    }

    return {
      ...base,
      objectName: objectName || hypertable.name,
      tableName: objectName || hypertable.name,
      rowCount: hypertable.rows,
      size: hypertable.size,
      columns,
      indexes: [
        { name: `${objectName || hypertable.name}_time_idx`, type: 'btree', columns: 'time desc', unique: false, valid: true, size: '24 MB', usage: 'time-window scans' },
        { name: `${objectName || hypertable.name}_device_id_idx`, type: 'btree', columns: 'device_id, time desc', unique: false, valid: true, size: '18 MB', usage: 'device filters' },
      ],
      statistics: [
        { name: objectName || hypertable.name, rows: hypertable.rows, scans: 184, lastAnalyze: '2026-05-20', size: hypertable.size },
      ],
      ...common,
      hypertables: [hypertable],
      chunks: common.chunks.filter((row) => row.hypertable === `${hypertable.schema}.${hypertable.name}`),
      compressionPolicies: common.compressionPolicies.filter((row) => row.hypertable === `${hypertable.schema}.${hypertable.name}`),
      retentionPolicies: common.retentionPolicies.filter((row) => row.hypertable === `${hypertable.schema}.${hypertable.name}`),
      timeBuckets: common.timeBuckets.filter((row) => row.hypertable === `${hypertable.schema}.${hypertable.name}`),
      chunkSizing: common.chunkSizing.filter((row) => row.hypertable === `${hypertable.schema}.${hypertable.name}`),
      compressionCoverage: common.compressionCoverage.filter((row) => row.hypertable === `${hypertable.schema}.${hypertable.name}`),
      jobHistory: common.jobHistory.filter((row) => row.object === `${hypertable.schema}.${hypertable.name}`),
      toolkitDiagnostics: common.toolkitDiagnostics,
      timeBucketFunctions: common.timeBucketFunctions,
      timeBucketWindows: common.timeBucketWindows.filter((row) => row.hypertable === `${hypertable.schema}.${hypertable.name}`),
      timeBucketQueryStats: common.timeBucketQueryStats,
    }
  }

  if (nodeId.startsWith('continuous-aggregate:')) {
    const aggregate = common.continuousAggregates.find((row) => row.schema === schema && row.name === objectName)
    if (!aggregate) {
      return {
        ...base,
        objectName,
        viewName: objectName,
        materializedViews: [],
        ...common,
        continuousAggregates: [],
        warnings: ['No continuous aggregate metadata is available for this object.'],
      }
    }

    return {
      ...base,
      objectName: objectName || aggregate.name,
      viewName: objectName || aggregate.name,
      rowCount: aggregate.rows,
      size: aggregate.size,
      materializedViews: [
        { schema: aggregate.schema, name: aggregate.name, rows: aggregate.rows, size: aggregate.size, lastRefresh: aggregate.lastRefresh },
      ],
      definition: `create materialized view "${aggregate.schema}"."${aggregate.name}" with (timescaledb.continuous) as select time_bucket('${aggregate.bucket}', time) as bucket, avg(value) from "${schema}"."order_metrics" group by 1;`,
      ...common,
      continuousAggregates: [aggregate],
      aggregateFreshness: common.aggregateFreshness.filter((row) => row.view === `${aggregate.schema}.${aggregate.name}`),
      jobHistory: common.jobHistory.filter((row) => row.object === `${aggregate.schema}.${aggregate.name}`),
      toolkitDiagnostics: common.toolkitDiagnostics,
      timeBucketFunctions: common.timeBucketFunctions,
      timeBucketWindows: common.timeBucketWindows.filter((row) => row.hypertable === aggregate.source),
      timeBucketQueryStats: common.timeBucketQueryStats,
    }
  }

  if (
    nodeId.includes('hypertables') ||
    nodeId.includes('continuous-aggregates') ||
    nodeId.includes('chunks') ||
    nodeId.includes('compression') ||
    nodeId.includes('retention') ||
    nodeId.includes('jobs') ||
    nodeId.includes('diagnostics')
  ) {
    return {
      ...base,
      hypertableCount: common.hypertables.length,
      chunkCount: common.chunks.length,
      policyCount: common.compressionPolicies.length + common.retentionPolicies.length,
      continuousAggregateCount: common.continuousAggregates.length,
      jobCount: common.jobs.length,
      ...common,
      warnings: nodeId.includes('diagnostics')
        ? [
            'Diagnostics are scoped to TimescaleDB catalog views visible to the current role.',
            ...timescaleCapabilityWarnings(connection, [
              'inspectCompression',
              'inspectRetention',
              'inspectContinuousAggregates',
              'inspectJobs',
              'inspectToolkit',
            ]),
          ]
        : undefined,
    }
  }

  return undefined
}

function timescaleCommonPayload(connection: ConnectionProfile, defaultSchema: string) {
  const schema = defaultSchema || 'public'
  const options = connection.postgresOptions
  const hypertables = [
    {
      schema,
      name: 'order_metrics',
      timeColumn: 'time',
      dimensions: 1,
      chunks: 8,
      compressed: 'Yes',
      retention: '90 days',
      rows: 2450000,
      size: '1.8 GB',
    },
    {
      schema: 'observability',
      name: 'cpu_metrics',
      timeColumn: 'captured_at',
      dimensions: 2,
      chunks: 12,
      compressed: 'Partial',
      retention: '30 days',
      rows: 980000,
      size: '620 MB',
    },
  ]
  const chunks = [
    { hypertable: `${schema}.order_metrics`, chunk: '_hyper_1_42_chunk', rangeStart: '2026-05-20', rangeEnd: '2026-05-21', compressed: 'Yes', size: '120 MB' },
    { hypertable: `${schema}.order_metrics`, chunk: '_hyper_1_43_chunk', rangeStart: '2026-05-21', rangeEnd: '2026-05-22', compressed: 'No', size: '164 MB' },
    { hypertable: 'observability.cpu_metrics', chunk: '_hyper_2_18_chunk', rangeStart: '2026-05-22', rangeEnd: '2026-05-23', compressed: 'No', size: '84 MB' },
  ]
  const toolkitWarning = timescaleCapabilityWarning(connection, 'inspectToolkit')
  const toolkitVisible = !toolkitWarning
  const timeBucketFunctions = [
    { schema: 'public', functionName: 'time_bucket', signature: 'bucket_width interval, ts timestamptz', resultType: 'timestamptz', capability: 'core', status: 'available' },
    { schema: 'public', functionName: 'time_bucket_gapfill', signature: 'bucket_width interval, ts timestamptz', resultType: 'timestamptz', capability: 'gapfill', status: toolkitVisible ? 'available' : 'hidden' },
  ]
  const toolkitDiagnostics = toolkitVisible
    ? [
        { name: 'timescaledb_toolkit', installedVersion: options?.timescaleExtensionVersion ? 'compatible' : 'not installed', defaultVersion: 'latest available', schema: options?.timescaleExtensionSchema ?? 'public', status: 'available', guidance: 'Enable the extension when percentile_agg, stats_agg, time_weight, or counter_agg diagnostics are needed.' },
        { name: 'time_bucket_gapfill', installedVersion: 'core function', defaultVersion: '-', schema: 'public', status: 'available', guidance: 'Gapfill functions are visible for sparse-window diagnosis.' },
      ]
    : [
        { name: 'timescaledb_toolkit', status: 'hidden', guidance: toolkitWarning },
      ]

  return {
    timescaleProfile: {
      deploymentMode: options?.timescaleDeploymentMode ?? 'self-hosted',
      project: options?.timescaleProject,
      serviceId: options?.timescaleServiceId,
      region: options?.timescaleRegion,
      extensionSchema: options?.timescaleExtensionSchema ?? 'public',
      extensionVersion: options?.timescaleExtensionVersion,
      serverVersion: options?.timescaleServerVersion,
      license: options?.timescaleLicense ?? 'unknown',
      policyExecution: timescaleCapability(connection, 'livePolicyExecution')
        ? 'Guarded live enabled'
        : 'Preview only',
      toolkit: toolkitVisible ? 'Visible' : 'Hidden',
      disabledReason: timescaleCapabilityWarning(connection, 'livePolicyExecution'),
    },
    hypertables,
    chunks,
    timeBuckets: [
      { hypertable: `${schema}.order_metrics`, bucket: '1 hour', rangeStart: '2026-05-27 00:00', rangeEnd: '2026-05-27 12:00', latestBucket: '2026-05-27 12:00', avgRows: '20.4k/hour', gapCount: 0, windowCount: 12, scanChunks: 2, meanDuration: '48 ms', p95Duration: '92 ms', status: 'current' },
      { hypertable: 'observability.cpu_metrics', bucket: '5 minutes', rangeStart: '2026-05-27 00:00', rangeEnd: '2026-05-27 12:00', latestBucket: '2026-05-27 11:55', avgRows: '1.3k/5m', gapCount: 2, windowCount: 144, scanChunks: 3, meanDuration: '76 ms', p95Duration: '140 ms', status: 'minor gaps' },
    ],
    toolkitDiagnostics,
    timeBucketFunctions,
    timeBucketWindows: [
      { hypertable: `${schema}.order_metrics`, bucket: '1 hour', range: '2026-05-20 to 2026-05-22', chunks: 2, compressedChunks: 1, latestChunk: '_hyper_1_43_chunk', gapfill: toolkitVisible ? 'available' : 'hidden', queryGuidance: 'Use bounded time predicates before bucket aggregation.', status: 'bounded scan' },
      { hypertable: 'observability.cpu_metrics', bucket: '5 minutes', range: '2026-05-22 to 2026-05-23', chunks: 1, compressedChunks: 0, latestChunk: '_hyper_2_18_chunk', gapfill: toolkitVisible ? 'available' : 'hidden', queryGuidance: 'Review sparse windows before gapfill.', status: 'review gaps' },
    ],
    timeBucketQueryStats: [
      { queryId: 'preview-bucket-1h', bucket: '1 hour', calls: 28, rows: '571k', totalExecMs: '1344.00', meanExecMs: '48.00', query: 'select time_bucket($1, time), avg(latency_ms) from order_metrics where time >= $2 group by 1', status: 'sampled from pg_stat_statements preview' },
      { queryId: 'preview-gapfill-5m', bucket: '5 minutes', calls: 8, rows: '102k', totalExecMs: '608.00', meanExecMs: '76.00', query: 'select time_bucket_gapfill($1, captured_at), avg(cpu_pct) from cpu_metrics where captured_at >= $2 group by 1', status: toolkitVisible ? 'gapfill-ready' : 'Toolkit hidden' },
    ],
    chunkSizing: [
      { hypertable: `${schema}.order_metrics`, chunk: '_hyper_1_42_chunk', range: '2026-05-20 to 2026-05-21', rows: '156k', size: '120 MB', indexSize: '22 MB', compression: 'compressed' },
      { hypertable: `${schema}.order_metrics`, chunk: '_hyper_1_43_chunk', range: '2026-05-21 to 2026-05-22', rows: '184k', size: '164 MB', indexSize: '26 MB', compression: 'pending' },
      { hypertable: 'observability.cpu_metrics', chunk: '_hyper_2_18_chunk', range: '2026-05-22 to 2026-05-23', rows: '92k', size: '84 MB', indexSize: '14 MB', compression: 'pending' },
    ],
    compressionCoverage: [
      { hypertable: `${schema}.order_metrics`, ratio: '87.5%', compressedChunks: 7, totalChunks: 8, pendingChunks: 1, compressedBytes: '1.2 GB', uncompressedBytes: '164 MB', policy: 'compress after 7 days', status: 'newest chunk pending' },
      { hypertable: 'observability.cpu_metrics', ratio: '58.3%', compressedChunks: 7, totalChunks: 12, pendingChunks: 5, compressedBytes: '364 MB', uncompressedBytes: '256 MB', policy: 'compress after 3 days', status: 'review hot host partitions' },
    ],
    compressionPolicies: [
      { hypertable: `${schema}.order_metrics`, enabled: 'Yes', segmentBy: 'device_id', orderBy: 'time desc', policy: 'compress after 7 days' },
      { hypertable: 'observability.cpu_metrics', enabled: 'Yes', segmentBy: 'host', orderBy: 'captured_at desc', policy: 'compress after 3 days' },
    ],
    retentionPolicies: [
      { hypertable: `${schema}.order_metrics`, window: '90 days', jobStatus: 'scheduled', lastRun: '2026-05-27 02:00' },
      { hypertable: 'observability.cpu_metrics', window: '30 days', jobStatus: 'scheduled', lastRun: '2026-05-27 01:00' },
    ],
    continuousAggregates: [
      { schema: 'observability', name: 'hourly_order_metrics', source: `${schema}.order_metrics`, bucket: '1 hour', materializedOnly: 'No', lastRefresh: '2026-05-27 12:00', lag: '10 minutes', rows: 24000, size: '96 MB' },
      { schema: 'observability', name: 'daily_cpu_metrics', source: 'observability.cpu_metrics', bucket: '1 day', materializedOnly: 'No', lastRefresh: '2026-05-27 00:30', lag: '35 minutes', rows: 1800, size: '12 MB' },
    ],
    aggregateFreshness: [
      { view: 'observability.hourly_order_metrics', source: `${schema}.order_metrics`, bucket: '1 hour', lastRefresh: '2026-05-27 12:00', lag: '10 minutes', invalidationLag: '6 minutes', materializedOnly: 'No', status: 'healthy' },
      { view: 'observability.daily_cpu_metrics', source: 'observability.cpu_metrics', bucket: '1 day', lastRefresh: '2026-05-27 00:30', lag: '35 minutes', invalidationLag: '18 minutes', materializedOnly: 'No', status: 'watch' },
    ],
    jobs: [
      { id: 1001, jobType: 'compression policy', object: `${schema}.order_metrics`, schedule: '1 day', lastRun: '2026-05-27 02:00', status: 'succeeded' },
      { id: 1002, jobType: 'retention policy', object: `${schema}.order_metrics`, schedule: '1 day', lastRun: '2026-05-27 02:05', status: 'succeeded' },
      { id: 1003, jobType: 'continuous aggregate refresh', object: 'observability.hourly_order_metrics', schedule: '1 hour', lastRun: '2026-05-27 12:00', status: 'succeeded' },
    ],
    jobHistory: [
      { job: 'Compression order_metrics', jobType: 'compression policy', object: `${schema}.order_metrics`, lastRun: '2026-05-27 02:00', nextRun: '2026-05-28 02:00', duration: '12s', status: 'succeeded', failures: 0 },
      { job: 'Retention order_metrics', jobType: 'retention policy', object: `${schema}.order_metrics`, lastRun: '2026-05-27 02:05', nextRun: '2026-05-28 02:05', duration: '4s', status: 'succeeded', failures: 0 },
      { job: 'Refresh hourly_order_metrics', jobType: 'continuous aggregate refresh', object: 'observability.hourly_order_metrics', lastRun: '2026-05-27 12:00', nextRun: '2026-05-27 13:00', duration: '31s', status: 'succeeded', failures: 0 },
      { job: 'Compression cpu_metrics', jobType: 'compression policy', object: 'observability.cpu_metrics', lastRun: '2026-05-27 01:00', nextRun: '2026-05-28 01:00', duration: '44s', status: 'retry clean', failures: 1 },
    ],
    diagnostics: [
      { signal: 'Compression Coverage', value: '63%', status: 'review newest chunks' },
      { signal: 'Refresh Lag', value: '10 minutes', status: 'healthy' },
      { signal: 'Retention Window', value: '90 days', status: 'guarded by policy' },
      { signal: 'Toolkit Availability', value: toolkitVisible ? 'available' : 'hidden', status: toolkitVisible ? 'gapfill and advanced aggregates visible' : toolkitWarning },
      { signal: 'Time-Bucket Query History', value: '2 sampled windows', status: 'review query duration by bucket width' },
    ],
  }
}

function restrictedTimescalePayload(
  connection: ConnectionProfile,
  normalizedNodeId: string,
  base: JsonRecord,
) {
  const capability = timescaleSpecificCapabilityForNode(normalizedNodeId)
  if (!capability) {
    return undefined
  }
  const warning = timescaleCapabilityWarning(connection, capability)
  if (!warning) {
    return undefined
  }
  return {
    ...base,
    objectView: 'restricted',
    disabledReason: warning,
    warnings: [warning],
    objects: [],
  }
}

function timescaleSpecificCapabilityForNode(
  normalizedNodeId: string,
): TimescaleCapabilityKey | undefined {
  if (normalizedNodeId.includes('chunks')) return 'inspectChunks'
  if (normalizedNodeId.includes('compression')) return 'inspectCompression'
  if (normalizedNodeId.includes('retention')) return 'inspectRetention'
  if (
    normalizedNodeId.includes('continuous-aggregate') ||
    normalizedNodeId.includes('continuous-aggregates')
  ) {
    return 'inspectContinuousAggregates'
  }
  if (normalizedNodeId.includes('jobs')) return 'inspectJobs'
  if (normalizedNodeId.includes('hypertable') || normalizedNodeId.includes('hypertables')) {
    return 'inspectHypertables'
  }
  return undefined
}
