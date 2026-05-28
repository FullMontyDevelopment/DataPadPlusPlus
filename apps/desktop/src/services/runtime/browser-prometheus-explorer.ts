import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import {
  prometheusAlerts,
  prometheusDiagnostics,
  prometheusLabelValues,
  prometheusLabels,
  prometheusMetricDiagnostics,
  prometheusMetricLabels,
  prometheusMetrics,
  prometheusRuleGroups,
  prometheusRules,
  prometheusSeries,
  prometheusServiceDiscovery,
  prometheusStorageBlocks,
  prometheusTargets,
  prometheusTsdbStats,
} from './browser-prometheus-fixtures'

export function createPrometheusExplorerNodes(scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      prometheusNode({
        id: 'prometheus:metrics',
        label: 'Metrics',
        kind: 'metrics',
        detail: 'Metric families and cardinality signals',
        scope: 'prometheus:metrics',
        expandable: true,
      }),
      prometheusNode({
        id: 'prometheus:labels',
        label: 'Labels',
        kind: 'labels',
        detail: 'Label names and high-cardinality dimensions',
        scope: 'prometheus:labels',
        expandable: true,
      }),
      prometheusNode({
        id: 'prometheus:targets',
        label: 'Targets',
        kind: 'targets',
        detail: 'Scrape health and target labels',
        scope: 'prometheus:targets',
        expandable: true,
      }),
      prometheusNode({
        id: 'prometheus:rules',
        label: 'Rules',
        kind: 'rules',
        detail: 'Recording and alerting rule groups',
        scope: 'prometheus:rules',
        expandable: true,
      }),
      prometheusNode({
        id: 'prometheus:alerts',
        label: 'Alerts',
        kind: 'alerts',
        detail: 'Firing and pending alerts',
        scope: 'prometheus:alerts',
        expandable: true,
      }),
      prometheusNode({
        id: 'prometheus:service-discovery',
        label: 'Service Discovery',
        kind: 'service-discovery',
        detail: 'Discovered and dropped targets',
        scope: 'prometheus:service-discovery',
      }),
      prometheusNode({
        id: 'prometheus:tsdb',
        label: 'TSDB / Storage',
        kind: 'tsdb',
        detail: 'Head series, chunks, blocks, and retention',
        scope: 'prometheus:tsdb',
      }),
      prometheusNode({
        id: 'prometheus:diagnostics',
        label: 'Diagnostics',
        kind: 'diagnostics',
        detail: 'Runtime status and query-risk signals',
        scope: 'prometheus:diagnostics',
      }),
    ]
  }

  if (scope === 'prometheus:metrics') {
    return prometheusMetrics().map((metric) =>
      prometheusNode({
        id: `metric:${metric.name}`,
        label: metric.name,
        kind: 'metric',
        detail: `${metric.type} | ${metric.series} series`,
        path: ['Metrics'],
        scope: `metric:${metric.name}`,
        expandable: true,
        queryTemplate: metric.name,
      }),
    )
  }

  if (scope.startsWith('metric:')) {
    const metric = scope.replace('metric:', '')
    return [
      prometheusNode({
        id: `series:${metric}`,
        label: 'Series',
        kind: 'series',
        detail: 'Bounded label combinations',
        path: ['Metrics', metric],
        scope: `series:${metric}`,
        queryTemplate: `${metric}{job=~".+"}`,
      }),
      prometheusNode({
        id: `labels:${metric}`,
        label: 'Labels',
        kind: 'labels',
        detail: 'Dimensions on this metric',
        path: ['Metrics', metric],
        scope: `labels:${metric}`,
      }),
      prometheusNode({
        id: `alerts:${metric}`,
        label: 'Related Alerts',
        kind: 'alerts',
        detail: 'Alerting rules referencing this metric',
        path: ['Metrics', metric],
        scope: `alerts:${metric}`,
      }),
    ]
  }

  if (scope === 'prometheus:labels') {
    return prometheusLabels().map((label) =>
      prometheusNode({
        id: `label:${label.name}`,
        label: label.name,
        kind: 'label',
        detail: `${label.valueCount} value(s) | ${label.risk}`,
        path: ['Labels'],
        scope: `label:${label.name}`,
        expandable: true,
      }),
    )
  }

  if (scope.startsWith('label:')) {
    const label = scope.replace('label:', '')
    return prometheusLabelValues(label).map((value) =>
      prometheusNode({
        id: `label-value:${label}:${value.value}`,
        label: value.value,
        kind: 'series',
        detail: `${value.series} series`,
        path: ['Labels', label],
        scope: `series-by-label:${label}:${value.value}`,
        queryTemplate: `{${label}="${value.value}"}`,
      }),
    )
  }

  if (scope === 'prometheus:targets') {
    return prometheusTargets().map((target) =>
      prometheusNode({
        id: `target:${target.job}:${target.instance}`,
        label: `${target.job} / ${target.instance}`,
        kind: 'target',
        detail: `${target.health} | ${target.lastScrape}`,
        path: ['Targets'],
        scope: `target:${target.job}:${target.instance}`,
      }),
    )
  }

  if (scope === 'prometheus:rules') {
    return prometheusRuleGroups().map((group) =>
      prometheusNode({
        id: `rule-group:${group.name}`,
        label: group.name,
        kind: 'rule-group',
        detail: `${group.rules} rule(s) | ${group.health}`,
        path: ['Rules'],
        scope: `rule-group:${group.name}`,
        expandable: true,
      }),
    )
  }

  if (scope.startsWith('rule-group:')) {
    const group = scope.replace('rule-group:', '')
    return prometheusRules().filter((rule) => rule.group === group).map((rule) =>
      prometheusNode({
        id: `rule:${rule.group}:${rule.name}`,
        label: rule.name,
        kind: 'rule',
        detail: `${rule.type} | ${rule.health}`,
        path: ['Rules', group],
        scope: `rule:${rule.group}:${rule.name}`,
        queryTemplate: rule.expression,
      }),
    )
  }

  if (scope === 'prometheus:alerts') {
    return prometheusAlerts().map((alert) =>
      prometheusNode({
        id: `alert:${alert.name}`,
        label: alert.name,
        kind: 'alert',
        detail: `${alert.state} | ${alert.severity}`,
        path: ['Alerts'],
        scope: `alert:${alert.name}`,
      }),
    )
  }

  return []
}

export function prometheusInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('metric:')) {
    return nodeId.replace('metric:', '')
  }

  if (nodeId.startsWith('series:')) {
    const metric = nodeId.replace('series:', '')
    return `${metric}{job=~".+"}`
  }

  if (nodeId.startsWith('label-value:')) {
    const [, label = 'job', value = 'app'] = nodeId.split(':')
    return `{${label}="${value}"}`
  }

  if (nodeId.startsWith('rule:')) {
    const [, group = '', name = ''] = nodeId.split(':')
    return prometheusRules().find((rule) => rule.group === group && rule.name === name)?.expression ?? 'up'
  }

  if (nodeId === 'prometheus:alerts') {
    return 'ALERTS'
  }

  return 'up'
}

export function prometheusInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const base = prometheusBasePayload(connection)

  if (nodeId === 'prometheus:metrics') {
    return {
      ...base,
      objectView: 'metrics',
      metrics: prometheusMetrics(),
      labels: prometheusLabels(),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId.startsWith('metric:')) {
    const metricName = nodeId.replace('metric:', '')
    const metric = prometheusMetrics().find((item) => item.name === metricName)
    return {
      ...base,
      objectView: 'metric',
      metric: metricName,
      metrics: metric ? [metric] : [],
      series: prometheusSeries(metricName),
      labels: prometheusMetricLabels(metricName),
      diagnostics: prometheusMetricDiagnostics(metricName),
    }
  }

  if (nodeId === 'prometheus:labels' || nodeId.startsWith('label:')) {
    const label = nodeId.startsWith('label:') ? nodeId.replace('label:', '') : undefined
    return {
      ...base,
      objectView: label ? 'label' : 'labels',
      label,
      labels: prometheusLabels().filter((item) => !label || item.name === label),
      labelValues: label ? prometheusLabelValues(label) : prometheusLabelValues('job'),
      metrics: label ? prometheusMetrics().filter((metric) => metric.labels.includes(label)) : prometheusMetrics(),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId.startsWith('series:') || nodeId.startsWith('label-value:')) {
    const metric = nodeId.startsWith('series:') ? nodeId.replace('series:', '') : undefined
    return {
      ...base,
      objectView: 'series',
      series: prometheusSeries(metric),
      labels: prometheusLabels(),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId === 'prometheus:targets' || nodeId.startsWith('target:')) {
    return {
      ...base,
      objectView: 'targets',
      targets: prometheusTargets(),
      serviceDiscovery: prometheusServiceDiscovery(),
      diagnostics: prometheusDiagnostics(),
      warnings: prometheusTargets().some((target) => target.health !== 'up')
        ? ['One scrape target is down. Review last error before trusting missing series.']
        : [],
    }
  }

  if (nodeId === 'prometheus:rules' || nodeId.startsWith('rule-group:') || nodeId.startsWith('rule:')) {
    const [, groupName] = nodeId.split(':')
    return {
      ...base,
      objectView: 'rules',
      rules: prometheusRules().filter((rule) => !groupName || rule.group === groupName),
      alerts: prometheusAlerts(),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId === 'prometheus:alerts' || nodeId.startsWith('alert:')) {
    return {
      ...base,
      objectView: 'alerts',
      alerts: prometheusAlerts(),
      rules: prometheusRules().filter((rule) => rule.type === 'alerting'),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId === 'prometheus:service-discovery') {
    return {
      ...base,
      objectView: 'service-discovery',
      serviceDiscovery: prometheusServiceDiscovery(),
      targets: prometheusTargets(),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId === 'prometheus:tsdb' || nodeId === 'prometheus:storage') {
    return {
      ...base,
      objectView: 'tsdb',
      tsdb: prometheusTsdbStats(),
      storage: prometheusStorageBlocks(),
      diagnostics: prometheusDiagnostics(),
      warnings: ['High-cardinality labels can make broad series and label APIs expensive.'],
    }
  }

  return {
    ...base,
    objectView: 'diagnostics',
    metrics: prometheusMetrics(),
    targets: prometheusTargets(),
    rules: prometheusRules(),
    alerts: prometheusAlerts(),
    tsdb: prometheusTsdbStats(),
    storage: prometheusStorageBlocks(),
    diagnostics: prometheusDiagnostics(),
  }
}

function prometheusNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return {
    family: 'timeseries',
    ...node,
  }
}

function prometheusBasePayload(connection: ConnectionProfile) {
  return {
    engine: 'prometheus',
    endpoint: connection.connectionString || `${connection.host ?? 'localhost'}:${connection.port ?? 9090}`,
    metricCount: prometheusMetrics().length,
    seriesCount: 12840,
    sampleCount: '2.4 M',
    upTargets: prometheusTargets().filter((target) => target.health === 'up').length,
    downTargets: prometheusTargets().filter((target) => target.health !== 'up').length,
    ruleCount: prometheusRules().length,
    alertCount: prometheusAlerts().length,
    retention: '15 d',
  }
}
