export type InfluxObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, InfluxObjectViewDescriptor> = {
  buckets: descriptor('buckets', 'Browse Buckets', 'InfluxDB Buckets', 'Review buckets, retention, shard groups, series counts, and write/query readiness.', 'No buckets are loaded', 'Refresh buckets or verify the token can list buckets.'),
  bucket: descriptor('bucket', 'Open Bucket', 'InfluxDB Bucket', 'Inspect measurements, tags, fields, retention, tasks, permissions, and storage signals for this bucket.', 'Bucket metadata is not loaded', 'Refresh this bucket to collect schema metadata.'),
  measurements: descriptor('measurements', 'Browse Measurements', 'Measurements', 'Review measurement names, field/tag counts, cardinality, and recent write activity.', 'No measurements are loaded', 'Refresh schema metadata for this bucket.'),
  measurement: descriptor('measurement', 'Open Measurement', 'Measurement', 'Inspect fields, tags, series cardinality, sample ranges, and safe Flux or InfluxQL entry points.', 'Measurement metadata is not loaded', 'Refresh this measurement or open a query.', 'Query Measurement'),
  tags: descriptor('tags', 'Browse Tags', 'Tags', 'Review indexed tag keys, value counts, and cardinality risk before composing filters.', 'No tags are loaded', 'Refresh tag metadata for this bucket.'),
  tag: descriptor('tag', 'Open Tag', 'Tag', 'Inspect one tag key, representative values, related measurements, and cardinality risk.', 'Tag metadata is not loaded', 'Refresh this tag to collect values.'),
  fields: descriptor('fields', 'Browse Fields', 'Fields', 'Review field keys, value types, units, and measurement usage.', 'No fields are loaded', 'Refresh field metadata for this bucket.'),
  field: descriptor('field', 'Open Field', 'Field', 'Inspect one field key, value type, measurement usage, and sample values.', 'Field metadata is not loaded', 'Refresh this field to collect examples.'),
  'retention-policies': descriptor('retention-policies', 'Manage Retention', 'Retention Policies', 'Review retention duration, shard group duration, replication, and guarded retention-change previews.', 'No retention policies are loaded', 'Refresh retention metadata or verify bucket permissions.'),
  retention: descriptor('retention', 'Open Retention Policy', 'Retention Policy', 'Inspect one retention policy or bucket retention rule and its storage impact.', 'Retention metadata is not loaded', 'Refresh this retention policy.'),
  tasks: descriptor('tasks', 'Review Tasks', 'InfluxDB Tasks', 'Review Flux tasks, schedules, last run status, failures, and guarded task management entry points.', 'No tasks are loaded', 'This connection may not use InfluxDB tasks.'),
  task: descriptor('task', 'Open Task', 'InfluxDB Task', 'Inspect one task schedule, status, script summary, last runs, and failure signals.', 'Task metadata is not loaded', 'Refresh this task to collect run state.'),
  security: descriptor('security', 'Review Tokens', 'InfluxDB Security', 'Review visible authorizations, token scopes, org/bucket permissions, and disabled actions.', 'No token metadata is loaded', 'Token metadata may be unavailable or restricted.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'InfluxDB Diagnostics', 'Review cardinality, storage, query performance, task failures, and version compatibility signals.', 'No diagnostics are loaded', 'Refresh diagnostics to collect InfluxDB status metadata.'),
}

const DEFAULT_DESCRIPTOR = descriptor(
  'object',
  'Inspect InfluxDB Object',
  'InfluxDB Object',
  'Review available InfluxDB metadata for this object.',
  'InfluxDB metadata is not available',
  'Refresh this object or check whether the connection can inspect it.',
)

export function getInfluxObjectViewDescriptor(kind: string | undefined): InfluxObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeInfluxObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function influxObjectViewMenuLabel(kind: string | undefined): string {
  return getInfluxObjectViewDescriptor(kind).menuLabel
}

export function isInfluxObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeInfluxObjectKind(kind)])
}

export const INFLUX_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): InfluxObjectViewDescriptor {
  return {
    kind,
    menuLabel,
    title,
    purpose,
    emptyTitle,
    emptyDescription,
    primaryQueryLabel,
  }
}

function normalizeInfluxObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
