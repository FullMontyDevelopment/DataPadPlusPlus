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
    ].join('\n')
  }

  return undefined
}

export function timescaleInspectPayload(
  base: JsonRecord,
  nodeId: string,
  schema: string,
  objectName: string,
  columns: JsonRecord[],
) {
  const common = timescaleCommonPayload(schema)

  if (nodeId.startsWith('hypertable:')) {
    const hypertable = common.hypertables.find((row) => row.schema === schema && row.name === objectName) ?? common.hypertables[0]
    if (!hypertable) {
      return undefined
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
    }
  }

  if (nodeId.startsWith('continuous-aggregate:')) {
    const aggregate = common.continuousAggregates.find((row) => row.schema === schema && row.name === objectName) ?? common.continuousAggregates[0]
    if (!aggregate) {
      return undefined
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
        ? ['Diagnostics are scoped to TimescaleDB catalog views visible to the current role.']
        : undefined,
    }
  }

  return undefined
}

function timescaleCommonPayload(defaultSchema: string) {
  const schema = defaultSchema || 'public'
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

  return {
    hypertables,
    chunks,
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
    jobs: [
      { id: 1001, jobType: 'compression policy', object: `${schema}.order_metrics`, schedule: '1 day', lastRun: '2026-05-27 02:00', status: 'succeeded' },
      { id: 1002, jobType: 'retention policy', object: `${schema}.order_metrics`, schedule: '1 day', lastRun: '2026-05-27 02:05', status: 'succeeded' },
      { id: 1003, jobType: 'continuous aggregate refresh', object: 'observability.hourly_order_metrics', schedule: '1 hour', lastRun: '2026-05-27 12:00', status: 'succeeded' },
    ],
    diagnostics: [
      { signal: 'Compression Coverage', value: '63%', status: 'review newest chunks' },
      { signal: 'Refresh Lag', value: '10 minutes', status: 'healthy' },
      { signal: 'Retention Window', value: '90 days', status: 'guarded by policy' },
    ],
  }
}
