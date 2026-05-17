import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { ClockIcon, DatabaseIcon, MetricsIcon, RefreshIcon, WarningIcon } from './icons'
import { MetricsDashboard } from './MetricsDashboard'
import { metricSummaryTiles } from './MetricsDashboard.helpers'
import { formatDurationClock } from './results/result-runtime'

interface MetricsWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
}

export function MetricsWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
}: MetricsWorkspaceProps) {
  const [refreshing, setRefreshing] = useState(false)
  const diagnostics = tab.metricsState?.diagnostics
  const summaryTiles = useMemo(() => metricSummaryTiles(diagnostics), [diagnostics])
  const hasMetrics = summaryTiles.length > 0

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])

  return (
    <section className="metrics-workspace" aria-label={`Metrics for ${connection.name}`}>
      <div className="metrics-workspace-toolbar">
        <div className="metrics-workspace-heading">
          <MetricsIcon className="metrics-heading-icon" />
          <div>
            <strong>{connection.name}</strong>
            <span>
              {connection.engine} / {environment.label}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="drawer-button"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshIcon className="panel-inline-icon" />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <div className="metrics-strip" aria-label="Connection metric summary">
        {summaryTiles.length > 0 ? (
          summaryTiles.map((tile) => (
            <div key={tile.key} className="metrics-strip-item" title={tile.label}>
              <tile.Icon className="metrics-strip-icon" />
              <strong>{tile.value}</strong>
              <span>{tile.unit}</span>
            </div>
          ))
        ) : (
          <div className="metrics-strip-empty">
            <DatabaseIcon className="metrics-strip-icon" />
            <span>
              {diagnostics
                ? 'No live metrics were returned by this adapter.'
                : 'Refresh to collect adapter metrics.'}
            </span>
          </div>
        )}
        {tab.metricsState?.lastRefreshedAt ? (
          <div className="metrics-strip-item metrics-strip-item--subtle" title="Last refresh">
            <ClockIcon className="metrics-strip-icon" />
            <strong>{formatRelativeTimestamp(tab.metricsState.lastRefreshedAt)}</strong>
          </div>
        ) : null}
      </div>

      {tab.error ? (
        <div className="metrics-warning">
          <WarningIcon className="panel-inline-icon" />
          <span>{tab.error.message}</span>
        </div>
      ) : null}

      {(tab.metricsState?.warnings ?? []).length > 0 ? (
        <div className="metrics-warning-list">
          {(tab.metricsState?.warnings ?? []).map((warning) => (
            <div key={warning} className="metrics-warning">
              <WarningIcon className="panel-inline-icon" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      <MetricsDashboard diagnostics={diagnostics} />

      {!hasMetrics ? (
        <div className="metrics-empty-state">
          <MetricsIcon className="metrics-empty-icon" />
          <strong>No live metrics yet</strong>
          <span>
            Refresh the tab. If this message stays here, the adapter could connect but the
            database did not expose metrics to the current user.
          </span>
        </div>
      ) : null}
    </section>
  )
}

function formatRelativeTimestamp(value: string) {
  const timestamp = parseTimestamp(value)

  if (!Number.isFinite(timestamp)) {
    return value
  }

  const elapsedMs = Math.max(0, Date.now() - timestamp)

  if (elapsedMs < 60_000) {
    return formatDurationClock(elapsedMs)
  }

  const minutes = Math.round(elapsedMs / 60_000)
  return `${minutes} min ago`
}

function parseTimestamp(value: string) {
  const trimmed = value.trim()
  const numeric = Number(trimmed)

  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000
  }

  return new Date(value).getTime()
}
