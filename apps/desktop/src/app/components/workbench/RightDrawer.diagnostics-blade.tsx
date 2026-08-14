import type {
  AppHealth,
  DiagnosticsReport,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import {
  RefreshIcon,
  SettingsIcon,
  ThemeIcon,
} from './icons'
import { SHORTCUTS } from './RightDrawer.helpers'
import { DrawerDetailRow, DrawerHeader } from './RightDrawer.primitives'

export function DiagnosticsBlade({
  diagnostics,
  health,
  theme,
  onClose,
  onRefreshDiagnostics,
  onToggleTheme,
}: {
  diagnostics?: DiagnosticsReport
  health: AppHealth
  theme: WorkspaceSnapshot['preferences']['theme']
  onClose(): void
  onRefreshDiagnostics(): void
  onToggleTheme(): void
}) {
  const warnings = diagnostics?.warnings ?? []

  return (
    <>
      <DrawerHeader
        title="Settings"
        subtitle="Preferences, backup, restore, and workspace health"
        icon={SettingsIcon}
        onClose={onClose}
      />

      <div className="drawer-scroll settings-drawer">
        <section className="drawer-section settings-card">
          <div className="drawer-section-header">
            <div>
              <strong>Appearance</strong>
              <p className="drawer-copy">Choose how DataPad++ looks while you work.</p>
            </div>
            <button type="button" className="drawer-link-button" onClick={onToggleTheme}>
              <ThemeIcon className="drawer-inline-icon" />
              Switch theme
            </button>
          </div>
          <div className="details-grid details-grid--drawer settings-overview-grid">
            <DrawerDetailRow label="Current theme" value={formatThemeLabel(theme)} />
            <DrawerDetailRow
              label="Credential storage"
              value={formatSecretStorageStatus(health.secretStorage)}
            />
          </div>
        </section>

        <section className="drawer-section settings-card">
          <div className="drawer-section-header">
            <div>
              <strong>Workspace Health</strong>
              <p className="drawer-copy">A quick read on the workspace DataPad++ is using.</p>
            </div>
            <button type="button" className="drawer-link-button" onClick={onRefreshDiagnostics}>
              <RefreshIcon className="drawer-inline-icon" />
              Refresh
            </button>
          </div>
          <div className="details-grid details-grid--drawer settings-overview-grid">
            <DrawerDetailRow label="App version" value={diagnostics?.appVersion ?? 'Unknown'} />
            <DrawerDetailRow label="Platform" value={diagnostics?.platform ?? health.platform} />
            <DrawerDetailRow label="Log file" value={diagnostics?.logPath ?? 'Not available'} />
            <DrawerDetailRow
              label="Breadcrumbs"
              value={diagnostics?.breadcrumbPath ?? 'Not available'}
            />
            <DrawerDetailRow
              label="Window lifecycle"
              value={diagnostics?.windowLifecyclePath ?? 'Not available'}
            />
            <DrawerDetailRow label="Connections" value={String(diagnostics?.counts.connections ?? 0)} />
            <DrawerDetailRow label="Library items" value={String(diagnostics?.counts.library ?? 0)} />
            <DrawerDetailRow label="Environments" value={String(diagnostics?.counts.environments ?? 0)} />
            <DrawerDetailRow label="Open tabs" value={String(diagnostics?.counts.tabs ?? 0)} />
          </div>
          <ul className="messages-list settings-warning-list">
            {(warnings.length ? warnings : ['No workspace warnings.']).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>

        <section className="drawer-section settings-card">
          <div className="drawer-section-header">
            <div>
              <strong>Keyboard Shortcuts</strong>
              <p className="drawer-copy">Common shortcuts for query and workspace navigation.</p>
            </div>
          </div>
          <div className="drawer-shortcut-list">
            {SHORTCUTS.map(([label, shortcut]) => (
              <div key={label} className="drawer-shortcut-row">
                <span>{label}</span>
                <kbd>{shortcut}</kbd>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}

function formatThemeLabel(theme: WorkspaceSnapshot['preferences']['theme']) {
  return theme === 'system' ? 'Use system setting' : theme === 'light' ? 'Light' : 'Dark'
}

function formatSecretStorageStatus(status: AppHealth['secretStorage']) {
  if (status === 'keyring' || status === 'ready') {
    return 'Secure store ready'
  }

  if (status === 'file') {
    return 'Encrypted local store'
  }

  return 'Preview mode'
}
