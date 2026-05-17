import type { AdapterDiagnostics, MetricsPayload } from '@datapadplusplus/shared-types'
import { DatabaseIcon, MetricsIcon } from './icons'

export interface MetricItem {
  key: string
  name: string
  label: string
  value: number
  formattedValue: string
  formattedUnit: string
  unit: string
  labels: Record<string, string>
}

export interface MetricGroup {
  key: string
  title: string
  unit: string
  metrics: MetricItem[]
}

export function metricSummaryTiles(diagnostics?: AdapterDiagnostics) {
  return metricItems(diagnostics)
    .slice(0, 6)
    .map((metric, index) => ({
      key: `${metric.name}-${index}`,
      label: metric.label,
      value: metric.formattedValue,
      unit: metric.formattedUnit,
      Icon: index % 2 === 0 ? MetricsIcon : DatabaseIcon,
    }))
}

export function metricItems(diagnostics?: AdapterDiagnostics): MetricItem[] {
  return (
    diagnostics?.metrics
      .filter((payload): payload is MetricsPayload => payload.renderer === 'metrics')
      .flatMap((payload) => payload.metrics)
      .map((metric, index) => {
        const unit = metric.unit ?? shortMetricName(metric.name)
        const formatted = formatMetric(metric.value, unit)

        return {
          key: `${metric.name}-${index}`,
          name: metric.name,
          label: readableMetricName(metric.name),
          value: metric.value,
          unit,
          labels: metric.labels ?? {},
          formattedValue: formatted.value,
          formattedUnit: formatted.unit,
        }
      }) ?? []
  )
}

export function metricGroups(metrics: MetricItem[]): MetricGroup[] {
  const groups = new Map<string, MetricItem[]>()

  for (const metric of metrics) {
    const namespace = metric.name.split('.')[0] ?? 'metrics'
    const source = metric.labels.source ?? metric.labels.section ?? ''
    const key = `${namespace}:${metric.unit}:${source}`
    groups.set(key, [...(groups.get(key) ?? []), metric])
  }

  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      title: groupTitle(items),
      unit: items[0]?.unit ?? 'value',
      metrics: items.slice(0, 12),
    }))
    .sort((left, right) => right.metrics.length - left.metrics.length)
    .slice(0, 8)
}

function groupTitle(metrics: MetricItem[]) {
  const first = metrics[0]
  const namespace = first?.name.split('.')[0] ?? 'Metrics'
  const source = first?.labels.source ?? first?.labels.section

  if (source) {
    return `${readableMetricName(namespace)} ${readableSource(source)}`
  }

  return `${readableMetricName(namespace)} ${first?.unit ?? 'Metrics'}`
}

function readableSource(source: string) {
  return source
    .split(/[._/:-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function formatMetric(value: number, unit: string) {
  if (!Number.isFinite(value)) {
    return { value: 'n/a', unit }
  }

  if (unit === 'bytes') {
    return { value: formatBytes(value), unit: '' }
  }

  if (unit === '%') {
    return { value: `${value.toFixed(value >= 10 ? 1 : 2)}%`, unit: '' }
  }

  if (Math.abs(value) >= 1_000_000) {
    return { value: `${(value / 1_000_000).toFixed(1)} M`, unit }
  }

  if (Math.abs(value) >= 1_000) {
    return { value: `${(value / 1_000).toFixed(1)} K`, unit }
  }

  if (!Number.isInteger(value)) {
    return { value: value.toFixed(2), unit }
  }

  return { value: String(value), unit }
}

function formatBytes(value: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Math.abs(value)
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const signed = value < 0 ? -size : size
  return `${signed.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function shortMetricName(name: string) {
  return name.split('.').at(-1) ?? name
}

function readableMetricName(name: string) {
  return shortMetricName(name)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
