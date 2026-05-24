import type { CSSProperties } from 'react'
import type {
  ConnectionProfile,
  ConnectionTestResult,
} from '@datapadplusplus/shared-types'

interface ConnectionFooterProps {
  connectionTest?: ConnectionTestResult
  environmentAccentStyle?: CSSProperties
  hasEnvironment: boolean
  resolvedDatabase?: string
  resolvedHost: string
  secretDraft: string
  selectedEnvironmentId: string
  getConnectionForAction(): ConnectionProfile
  onSaveConnection(profile: ConnectionProfile, secret?: string): void
  onTestConnection(profile: ConnectionProfile, environmentId: string, secret?: string): void
}

export function ConnectionFooter({
  connectionTest,
  environmentAccentStyle,
  hasEnvironment,
  resolvedDatabase,
  resolvedHost,
  secretDraft,
  selectedEnvironmentId,
  getConnectionForAction,
  onSaveConnection,
  onTestConnection,
}: ConnectionFooterProps) {
  return (
    <div
      className={`drawer-footer drawer-footer--stacked${hasEnvironment ? ' has-environment-accent' : ''}`}
      style={environmentAccentStyle}
    >
      {connectionTest ? (
        <div className={`drawer-callout${connectionTest.ok ? ' is-success' : ' is-error'}`}>
          <strong>{connectionTest.ok ? 'Connection ready' : 'Connection issue'}</strong>
          <span>{connectionTest.message}</span>
          <span>
            {resolvedHost}
            {resolvedDatabase ? ` / ${resolvedDatabase}` : ''}
          </span>
          {connectionTest.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}

      <div className="drawer-footer-actions">
        <button
          type="button"
          className="drawer-button"
          title="Test this connection using the selected environment and stored credentials."
          onClick={() =>
            onTestConnection(getConnectionForAction(), selectedEnvironmentId, secretDraft)
          }
        >
          Test Connection
        </button>
        <button
          type="button"
          className="drawer-button drawer-button--primary"
          title="Save this connection profile locally and close the drawer."
          onClick={() => onSaveConnection(getConnectionForAction(), secretDraft)}
        >
          Save Connection
        </button>
      </div>
    </div>
  )
}
