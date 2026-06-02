import type { ConnectionHealth } from '../../state/connection-health'
import {
  healthLabel,
  shouldShowEnvironmentHealthAction,
} from '../../state/connection-health'
import {
  ConnectionConnectedIcon,
  ConnectionUnknownIcon,
  EnvironmentsIcon,
  RefreshIcon,
  RenameIcon,
  WarningIcon,
} from './icons'

interface ConnectionHealthBadgeProps {
  health?: ConnectionHealth
  environmentLabel?: string
  compact?: boolean
}

export function ConnectionHealthBadge({
  health,
  environmentLabel,
  compact = false,
}: ConnectionHealthBadgeProps) {
  const status = health?.status ?? 'unknown'
  const label = health ? healthLabel(health) : 'Not checked this session'
  const title = connectionHealthTitle(health, environmentLabel)

  return (
    <span
      className={`connection-health-badge is-${status}${compact ? ' is-compact' : ''}`}
      role="status"
      aria-label={label}
      title={title}
    >
      {status === 'checking' ? (
        <span className="connection-metadata-spinner" aria-hidden="true" />
      ) : status === 'connected' ? (
        <ConnectionConnectedIcon className="connection-health-icon" />
      ) : status === 'degraded' || status === 'issue' ? (
        <WarningIcon className="connection-health-icon" />
      ) : (
        <ConnectionUnknownIcon className="connection-health-icon" />
      )}
    </span>
  )
}

export function ConnectionHealthChip({
  health,
  environmentLabel,
}: ConnectionHealthBadgeProps) {
  if (!health || (health.status !== 'issue' && health.status !== 'degraded')) {
    return null
  }

  return (
    <span
      className={`connection-health-chip is-${health.status}`}
      title={connectionHealthTitle(health, environmentLabel)}
    >
      <ConnectionHealthBadge health={health} environmentLabel={environmentLabel} compact />
      <span>{health.message ?? healthLabel(health)}</span>
    </span>
  )
}

export function ConnectionHealthIssueStrip({
  health,
  environmentLabel,
  onEditConnection,
  onOpenEnvironment,
  onTestAgain,
}: ConnectionHealthBadgeProps & {
  onEditConnection(): void
  onOpenEnvironment?(): void
  onTestAgain(): void
}) {
  if (!health || health.status !== 'issue') {
    return null
  }

  const showEnvironmentAction = shouldShowEnvironmentHealthAction(health)

  return (
    <div
      className="connection-health-strip"
      role="status"
      title={connectionHealthTitle(health, environmentLabel)}
    >
      <div className="connection-health-strip-main">
        <WarningIcon className="connection-health-action-icon" />
        <span>{health.message ?? 'Connection issue'}</span>
      </div>
      <div className="connection-health-strip-actions">
        <button
          type="button"
          onClick={onTestAgain}
          aria-label="Test connection again"
          title="Test again"
        >
          <RefreshIcon className="connection-health-action-icon" />
        </button>
        <button
          type="button"
          onClick={onEditConnection}
          aria-label="Edit connection"
          title="Edit connection"
        >
          <RenameIcon className="connection-health-action-icon" />
        </button>
        {showEnvironmentAction && onOpenEnvironment ? (
          <button
            type="button"
            onClick={onOpenEnvironment}
            aria-label="Open environment"
            title="Open environment"
          >
            <EnvironmentsIcon className="connection-health-action-icon" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function connectionHealthTitle(
  health: ConnectionHealth | undefined,
  environmentLabel: string | undefined,
) {
  if (!health) {
    return environmentLabel
      ? `Not checked this session for ${environmentLabel}.`
      : 'Not checked this session.'
  }

  const lines = [healthLabel(health)]
  if (environmentLabel) {
    lines.push(`Environment: ${environmentLabel}`)
  }
  if (health.lastCheckedAt) {
    lines.push(`Checked: ${new Date(health.lastCheckedAt).toLocaleString()}`)
  }
  if (typeof health.durationMs === 'number') {
    lines.push(`Duration: ${health.durationMs} ms`)
  }
  if (health.message) {
    lines.push(health.message)
  }
  if (health.warnings?.length) {
    lines.push(...health.warnings)
  }
  return lines.join('\n')
}
