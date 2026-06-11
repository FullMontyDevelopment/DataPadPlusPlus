export function openTsdbMetrics() {
  return [
    { name: 'sys.cpu.user', tags: 3, lastWrite: '8s ago', pointsPerMinute: '42k', cardinality: 'medium', uid: '000001' },
    { name: 'http.requests', tags: 5, lastWrite: '12s ago', pointsPerMinute: '18k', cardinality: 'high', uid: '000002' },
    { name: 'jvm.memory.used', tags: 4, lastWrite: '15s ago', pointsPerMinute: '6k', cardinality: 'low', uid: '000003' },
  ]
}

export function openTsdbTags(metric?: string) {
  const rows = [
    { name: 'host', valueCount: 42, metricCount: 3, cardinality: 'medium', risk: 'watch' },
    { name: 'region', valueCount: 3, metricCount: 3, cardinality: 'low', risk: 'safe' },
    { name: 'endpoint', valueCount: 128, metricCount: 1, cardinality: 'high', risk: 'expensive' },
    { name: 'pool', valueCount: 6, metricCount: 1, cardinality: 'low', risk: 'safe' },
  ]

  if (metric === 'http.requests') {
    return rows.filter((tag) => ['host', 'region', 'endpoint'].includes(tag.name))
  }

  if (metric === 'jvm.memory.used') {
    return rows.filter((tag) => ['host', 'region', 'pool'].includes(tag.name))
  }

  return rows.filter((tag) => tag.name !== 'pool')
}

export function openTsdbTagValues(tag: string) {
  const values: Record<string, Array<Record<string, string | number>>> = {
    host: [
      { tag, value: 'api-1', metrics: 3, series: 120, exampleMetric: 'sys.cpu.user' },
      { tag, value: 'api-2', metrics: 3, series: 118, exampleMetric: 'http.requests' },
    ],
    region: [
      { tag, value: 'us-east', metrics: 3, series: 184, exampleMetric: 'sys.cpu.user' },
      { tag, value: 'eu-west', metrics: 3, series: 168, exampleMetric: 'jvm.memory.used' },
    ],
    endpoint: [
      { tag, value: '/catalog', metrics: 1, series: 44, exampleMetric: 'http.requests' },
      { tag, value: '/checkout', metrics: 1, series: 37, exampleMetric: 'http.requests' },
    ],
  }

  return values[tag] ?? [
    { tag, value: 'default', metrics: 1, series: 1, exampleMetric: 'sys.cpu.user' },
  ]
}

export function openTsdbAggregators() {
  return [
    { name: 'avg', description: 'Average values across matching series.', interpolation: 'linear', bestFor: 'CPU, latency, and rate averages' },
    { name: 'sum', description: 'Sum values across matching series.', interpolation: 'linear', bestFor: 'Counters and total throughput' },
    { name: 'max', description: 'Maximum value across matching series.', interpolation: 'linear', bestFor: 'Peak usage and saturation checks' },
    { name: 'min', description: 'Minimum value across matching series.', interpolation: 'linear', bestFor: 'Floor or availability checks' },
  ]
}

export function openTsdbDownsampling() {
  return [
    { expression: '1m-avg', interval: '1 minute', aggregator: 'avg', fillPolicy: 'none', bestFor: 'Interactive charts' },
    { expression: '5m-sum', interval: '5 minutes', aggregator: 'sum', fillPolicy: 'none', bestFor: 'Traffic rollups' },
    { expression: '1h-max', interval: '1 hour', aggregator: 'max', fillPolicy: 'nan', bestFor: 'Long-range saturation review' },
  ]
}

export function openTsdbUidMetadata() {
  return [
    { kind: 'metric', name: 'sys.cpu.user', uid: '000001', displayName: 'CPU User Time', description: 'CPU time spent in user space.', notes: 'Safe for dashboard rollups.' },
    { kind: 'metric', name: 'http.requests', uid: '000002', displayName: 'HTTP Requests', description: 'Request count by endpoint.', notes: 'High endpoint cardinality.' },
    { kind: 'tagk', name: 'host', uid: '000010', displayName: 'Host', description: 'Source host name.', notes: 'Required for most queries.' },
    { kind: 'tagk', name: 'region', uid: '000011', displayName: 'Region', description: 'Deployment region.', notes: 'Low cardinality.' },
  ]
}

export function openTsdbTrees() {
  return [
    { name: 'service-latency', enabled: true, rules: 4, collisions: 0, description: 'Groups request metrics by service and endpoint.' },
    { name: 'host-inventory', enabled: true, rules: 3, collisions: 1, description: 'Groups host metrics by region and role.' },
  ]
}

export function openTsdbStats() {
  return [
    { name: 'tsd.rpc.received', value: '12/s', unit: 'requests', status: 'healthy' },
    { name: 'tsd.http.query.latency_95pct', value: '84 ms', unit: 'latency', status: 'healthy' },
    { name: 'tsd.uid.cache-hit-rate', value: '99.2%', unit: 'ratio', status: 'healthy' },
    { name: 'hbase.flushQueueLength', value: '0', unit: 'items', status: 'healthy' },
  ]
}

export function openTsdbDiagnostics() {
  return [
    { signal: 'Endpoint Cardinality', value: '128 values', status: 'watch', guidance: 'Use endpoint filters and downsampling before long-range queries.' },
    { signal: 'UID Cache', value: '99.2%', status: 'healthy', guidance: 'UID cache hit rate is healthy.' },
    { signal: 'Storage Queue', value: '0', status: 'healthy', guidance: 'No HBase write queue pressure detected.' },
  ]
}

export function openTsdbMetricDiagnostics(metric: string) {
  return [
    {
      signal: 'Metric Cardinality',
      value: openTsdbMetrics().find((item) => item.name === metric)?.cardinality ?? 'unknown',
      status: metric === 'http.requests' ? 'watch' : 'healthy',
      guidance: 'Prefer explicit tag filters and downsampling for long time ranges.',
    },
  ]
}
