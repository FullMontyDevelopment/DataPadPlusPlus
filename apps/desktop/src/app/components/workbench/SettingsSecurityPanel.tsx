import type { WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { LockIcon } from './icons'
import { SettingsPanel } from './SettingsWorkspace.parts'

export function SettingsSecurityPanel({
  preferences,
  onSetSafeMode,
}: {
  preferences: WorkspaceSnapshot['preferences']
  onSetSafeMode(enabled: boolean): void
}) {
  return (
    <SettingsPanel
      title="Security"
      icon={<LockIcon className="panel-inline-icon" />}
      tourId="settings-safety"
    >
      <div className="settings-form-grid settings-form-grid--compact">
        <label className="settings-check-row settings-check-row--card">
          <input
            type="checkbox"
            checked={preferences.safeModeEnabled}
            onChange={(event) => onSetSafeMode(event.target.checked)}
          />
          <span>Global safe mode</span>
        </label>
        <div className="settings-inline-note">
          Adds workspace-wide confirmation and edit protection for risky datastore work.
        </div>
      </div>
      <section className="settings-safety-impact" aria-labelledby="safe-mode-process-impact">
        <div className="settings-safety-impact__heading">
          <strong id="safe-mode-process-impact">How safe mode affects processes</strong>
          <span>
            Environment safe mode is independent and can still enforce protection when this
            setting is off.
          </span>
        </div>
        <dl className="settings-safety-impact__list">
          <div>
            <dt>Queries, operations, and datastore tests</dt>
            <dd>Risky writes require confirmation before execution.</dd>
          </div>
          <div>
            <dt>Inline result editing</dt>
            <dd>Blocked while global or environment safe mode is active.</dd>
          </div>
          <div>
            <dt>API and MCP requests</dt>
            <dd>
              Non-interactive requests proceed only when guardrails return allow;
              confirmation-required requests are rejected.
            </dd>
          </div>
          <div>
            <dt>Read-only work</dt>
            <dd>Queries and navigation are unaffected.</dd>
          </div>
        </dl>
        <p className="settings-safety-impact__footnote">
          Turning Global safe mode off does not disable read-only connections,
          unresolved-variable blocking, environment safe mode, environment confirmation and
          risk policies, or datastore-specific destructive-operation safeguards.
        </p>
      </section>
    </SettingsPanel>
  )
}
