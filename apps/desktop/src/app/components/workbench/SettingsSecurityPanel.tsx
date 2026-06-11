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
    <SettingsPanel title="Security" icon={<LockIcon className="panel-inline-icon" />}>
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
          Safe mode is applied globally here and can also be enforced by an environment.
        </div>
      </div>
    </SettingsPanel>
  )
}
