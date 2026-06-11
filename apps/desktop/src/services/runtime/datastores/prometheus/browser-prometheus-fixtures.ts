export function prometheusMetrics() {
  return [
    { name: 'up', type: 'gauge', help: 'Whether the last scrape of a target succeeded.', series: 42, samples: '42/min', cardinality: 'low', labels: ['job', 'instance'] },
    { name: 'http_requests_total', type: 'counter', help: 'Total HTTP requests processed by application handlers.', series: 840, samples: '8.4k/min', cardinality: 'medium', labels: ['job', 'instance', 'method', 'route', 'status'] },
    { name: 'process_cpu_seconds_total', type: 'counter', help: 'Total user and system CPU time spent in seconds.', series: 42, samples: '42/min', cardinality: 'low', labels: ['job', 'instance'] },
    { name: 'prometheus_tsdb_head_series', type: 'gauge', help: 'Current number of series in the head block.', series: 1, samples: '1/min', cardinality: 'low', labels: ['instance'] },
  ]
}

export function prometheusLabels() {
  return [
    { name: 'job', valueCount: 6, metricCount: 421, cardinality: 'low', risk: 'safe' },
    { name: 'instance', valueCount: 42, metricCount: 421, cardinality: 'medium', risk: 'watch' },
    { name: 'route', valueCount: 128, metricCount: 18, cardinality: 'high', risk: 'expensive' },
    { name: 'status', valueCount: 6, metricCount: 18, cardinality: 'low', risk: 'safe' },
  ]
}

export function prometheusLabelValues(label: string) {
  const values: Record<string, Array<{ label: string; value: string; series: number; exampleMetric: string }>> = {
    job: [
      { label, value: 'api', series: 412, exampleMetric: 'http_requests_total' },
      { label, value: 'prometheus', series: 86, exampleMetric: 'prometheus_tsdb_head_series' },
      { label, value: 'node', series: 940, exampleMetric: 'up' },
    ],
    instance: [
      { label, value: 'api-1:9100', series: 320, exampleMetric: 'up' },
      { label, value: 'api-2:9100', series: 318, exampleMetric: 'http_requests_total' },
    ],
    route: [
      { label, value: '/api/query', series: 54, exampleMetric: 'http_requests_total' },
      { label, value: '/api/write', series: 47, exampleMetric: 'http_requests_total' },
    ],
  }

  return values[label] ?? [
    { label, value: 'default', series: 12, exampleMetric: 'up' },
  ]
}

export function prometheusMetricLabels(metricName: string) {
  const metric = prometheusMetrics().find((item) => item.name === metricName)
  return prometheusLabels().filter((label) => metric?.labels.includes(label.name))
}

export function prometheusSeries(metricName?: string) {
  const metric = metricName ?? 'up'
  return [
    { metric, labels: { job: 'api', instance: 'api-1:9100' }, lastSample: '1', sampleRate: '1/min', cardinality: 'low' },
    { metric, labels: { job: 'api', instance: 'api-2:9100' }, lastSample: metric === 'up' ? '0' : '248', sampleRate: '1/min', cardinality: 'low' },
    { metric, labels: { job: 'prometheus', instance: 'prometheus:9090' }, lastSample: '1', sampleRate: '1/min', cardinality: 'low' },
  ]
}

export function prometheusTargets() {
  return [
    { job: 'api', instance: 'api-1:9100', health: 'up', lastScrape: '7s ago', scrapeDuration: '18 ms', lastError: '-' },
    { job: 'api', instance: 'api-2:9100', health: 'down', lastScrape: '18s ago', scrapeDuration: '30s', lastError: 'context deadline exceeded' },
    { job: 'prometheus', instance: 'prometheus:9090', health: 'up', lastScrape: '5s ago', scrapeDuration: '8 ms', lastError: '-' },
  ]
}

export function prometheusRuleGroups() {
  return [
    { name: 'api.rules', rules: 4, health: 'ok', evaluationTime: '4 ms' },
    { name: 'platform.alerts', rules: 3, health: 'ok', evaluationTime: '9 ms' },
  ]
}

export function prometheusRules() {
  return [
    { group: 'api.rules', name: 'job:http_requests:rate5m', type: 'recording', expression: 'sum by (job) (rate(http_requests_total[5m]))', health: 'ok', evaluationTime: '2 ms', lastError: '-' },
    { group: 'platform.alerts', name: 'InstanceDown', type: 'alerting', expression: 'up == 0', health: 'ok', evaluationTime: '4 ms', lastError: '-' },
    { group: 'platform.alerts', name: 'HighRouteCardinality', type: 'alerting', expression: 'count by (route) (http_requests_total) > 100', health: 'ok', evaluationTime: '5 ms', lastError: '-' },
  ]
}

export function prometheusAlerts() {
  return [
    { name: 'InstanceDown', state: 'firing', severity: 'warning', activeAt: '2026-05-23T11:56:00Z', summary: 'api-2 scrape is failing' },
    { name: 'HighRouteCardinality', state: 'pending', severity: 'info', activeAt: '2026-05-23T12:04:00Z', summary: 'Route label cardinality is elevated' },
  ]
}

export function prometheusServiceDiscovery() {
  return [
    { job: 'api', discovered: 4, active: 2, dropped: 2, lastSync: '22s ago' },
    { job: 'node', discovered: 12, active: 12, dropped: 0, lastSync: '19s ago' },
    { job: 'prometheus', discovered: 1, active: 1, dropped: 0, lastSync: '18s ago' },
  ]
}

export function prometheusTsdbStats() {
  return [
    { name: 'Head Series', value: 12840, unit: 'series', status: 'watch' },
    { name: 'Head Chunks', value: 45620, unit: 'chunks', status: 'healthy' },
    { name: 'WAL Segments', value: 9, unit: 'files', status: 'healthy' },
    { name: 'Label Pairs', value: 1640, unit: 'pairs', status: 'watch' },
  ]
}

export function prometheusStorageBlocks() {
  return [
    { block: '01HZYQ7Q6N', mint: '2026-05-23T08:00:00Z', maxt: '2026-05-23T10:00:00Z', samples: '1.2 M', series: 12840, size: '72 MB' },
    { block: '01HZYX3E2R', mint: '2026-05-23T10:00:00Z', maxt: '2026-05-23T12:00:00Z', samples: '1.1 M', series: 12690, size: '69 MB' },
  ]
}

export function prometheusDiagnostics() {
  return [
    { signal: 'Scrape Health', value: '2 / 3 up', status: 'warning', guidance: 'Investigate down target api-2 before relying on absent series.' },
    { signal: 'Route Cardinality', value: '128 values', status: 'watch', guidance: 'Avoid broad route label aggregations without a time bound.' },
    { signal: 'Rule Evaluation', value: '9 ms max', status: 'healthy', guidance: 'Rule groups are evaluating within expected bounds.' },
  ]
}

export function prometheusMetricDiagnostics(metricName: string) {
  return [
    { signal: 'Metric Cardinality', value: prometheusMetrics().find((metric) => metric.name === metricName)?.cardinality ?? 'unknown', status: metricName === 'http_requests_total' ? 'watch' : 'healthy', guidance: 'Use label matchers before range aggregations on high-cardinality metrics.' },
  ]
}
