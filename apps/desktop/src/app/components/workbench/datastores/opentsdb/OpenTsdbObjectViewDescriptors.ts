export type OpenTsdbObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, OpenTsdbObjectViewDescriptor> = {
  metrics: descriptor('metrics', 'Browse Metrics', 'OpenTSDB Metrics', 'Review metric names, tag coverage, UID status, retention shape, and safe query entry points.', 'No metrics are loaded', 'Refresh metrics or verify the OpenTSDB HTTP API can list metric metadata.'),
  metric: descriptor('metric', 'Open Metric', 'OpenTSDB Metric', 'Inspect one metric, related tag keys, tag values, UID metadata, recent write shape, and query cost hints.', 'Metric metadata is not loaded', 'Refresh this metric or open a scoped OpenTSDB query.', 'Query Metric'),
  tags: descriptor('tags', 'Browse Tags', 'OpenTSDB Tags', 'Review tag keys, tag value counts, metric coverage, and cardinality risk before composing filters.', 'No tag metadata is loaded', 'Refresh tag metadata or narrow to a metric.'),
  tag: descriptor('tag', 'Open Tag', 'OpenTSDB Tag', 'Inspect one tag key, representative values, related metrics, and cardinality risk.', 'Tag metadata is not loaded', 'Refresh this tag to collect values and related metrics.'),
  aggregators: descriptor('aggregators', 'Review Aggregators', 'OpenTSDB Aggregators', 'Review supported aggregation functions and when they should be used in queries.', 'No aggregators are loaded', 'Refresh OpenTSDB capabilities or verify the API supports aggregator metadata.'),
  aggregator: descriptor('aggregator', 'Open Aggregator', 'OpenTSDB Aggregator', 'Inspect one aggregation function, interpolation behavior, and query usage guidance.', 'Aggregator metadata is not loaded', 'Refresh this aggregator.'),
  downsampling: descriptor('downsampling', 'Review Downsampling', 'Downsampling', 'Review common downsampling windows, fill strategies, and query-readiness guidance.', 'No downsampling guidance is loaded', 'Refresh capabilities or add a query downsampling rule.'),
  downsampler: descriptor('downsampler', 'Open Downsampler', 'OpenTSDB Downsampler', 'Inspect one downsampling expression, aggregation function, and fill policy.', 'Downsampler metadata is not loaded', 'Refresh this downsampling expression.'),
  'uid-metadata': descriptor('uid-metadata', 'Review UID Metadata', 'UID Metadata', 'Review metric/tag UID assignments, descriptions, notes, and missing metadata warnings.', 'No UID metadata is loaded', 'Refresh UID metadata or verify UID APIs are enabled.'),
  uid: descriptor('uid', 'Open UID Metadata', 'UID Metadata', 'Inspect one UID record, display name, description, and related object.', 'UID metadata is not loaded', 'Refresh this UID record.'),
  trees: descriptor('trees', 'Review Trees', 'OpenTSDB Trees', 'Review tree definitions, branch rules, collisions, and hierarchy health.', 'No tree metadata is loaded', 'This OpenTSDB deployment may not use trees.'),
  tree: descriptor('tree', 'Open Tree', 'OpenTSDB Tree', 'Inspect one tree definition, branch rules, collisions, and enabled state.', 'Tree metadata is not loaded', 'Refresh this tree.'),
  stats: descriptor('stats', 'Open Stats', 'OpenTSDB Stats', 'Review writes, queries, cache, storage, UID, and backend health signals.', 'No stats are loaded', 'Refresh stats or verify the stats endpoint is enabled.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'OpenTSDB Diagnostics', 'Review backend health, storage latency, compaction, UID pressure, and query-risk warnings.', 'No diagnostics are loaded', 'Refresh diagnostics to collect OpenTSDB status metadata.'),
}

const DEFAULT_DESCRIPTOR = descriptor(
  'object',
  'Inspect OpenTSDB Object',
  'OpenTSDB Object',
  'Review available OpenTSDB metadata for this object.',
  'OpenTSDB metadata is not available',
  'Refresh this object or check whether the connection can inspect it.',
)

export function getOpenTsdbObjectViewDescriptor(kind: string | undefined): OpenTsdbObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeOpenTsdbObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function openTsdbObjectViewMenuLabel(kind: string | undefined): string {
  return getOpenTsdbObjectViewDescriptor(kind).menuLabel
}

export function isOpenTsdbObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeOpenTsdbObjectKind(kind)])
}

export const OPENTSDB_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): OpenTsdbObjectViewDescriptor {
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

function normalizeOpenTsdbObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
