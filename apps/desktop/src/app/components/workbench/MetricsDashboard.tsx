import { useMemo } from 'react'
import type { AdapterDiagnostics } from '@datapadplusplus/shared-types'
import {
  type MetricGroup,
  type MetricItem,
  metricGroups,
  metricItems,
} from './MetricsDashboard.helpers'

interface MetricsDashboardProps {
  diagnostics?: AdapterDiagnostics
}

export function MetricsDashboard({ diagnostics }: MetricsDashboardProps) {
  const metrics = useMemo(() => metricItems(diagnostics), [diagnostics])
  const groups = useMemo(() => metricGroups(metrics), [metrics])

  if (metrics.length === 0) {
    return null
  }

  return (
    <section className="metrics-dashboard" aria-label="Metrics dashboard">
      <div className="metrics-widget-grid" aria-label="Metric widgets">
        {groups.map((group) => (
          <MetricWidget key={group.key} group={group} />
        ))}
      </div>
      <MetricDetailsTable metrics={metrics} />
    </section>
  )
}

function MetricWidget({ group }: { group: MetricGroup }) {
  const values = group.metrics.map((metric) => Math.max(metric.value, 0))
  const max = Math.max(...values, 1)

  return (
    <article className="metrics-widget-card">
      <header className="metrics-widget-header">
        <strong>{group.title}</strong>
        <span>{group.unit}</span>
      </header>
      <div className="metrics-widget-bars" aria-hidden="true">
        {group.metrics.map((metric) => {
          const height = Math.max(6, (Math.max(metric.value, 0) / max) * 100)

          return (
            <span
              key={metric.key}
              className="metrics-widget-bar"
              style={{ height: `${height}%` }}
              title={`${metric.label}: ${metric.formattedValue} ${metric.formattedUnit}`.trim()}
            />
          )
        })}
      </div>
      <div className="metrics-widget-legend">
        {group.metrics.slice(0, 5).map((metric) => (
          <span key={metric.key}>
            <b>{metric.label}</b>
            {metric.formattedValue}
            {metric.formattedUnit ? ` ${metric.formattedUnit}` : ''}
          </span>
        ))}
      </div>
    </article>
  )
}

function MetricDetailsTable({ metrics }: { metrics: MetricItem[] }) {
  return (
    <div className="metrics-detail-panel">
      <div className="metrics-detail-header">
        <strong>All Metrics</strong>
        <span>{metrics.length} metric(s)</span>
      </div>
      <div className="metrics-detail-table-wrap">
        <table className="metrics-detail-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
              <th>Unit</th>
              <th>Source</th>
              <th>Labels</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr key={metric.key}>
                <td>
                  <strong>{metric.label}</strong>
                  <span>{metric.name}</span>
                </td>
                <td>{metric.formattedValue}</td>
                <td>{metric.formattedUnit || metric.unit}</td>
                <td>{metric.labels.source ?? metric.labels.section ?? metric.labels.database ?? '-'}</td>
                <td>
                  <div className="metrics-label-list">
                    {Object.entries(metric.labels).map(([key, value]) => (
                      <span key={key} className="metrics-label-chip">
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
