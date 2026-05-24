export type PrometheusObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, PrometheusObjectViewDescriptor> = {
  metrics: descriptor('metrics', 'Browse Metrics', 'Prometheus Metrics', 'Review metric families, types, help text, series counts, and cardinality signals before writing PromQL.', 'No metrics are loaded', 'Refresh metrics or verify the Prometheus HTTP API is reachable.'),
  metric: descriptor('metric', 'Open Metric', 'Prometheus Metric', 'Inspect one metric family, labels, recent series, sample values, and safe PromQL entry points.', 'Metric metadata is not loaded', 'Refresh this metric or open a PromQL query for it.', 'Query Metric'),
  series: descriptor('series', 'Review Series', 'Prometheus Series', 'Review bounded series metadata and label combinations for this Prometheus scope.', 'No series are loaded', 'Narrow the metric or labels and refresh series metadata.'),
  labels: descriptor('labels', 'Browse Labels', 'Prometheus Labels', 'Review label names, value counts, and high-cardinality signals that affect query cost.', 'No labels are loaded', 'Refresh labels or verify label APIs are enabled.'),
  label: descriptor('label', 'Open Label', 'Prometheus Label', 'Inspect one label dimension, representative values, and related metric families.', 'Label metadata is not loaded', 'Refresh this label to collect values and related metric metadata.'),
  targets: descriptor('targets', 'Review Targets', 'Prometheus Targets', 'Review scrape target health, last scrape timings, labels, and error messages.', 'No targets are loaded', 'Refresh targets or verify target discovery is configured.'),
  target: descriptor('target', 'Open Target', 'Prometheus Target', 'Inspect one scrape target, labels, scrape duration, last error, and health status.', 'Target metadata is not loaded', 'Refresh this target to collect scrape status.'),
  rules: descriptor('rules', 'Review Rules', 'Prometheus Rules', 'Review recording and alerting rule groups, evaluation duration, health, and last errors.', 'No rules are loaded', 'Refresh rules or verify the rules API is available.'),
  'rule-group': descriptor('rule-group', 'Open Rule Group', 'Prometheus Rule Group', 'Inspect rules in a group, evaluation interval, health, and last evaluation state.', 'Rule group metadata is not loaded', 'Refresh this rule group to collect rule details.'),
  rule: descriptor('rule', 'Open Rule', 'Prometheus Rule', 'Inspect one recording or alerting rule, expression, labels, annotations, and evaluation health.', 'Rule metadata is not loaded', 'Refresh this rule to collect evaluation metadata.', 'Open Rule Query'),
  alerts: descriptor('alerts', 'Review Alerts', 'Prometheus Alerts', 'Review active alerts, state, labels, annotations, and firing durations.', 'No alerts are loaded', 'There may be no active alerts, or the alerts API may be restricted.'),
  alert: descriptor('alert', 'Open Alert', 'Prometheus Alert', 'Inspect one alert instance, state, labels, annotations, and timing.', 'Alert metadata is not loaded', 'Refresh this alert to collect alert details.'),
  'service-discovery': descriptor('service-discovery', 'Review Service Discovery', 'Service Discovery', 'Review discovered and dropped targets, label relabeling output, and discovery health.', 'No service discovery metadata is loaded', 'Refresh service discovery metadata or verify permissions.'),
  tsdb: descriptor('tsdb', 'Open TSDB Status', 'TSDB Status', 'Review head series, chunks, blocks, WAL, compaction, and cardinality risk signals.', 'No TSDB metadata is loaded', 'Refresh TSDB status or verify the status API is enabled.'),
  storage: descriptor('storage', 'Open Storage', 'Prometheus Storage', 'Review local blocks, retention, WAL, compaction, and disk-related status signals.', 'No storage metadata is loaded', 'Refresh storage metadata or verify status APIs are available.'),
  'remote-write': descriptor('remote-write', 'Review Remote Write', 'Remote Write', 'Review remote write queues, shard health, pending samples, retries, and dropped samples.', 'No remote write metadata is loaded', 'This Prometheus server may not use remote write.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'Prometheus Diagnostics', 'Review runtime, build, configuration, flags, targets, rules, and query-risk signals in one place.', 'No diagnostics are loaded', 'Refresh diagnostics to collect Prometheus status metadata.'),
  status: descriptor('status', 'Open Status', 'Prometheus Status', 'Review runtime, build info, command-line flags, and configuration status.', 'No status metadata is loaded', 'Refresh status metadata or verify the Prometheus status APIs are reachable.'),
}

const DEFAULT_DESCRIPTOR = descriptor(
  'object',
  'Inspect Prometheus Object',
  'Prometheus Object',
  'Review available Prometheus metadata for this object.',
  'Prometheus metadata is not available',
  'Refresh this object or check whether the connection can inspect it.',
)

export function getPrometheusObjectViewDescriptor(kind: string | undefined): PrometheusObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizePrometheusObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function prometheusObjectViewMenuLabel(kind: string | undefined): string {
  return getPrometheusObjectViewDescriptor(kind).menuLabel
}

export function isPrometheusObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizePrometheusObjectKind(kind)])
}

export const PROMETHEUS_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): PrometheusObjectViewDescriptor {
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

function normalizePrometheusObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
