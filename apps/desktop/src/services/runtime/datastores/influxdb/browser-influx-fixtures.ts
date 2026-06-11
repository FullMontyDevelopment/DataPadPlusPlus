export function influxBuckets(defaultBucket: string) {
  return [
    { name: defaultBucket, org: 'datapad', retention: '30 d', measurements: 3, series: 18420, storage: '1.8 GB' },
    { name: 'system', org: 'datapad', retention: '7 d', measurements: 5, series: 820, storage: '210 MB' },
  ]
}

export function influxMeasurements(bucket: string) {
  return [
    { name: 'cpu', bucket, tagCount: 3, fieldCount: 2, series: 8400, lastWrite: '12s ago' },
    { name: 'memory', bucket, tagCount: 3, fieldCount: 3, series: 6210, lastWrite: '12s ago' },
    { name: 'http_requests', bucket, tagCount: 5, fieldCount: 2, series: 3810, lastWrite: '18s ago' },
  ]
}

export function influxTags(bucket: string) {
  void bucket
  return [
    { name: 'host', valueCount: 42, series: 18420, cardinality: 'medium', risk: 'watch' },
    { name: 'region', valueCount: 3, series: 18420, cardinality: 'low', risk: 'safe' },
    { name: 'route', valueCount: 128, series: 3810, cardinality: 'high', risk: 'expensive' },
  ]
}

export function influxTagValues(tag: string) {
  return [
    { tag, value: tag === 'region' ? 'eu-west-1' : 'api-1', series: 420, measurement: 'cpu' },
    { tag, value: tag === 'region' ? 'us-east-1' : 'api-2', series: 390, measurement: 'memory' },
  ]
}

export function influxFields(bucket: string) {
  void bucket
  return [
    { name: 'usage_user', type: 'float', unit: '%', measurements: 'cpu', lastValue: '27.4' },
    { name: 'usage_system', type: 'float', unit: '%', measurements: 'cpu', lastValue: '8.2' },
    { name: 'request_count', type: 'integer', unit: 'count', measurements: 'http_requests', lastValue: '248' },
  ]
}

export function influxRetentionPolicies(bucket: string) {
  return [
    { name: `${bucket}/default`, duration: '30 d', shardGroupDuration: '1 d', replication: 1, status: 'active' },
  ]
}

export function influxTasks() {
  return [
    { name: 'downsample_cpu_5m', status: 'active', schedule: 'every 5m', lastRun: '2m ago', lastError: '-' },
    { name: 'rollup_http_hourly', status: 'paused', schedule: 'every 1h', lastRun: '3h ago', lastError: 'token scope missing write permission' },
  ]
}

export function influxTokens() {
  return [
    { name: 'read-telemetry', scopes: ['read:orgs', 'read:buckets/telemetry'], status: 'active', expiresAt: 'never' },
    { name: 'task-runner', scopes: ['read:buckets/telemetry', 'write:buckets/telemetry'], status: 'active', expiresAt: '2026-12-31' },
  ]
}

export function influxDiagnostics() {
  return [
    { signal: 'Series Cardinality', value: '18.4 K', status: 'watch', guidance: 'Filter by host or region before broad field scans.' },
    { signal: 'Task Failures', value: '1 paused', status: 'warning', guidance: 'Review task token scopes before enabling the task.' },
    { signal: 'Retention', value: '30 d', status: 'healthy', guidance: 'Retention matches the QA workspace expectation.' },
  ]
}

export function influxMeasurementDiagnostics(measurement: string) {
  return [
    { signal: 'Measurement Cardinality', value: measurement === 'http_requests' ? 'high' : 'medium', status: measurement === 'http_requests' ? 'watch' : 'healthy', guidance: 'Prefer tag filters and bounded ranges in chart queries.' },
  ]
}
