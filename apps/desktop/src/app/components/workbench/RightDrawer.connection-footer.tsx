import type { CSSProperties } from 'react'
import type {
  ConnectionProfile,
  ConnectionTestResult,
} from '@datapadplusplus/shared-types'

interface ConnectionFooterProps {
  connectionTest?: ConnectionTestResult
  environmentAccentStyle?: CSSProperties
  hasEnvironment: boolean
  loadingTest?: { engine: string; environmentLabel: string }
  resolvedDatabase?: string
  resolvedHost: string
  secretDraft: string
  selectedEnvironmentId: string
  getConnectionForAction(): ConnectionProfile
  onSaveConnection(profile: ConnectionProfile, secret?: string): Promise<boolean>
  onTestConnection(
    profile: ConnectionProfile,
    environmentId: string,
    secret?: string,
  ): Promise<ConnectionTestResult | undefined>
}

export function ConnectionFooter({
  connectionTest,
  environmentAccentStyle,
  hasEnvironment,
  loadingTest,
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
      {loadingTest ? (
        <div className="drawer-callout is-loading" role="status">
          <strong>Testing connection</strong>
          <span>
            Checking {loadingTest.engine}
            {loadingTest.environmentLabel ? ` with ${loadingTest.environmentLabel}` : ''}...
          </span>
        </div>
      ) : connectionTest ? (
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
          disabled={Boolean(loadingTest)}
          title="Test this connection using the selected environment, or no environment if none is selected."
          onClick={() =>
            void onTestConnection(getConnectionForAction(), selectedEnvironmentId, secretDraft)
          }
        >
          {loadingTest ? 'Testing...' : 'Test Connection'}
        </button>
        <button
          type="button"
          className="drawer-button drawer-button--primary"
          title="Save this connection profile locally and close the drawer."
          onClick={() => void onSaveConnection(getConnectionForAction(), secretDraft)}
        >
          Save Connection
        </button>
      </div>
    </div>
  )
}
