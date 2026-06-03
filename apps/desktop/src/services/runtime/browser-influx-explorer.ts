import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import {
  influxBuckets,
  influxDiagnostics,
  influxFields,
  influxMeasurementDiagnostics,
  influxMeasurements,
  influxRetentionPolicies,
  influxTagValues,
  influxTags,
  influxTasks,
  influxTokens,
} from './browser-influx-fixtures'

export function createInfluxExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const defaultBucket = influxDefaultBucket(connection)

  if (!scope) {
    return [
      influxNode({
        id: 'influx:buckets',
        label: 'Buckets',
        kind: 'buckets',
        detail: 'Buckets, databases, and retention scopes',
        scope: 'influx:buckets',
        expandable: true,
      }),
      influxNode({
        id: 'influx:tasks',
        label: 'Tasks',
        kind: 'tasks',
        detail: 'Scheduled Flux tasks',
        scope: 'influx:tasks',
        expandable: true,
      }),
      influxNode({
        id: 'influx:security',
        label: 'Tokens',
        kind: 'security',
        detail: 'Authorizations and bucket scopes',
        scope: 'influx:security',
      }),
      influxNode({
        id: 'influx:diagnostics',
        label: 'Diagnostics',
        kind: 'diagnostics',
        detail: 'Cardinality, storage, and query health',
        scope: 'influx:diagnostics',
      }),
    ]
  }

  if (scope === 'influx:buckets') {
    if (!defaultBucket) return []
    return influxBuckets(defaultBucket).map((bucket) =>
      influxNode({
        id: `bucket:${bucket.name}`,
        label: bucket.name,
        kind: 'bucket',
        detail: `${bucket.retention} | ${bucket.series} series`,
        path: ['Buckets'],
        scope: `bucket:${bucket.name}`,
        expandable: true,
      }),
    )
  }

  if (scope.startsWith('bucket:')) {
    const bucket = scope.replace('bucket:', '')
    return [
      influxNode({
        id: `measurements:${bucket}`,
        label: 'Measurements',
        kind: 'measurements',
        detail: 'Measurement schema',
        path: ['Buckets', bucket],
        scope: `measurements:${bucket}`,
        expandable: true,
      }),
      influxNode({
        id: `tags:${bucket}`,
        label: 'Tags',
        kind: 'tags',
        detail: 'Indexed dimensions',
        path: ['Buckets', bucket],
        scope: `tags:${bucket}`,
        expandable: true,
      }),
      influxNode({
        id: `fields:${bucket}`,
        label: 'Fields',
        kind: 'fields',
        detail: 'Value fields',
        path: ['Buckets', bucket],
        scope: `fields:${bucket}`,
        expandable: true,
      }),
      influxNode({
        id: `retention:${bucket}`,
        label: 'Retention Policies',
        kind: 'retention-policies',
        detail: 'Retention and shard groups',
        path: ['Buckets', bucket],
        scope: `retention:${bucket}`,
      }),
    ]
  }

  if (scope.startsWith('measurements:')) {
    const bucket = scope.replace('measurements:', '')
    return influxMeasurements(bucket).map((measurement) =>
      influxNode({
        id: `measurement:${bucket}:${measurement.name}`,
        label: measurement.name,
        kind: 'measurement',
        detail: `${measurement.series} series | ${measurement.lastWrite}`,
        path: ['Buckets', bucket, 'Measurements'],
        scope: `measurement:${bucket}:${measurement.name}`,
        expandable: true,
        queryTemplate: influxMeasurementQuery(bucket, measurement.name),
      }),
    )
  }

  if (scope.startsWith('measurement:')) {
    const [, bucket = defaultBucket, measurement = 'measurement'] = scope.split(':')
    return [
      influxNode({
        id: `tags:${bucket}:${measurement}`,
        label: 'Tags',
        kind: 'tags',
        detail: 'Tag keys used by this measurement',
        path: ['Buckets', bucket, 'Measurements', measurement],
        scope: `tags:${bucket}:${measurement}`,
      }),
      influxNode({
        id: `fields:${bucket}:${measurement}`,
        label: 'Fields',
        kind: 'fields',
        detail: 'Fields used by this measurement',
        path: ['Buckets', bucket, 'Measurements', measurement],
        scope: `fields:${bucket}:${measurement}`,
      }),
    ]
  }

  if (scope.startsWith('tags:')) {
    const [, bucket = defaultBucket] = scope.split(':')
    return influxTags(bucket).map((tag) =>
      influxNode({
        id: `tag:${bucket}:${tag.name}`,
        label: tag.name,
        kind: 'tag',
        detail: `${tag.valueCount} value(s) | ${tag.risk}`,
        path: ['Buckets', bucket, 'Tags'],
        scope: `tag:${bucket}:${tag.name}`,
        expandable: true,
      }),
    )
  }

  if (scope.startsWith('fields:')) {
    const [, bucket = defaultBucket] = scope.split(':')
    return influxFields(bucket).map((field) =>
      influxNode({
        id: `field:${bucket}:${field.name}`,
        label: field.name,
        kind: 'field',
        detail: `${field.type} | ${field.unit}`,
        path: ['Buckets', bucket, 'Fields'],
        scope: `field:${bucket}:${field.name}`,
      }),
    )
  }

  if (scope === 'influx:tasks') {
    return influxTasks().map((task) =>
      influxNode({
        id: `task:${task.name}`,
        label: task.name,
        kind: 'task',
        detail: `${task.status} | ${task.schedule}`,
        path: ['Tasks'],
        scope: `task:${task.name}`,
      }),
    )
  }

  return []
}

export function influxInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  if (nodeId.startsWith('measurement:')) {
    const [, bucket = influxDefaultBucket(connection), measurement = 'measurement'] = nodeId.split(':')
    return influxMeasurementQuery(bucket, measurement)
  }

  if (nodeId.startsWith('field:')) {
    const [, bucket = influxDefaultBucket(connection), field = 'value'] = nodeId.split(':')
    return `from(bucket: "${bucket}")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._field == "${field}")`
  }

  return `from(bucket: "${influxDefaultBucket(connection)}")\n  |> range(start: -1h)\n  |> limit(n: 100)`
}

export function influxInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const bucket = influxBucketFromNodeId(connection, nodeId)
  const base = influxBasePayload(bucket)

  if (nodeId === 'influx:buckets') {
    return {
      ...base,
      objectView: 'buckets',
      buckets: influxBuckets(bucket),
      diagnostics: influxDiagnostics(),
    }
  }

  if (nodeId.startsWith('bucket:')) {
    return influxBucketPayload(nodeId.replace('bucket:', '') || bucket)
  }

  if (nodeId.startsWith('measurement:')) {
    const [, bucketName = bucket, measurement = 'cpu'] = nodeId.split(':')
    return {
      ...influxBucketPayload(bucketName),
      objectView: 'measurement',
      measurement,
      measurements: influxMeasurements(bucketName).filter((item) => item.name === measurement),
      tags: influxTags(bucketName),
      fields: influxFields(bucketName),
      diagnostics: influxMeasurementDiagnostics(measurement),
    }
  }

  if (nodeId.startsWith('measurements:')) {
    return {
      ...base,
      objectView: 'measurements',
      measurements: influxMeasurements(bucket),
      tags: influxTags(bucket),
      fields: influxFields(bucket),
      diagnostics: influxDiagnostics(),
    }
  }

  if (nodeId.startsWith('tags:') || nodeId.startsWith('tag:')) {
    const tagName = nodeId.startsWith('tag:') ? nodeId.split(':')[2] : undefined
    return {
      ...base,
      objectView: tagName ? 'tag' : 'tags',
      tags: influxTags(bucket).filter((tag) => !tagName || tag.name === tagName),
      tagValues: tagName ? influxTagValues(tagName) : influxTagValues('host'),
      measurements: influxMeasurements(bucket),
      diagnostics: influxDiagnostics(),
    }
  }

  if (nodeId.startsWith('fields:') || nodeId.startsWith('field:')) {
    const fieldName = nodeId.startsWith('field:') ? nodeId.split(':')[2] : undefined
    return {
      ...base,
      objectView: fieldName ? 'field' : 'fields',
      fields: influxFields(bucket).filter((field) => !fieldName || field.name === fieldName),
      measurements: influxMeasurements(bucket),
      diagnostics: influxDiagnostics(),
    }
  }

  if (nodeId.startsWith('retention:')) {
    return {
      ...base,
      objectView: 'retention-policies',
      buckets: influxBuckets(bucket).filter((item) => item.name === bucket),
      retentionPolicies: influxRetentionPolicies(bucket),
      diagnostics: influxDiagnostics(),
      warnings: ['Retention changes are admin operations and should be previewed before execution.'],
    }
  }

  if (nodeId === 'influx:tasks' || nodeId.startsWith('task:')) {
    const taskName = nodeId.startsWith('task:') ? nodeId.replace('task:', '') : undefined
    return {
      ...base,
      objectView: taskName ? 'task' : 'tasks',
      tasks: influxTasks().filter((task) => !taskName || task.name === taskName),
      diagnostics: influxDiagnostics(),
    }
  }

  if (nodeId === 'influx:security') {
    return {
      ...base,
      objectView: 'security',
      tokens: influxTokens(),
      diagnostics: influxDiagnostics(),
      permissionWarnings: [
        { scope: 'tokens', reason: 'Token values are write-only and never displayed after creation.' },
      ],
    }
  }

  return {
    ...base,
    objectView: 'diagnostics',
    buckets: influxBuckets(bucket),
    measurements: influxMeasurements(bucket),
    tasks: influxTasks(),
    retentionPolicies: influxRetentionPolicies(bucket),
    diagnostics: influxDiagnostics(),
  }
}

function influxBucketPayload(bucket: string) {
  return {
    ...influxBasePayload(bucket),
    objectView: 'bucket',
    buckets: influxBuckets(bucket).filter((item) => item.name === bucket),
    measurements: influxMeasurements(bucket),
    tags: influxTags(bucket),
    fields: influxFields(bucket),
    retentionPolicies: influxRetentionPolicies(bucket),
    tasks: influxTasks(),
    diagnostics: influxDiagnostics(),
  }
}

function influxNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return {
    family: 'timeseries',
    ...node,
  }
}

function influxDefaultBucket(connection: ConnectionProfile) {
  return connection.database?.trim() || ''
}

function influxBucketFromNodeId(connection: ConnectionProfile, nodeId: string) {
  const parts = nodeId.split(':')
  if (parts[0] === 'bucket' || parts[0] === 'measurement' || parts[0] === 'measurements' || parts[0] === 'tags' || parts[0] === 'tag' || parts[0] === 'fields' || parts[0] === 'field' || parts[0] === 'retention') {
    return parts[1] || influxDefaultBucket(connection)
  }

  return influxDefaultBucket(connection)
}

function influxBasePayload(bucket: string) {
  return {
    engine: 'influxdb',
    version: '2.x compatible',
    bucket,
    measurementCount: influxMeasurements(bucket).length,
    seriesCount: 18420,
    retention: '30 d',
    storage: '1.8 GB',
    taskCount: influxTasks().length,
  }
}

function influxMeasurementQuery(bucket: string, measurement: string) {
  return `from(bucket: "${bucket}")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "${measurement}")`
}
