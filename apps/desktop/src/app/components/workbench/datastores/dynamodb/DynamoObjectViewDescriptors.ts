export type DynamoObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, DynamoObjectViewDescriptor> = {
  tables: descriptor('tables', 'Open Tables', 'DynamoDB Tables', 'Review tables, billing mode, item counts, storage, indexes, streams, and TTL state.', 'No tables were returned', 'Refresh tables or verify the account can list DynamoDB tables.'),
  table: descriptor('table', 'Open Table', 'DynamoDB Table', 'Inspect partition/sort keys, GSIs, LSIs, streams, TTL, capacity, alarms, permissions, and a bounded item query.', 'No table metadata is loaded', 'Refresh this table to collect DynamoDB metadata.', 'Open Item Query'),
  items: descriptor('items', 'Query Items', 'DynamoDB Items', 'Run a partition-key-first query or bounded scan for this table.', 'No item query target is loaded', 'Open the query action to read table items.', 'Open Item Query'),
  keys: descriptor('keys', 'Review Keys', 'DynamoDB Keys', 'Review partition key, sort key, projected keys, and key-type hints for safe query building.', 'No key schema was returned', 'This table may not expose key metadata to the current account.'),
  indexes: descriptor('indexes', 'Open Indexes', 'DynamoDB Indexes', 'Review global and local secondary indexes, projections, key schema, capacity, and item counts.', 'No indexes were returned', 'This table may not define secondary indexes.'),
  'global-secondary-indexes': descriptor('global-secondary-indexes', 'Open GSIs', 'Global Secondary Indexes', 'Review GSI partition/sort keys, projections, capacity, item counts, and backfill state.', 'No GSIs were returned', 'This table may not define global secondary indexes.'),
  'local-secondary-indexes': descriptor('local-secondary-indexes', 'Open LSIs', 'Local Secondary Indexes', 'Review LSI sort keys, projections, item counts, and storage size.', 'No LSIs were returned', 'This table may not define local secondary indexes.'),
  streams: descriptor('streams', 'Open Streams', 'DynamoDB Streams', 'Review stream status, view type, ARN, shard hints, and consumer/trigger readiness.', 'No stream metadata was returned', 'Streams may be disabled for this table.'),
  ttl: descriptor('ttl', 'Open TTL', 'DynamoDB TTL', 'Review TTL attribute, status, expiry behavior, and stale-item risk.', 'No TTL metadata was returned', 'TTL may be disabled for this table.'),
  capacity: descriptor('capacity', 'Open Capacity', 'DynamoDB Capacity', 'Review billing mode, consumed capacity, throttles, auto scaling, and hot partition hints.', 'No capacity metadata was returned', 'Capacity metrics may be unavailable in preview or restricted by permissions.'),
  backups: descriptor('backups', 'Open Backups', 'DynamoDB Backups', 'Review point-in-time recovery, on-demand backups, and restore-readiness.', 'No backups were returned', 'Backups may be disabled or restricted.'),
  security: descriptor('security', 'Review Access', 'DynamoDB Access', 'Review IAM-style principals, table policies, index privileges, and disabled-operation reasons.', 'No access metadata is loaded', 'Refresh access metadata or verify permissions.'),
  permissions: descriptor('permissions', 'Review Permissions', 'DynamoDB Permissions', 'Review table, index, stream, and item-write permissions visible to the current identity.', 'No permissions were returned', 'The current identity may not inspect IAM policies.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'DynamoDB Diagnostics', 'Review consumed capacity, throttles, latency, hot partitions, alarms, backups, and stream health.', 'No diagnostics are loaded', 'Refresh diagnostics to collect available DynamoDB metrics.'),
  'hot-partitions': descriptor('hot-partitions', 'Review Hot Partitions', 'Hot Partitions', 'Review high-traffic partition keys, throttles, and adaptive-capacity signals.', 'No hot partition signals were returned', 'No hot partitions were detected or metrics are unavailable.'),
  alarms: descriptor('alarms', 'Open Alarms', 'DynamoDB Alarms', 'Review alarm state for throttles, consumed capacity, latency, and stream processing.', 'No alarms were returned', 'No alarms were configured or visible.'),
}

const DEFAULT_DESCRIPTOR = descriptor(
  'object',
  'Inspect DynamoDB Object',
  'DynamoDB Object',
  'Review available DynamoDB metadata for this object.',
  'DynamoDB metadata is not available',
  'Refresh this object or check whether the account can inspect it.',
)

export function getDynamoObjectViewDescriptor(kind: string | undefined): DynamoObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeDynamoObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function dynamoObjectViewMenuLabel(kind: string | undefined): string {
  return getDynamoObjectViewDescriptor(kind).menuLabel
}

export function isDynamoObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeDynamoObjectKind(kind)])
}

export const DYNAMO_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): DynamoObjectViewDescriptor {
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

function normalizeDynamoObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
