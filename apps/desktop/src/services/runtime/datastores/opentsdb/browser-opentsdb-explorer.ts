import type { ExplorerNode } from '@datapadplusplus/shared-types'
import {
  openTsdbAggregators,
  openTsdbDiagnostics,
  openTsdbDownsampling,
  openTsdbMetricDiagnostics,
  openTsdbMetrics,
  openTsdbStats,
  openTsdbTagValues,
  openTsdbTags,
  openTsdbTrees,
  openTsdbUidMetadata,
} from './browser-opentsdb-fixtures'

export function createOpenTsdbExplorerNodes(scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      openTsdbNode({
        id: 'opentsdb:metrics',
        label: 'Metrics',
        kind: 'metrics',
        detail: 'Metric names and tag coverage',
        scope: 'opentsdb:metrics',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:tags',
        label: 'Tags',
        kind: 'tags',
        detail: 'Tag keys and values',
        scope: 'opentsdb:tags',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:aggregators',
        label: 'Aggregators',
        kind: 'aggregators',
        detail: 'Supported aggregation functions',
        scope: 'opentsdb:aggregators',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:downsampling',
        label: 'Downsampling',
        kind: 'downsampling',
        detail: 'Downsample windows and fill policies',
        scope: 'opentsdb:downsampling',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:uid-metadata',
        label: 'UID Metadata',
        kind: 'uid-metadata',
        detail: 'Metric and tag metadata records',
        scope: 'opentsdb:uid-metadata',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:trees',
        label: 'Trees',
        kind: 'trees',
        detail: 'Tree rules and hierarchy health',
        scope: 'opentsdb:trees',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:stats',
        label: 'Stats',
        kind: 'stats',
        detail: 'Runtime counters and storage signals',
        scope: 'opentsdb:stats',
      }),
      openTsdbNode({
        id: 'opentsdb:diagnostics',
        label: 'Diagnostics',
        kind: 'diagnostics',
        detail: 'Backend health and query risk',
        scope: 'opentsdb:diagnostics',
      }),
    ]
  }

  if (scope === 'opentsdb:metrics') {
    return openTsdbMetrics().map((metric) =>
      openTsdbNode({
        id: `metric:${metric.name}`,
        label: metric.name,
        kind: 'metric',
        detail: `${metric.tags} tag(s) | ${metric.cardinality} cardinality`,
        path: ['Metrics'],
        scope: `metric:${metric.name}`,
        expandable: true,
        queryTemplate: openTsdbMetricQuery(metric.name),
      }),
    )
  }

  if (scope.startsWith('metric:')) {
    const metric = scope.replace('metric:', '')
    return [
      openTsdbNode({
        id: `metric-tags:${metric}`,
        label: 'Tags',
        kind: 'tags',
        detail: 'Tag keys used by this metric',
        path: ['Metrics', metric],
        scope: `metric-tags:${metric}`,
        expandable: true,
      }),
      openTsdbNode({
        id: `metric-uid:${metric}`,
        label: 'UID Metadata',
        kind: 'uid-metadata',
        detail: 'Metric UID and description',
        path: ['Metrics', metric],
        scope: `metric-uid:${metric}`,
      }),
      openTsdbNode({
        id: `metric-stats:${metric}`,
        label: 'Stats',
        kind: 'stats',
        detail: 'Recent write and query shape',
        path: ['Metrics', metric],
        scope: `metric-stats:${metric}`,
      }),
    ]
  }

  if (scope === 'opentsdb:tags' || scope.startsWith('metric-tags:')) {
    const metric = scope.startsWith('metric-tags:') ? scope.replace('metric-tags:', '') : undefined
    return openTsdbTags(metric).map((tag) =>
      openTsdbNode({
        id: `tag:${tag.name}`,
        label: tag.name,
        kind: 'tag',
        detail: `${tag.valueCount} values | ${tag.risk}`,
        path: metric ? ['Metrics', metric, 'Tags'] : ['Tags'],
        scope: `tag:${tag.name}`,
        expandable: true,
      }),
    )
  }

  if (scope.startsWith('tag:')) {
    const tag = scope.replace('tag:', '')
    return openTsdbTagValues(tag).map((value) =>
      openTsdbNode({
        id: `tag-value:${tag}:${value.value}`,
        label: String(value.value),
        kind: 'tag',
        detail: `${value.series} series | ${value.exampleMetric}`,
        path: ['Tags', tag],
        scope: `tag:${tag}`,
      }),
    )
  }

  if (scope === 'opentsdb:aggregators') {
    return openTsdbAggregators().map((aggregator) =>
      openTsdbNode({
        id: `aggregator:${aggregator.name}`,
        label: aggregator.name,
        kind: 'aggregator',
        detail: aggregator.bestFor,
        path: ['Aggregators'],
        scope: `aggregator:${aggregator.name}`,
      }),
    )
  }

  if (scope === 'opentsdb:downsampling') {
    return openTsdbDownsampling().map((downsampler) =>
      openTsdbNode({
        id: `downsampler:${downsampler.expression}`,
        label: downsampler.expression,
        kind: 'downsampler',
        detail: downsampler.bestFor,
        path: ['Downsampling'],
        scope: `downsampler:${downsampler.expression}`,
      }),
    )
  }

  if (scope === 'opentsdb:uid-metadata') {
    return openTsdbUidMetadata().map((uid) =>
      openTsdbNode({
        id: `uid:${uid.kind}:${uid.name}`,
        label: uid.name,
        kind: 'uid',
        detail: `${uid.kind} | ${uid.uid}`,
        path: ['UID Metadata'],
        scope: `uid:${uid.kind}:${uid.name}`,
      }),
    )
  }

  if (scope === 'opentsdb:trees') {
    return openTsdbTrees().map((tree) =>
      openTsdbNode({
        id: `tree:${tree.name}`,
        label: tree.name,
        kind: 'tree',
        detail: tree.enabled ? `${tree.rules} rule(s)` : 'disabled',
        path: ['Trees'],
        scope: `tree:${tree.name}`,
      }),
    )
  }

  return []
}

export function openTsdbInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('metric:')) {
    return openTsdbMetricQuery(nodeId.replace('metric:', ''))
  }

  return openTsdbMetricQuery('sys.cpu.user')
}

export function openTsdbInspectPayload(nodeId: string) {
  const base = openTsdbBasePayload()

  if (nodeId === 'opentsdb:metrics') {
    return {
      ...base,
      objectView: 'metrics',
      metrics: openTsdbMetrics(),
      tags: openTsdbTags(),
      diagnostics: openTsdbDiagnostics(),
    }
  }

  if (nodeId.startsWith('metric:')) {
    const metric = nodeId.replace('metric:', '')
    return {
      ...base,
      objectView: 'metric',
      metric,
      metrics: openTsdbMetrics().filter((item) => item.name === metric),
      tags: openTsdbTags(metric),
      uidMetadata: openTsdbUidMetadata().filter((uid) => uid.name === metric || uid.kind === 'metric'),
      stats: openTsdbStats().filter((stat) => stat.name.includes('query') || stat.name.includes('write')),
      diagnostics: openTsdbMetricDiagnostics(metric),
    }
  }

  if (nodeId === 'opentsdb:tags' || nodeId.startsWith('tag:') || nodeId.startsWith('metric-tags:')) {
    const tag = nodeId.startsWith('tag:') ? nodeId.split(':')[1] : undefined
    return {
      ...base,
      objectView: tag ? 'tag' : 'tags',
      tags: openTsdbTags().filter((item) => !tag || item.name === tag),
      tagValues: tag ? openTsdbTagValues(tag) : openTsdbTagValues('host'),
      metrics: openTsdbMetrics(),
      diagnostics: openTsdbDiagnostics(),
    }
  }

  if (nodeId === 'opentsdb:aggregators' || nodeId.startsWith('aggregator:')) {
    const aggregator = nodeId.startsWith('aggregator:') ? nodeId.replace('aggregator:', '') : undefined
    return {
      ...base,
      objectView: aggregator ? 'aggregator' : 'aggregators',
      aggregators: openTsdbAggregators().filter((item) => !aggregator || item.name === aggregator),
      diagnostics: openTsdbDiagnostics(),
    }
  }

  if (nodeId === 'opentsdb:downsampling' || nodeId.startsWith('downsampler:')) {
    const expression = nodeId.startsWith('downsampler:') ? nodeId.replace('downsampler:', '') : undefined
    return {
      ...base,
      objectView: expression ? 'downsampler' : 'downsampling',
      downsampling: openTsdbDownsampling().filter((item) => !expression || item.expression === expression),
      aggregators: openTsdbAggregators(),
      diagnostics: openTsdbDiagnostics(),
    }
  }

  if (nodeId === 'opentsdb:uid-metadata' || nodeId.startsWith('uid:') || nodeId.startsWith('metric-uid:')) {
    const [, kind, name] = nodeId.split(':')
    return {
      ...base,
      objectView: name ? 'uid' : 'uid-metadata',
      uidMetadata: openTsdbUidMetadata().filter((uid) => !name || (uid.kind === kind && uid.name === name)),
      metrics: openTsdbMetrics(),
      tags: openTsdbTags(),
      diagnostics: openTsdbDiagnostics(),
    }
  }

  if (nodeId === 'opentsdb:trees' || nodeId.startsWith('tree:')) {
    const tree = nodeId.startsWith('tree:') ? nodeId.replace('tree:', '') : undefined
    return {
      ...base,
      objectView: tree ? 'tree' : 'trees',
      trees: openTsdbTrees().filter((item) => !tree || item.name === tree),
      diagnostics: openTsdbDiagnostics(),
      warnings: ['Tree changes are metadata operations and should be previewed before execution.'],
    }
  }

  return {
    ...base,
    objectView: nodeId === 'opentsdb:stats' ? 'stats' : 'diagnostics',
    stats: openTsdbStats(),
    diagnostics: openTsdbDiagnostics(),
  }
}

function openTsdbNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return {
    family: 'timeseries',
    ...node,
  }
}

function openTsdbMetricQuery(metric: string) {
  return JSON.stringify(
    {
      start: '1h-ago',
      queries: [
        {
          metric,
          aggregator: 'avg',
          downsample: '1m-avg',
          tags: {},
        },
      ],
    },
    null,
    2,
  )
}

function openTsdbBasePayload() {
  return {
    engine: 'opentsdb',
    version: '2.x compatible',
    metricCount: openTsdbMetrics().length,
    tagKeyCount: openTsdbTags().length,
    uidCount: openTsdbUidMetadata().length,
    writesPerSecond: '4.8k/s',
    queriesPerSecond: '12/s',
    storage: 'HBase',
  }
}
