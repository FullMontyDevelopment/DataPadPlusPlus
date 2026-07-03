import { useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  AppHealth,
  AppLogFileContent,
  AppLogFileSummary,
  AppShortcutId,
  DatastoreApiServerSettingsRequest,
  DatastoreMcpServerSettingsRequest,
  DatastoreSecurityChecksSettingsRequest,
  DiagnosticsReport,
  WorkspaceBackupRunResponse,
  WorkspaceBackupSummary,
  WorkspaceSearchSettingsRequest,
  WorkspaceSnapshot,
  WorkspaceSwitcherSettingsRequest,
  WorkspaceSwitcherStatus,
} from '@datapadplusplus/shared-types'
import { SettingsIcon, ThemeIcon } from './icons'
import { SettingsAboutPanel } from './SettingsAboutPanel'
import { SettingsExperimentalPanel } from './SettingsExperimentalPanel'
import { SettingsLogsPanel } from './SettingsLogsPanel'
import { SettingsSecurityPanel } from './SettingsSecurityPanel'
import { SettingsShortcutsPanel } from './SettingsShortcutsPanel'
import { SETTINGS_SECTIONS, THEMES, type SettingsSection } from './SettingsWorkspace.constants'
import { SettingsPanel } from './SettingsWorkspace.parts'
import { SettingsWorkspaceBackupsPanel } from './SettingsWorkspaceBackupsPanel'
import {
  SettingsUpdatesPanel,
  type SettingsUpdatesProps,
} from './SettingsUpdatesPanel'

type LegacySettingsSection = SettingsSection | 'backups' | 'health'

export function SettingsWorkspace({
  diagnostics,
  health,
  initialSection,
  preferences,
  updateCheckResult,
  updateDownload,
  updateError,
  updateInstallStatus,
  updateSettings,
  updateStatus,
  workspaceSwitcherStatus,
  onCheckForUpdates,
  onClearLogFile,
  onCreateBackup,
  onDeleteBackup,
  onDeleteLogFile,
  onExportWorkspaceFile,
  onImportWorkspaceFile,
  onInstallUpdate,
  onListBackups,
  onListLogFiles,
  onReadLogFile,
  onRestoreBackup,
  onSetKeyboardShortcut,
  onSetSafeMode,
  onSetTheme,
  onSetUpdatePrereleases,
  onOpenApiServer,
  onOpenMcpServer,
  onOpenWorkspaceSearch,
  onOpenSecurityChecks,
  onUpdateApiServerSettings,
  onUpdateMcpServerSettings,
  onUpdateBackupSettings,
  onUpdateWorkspaceSwitcherSettings,
  onUpdateWorkspaceSearchSettings,
  onUpdateSecurityCheckSettings,
}: {
  diagnostics?: DiagnosticsReport
  health: AppHealth
  initialSection?: LegacySettingsSection
  preferences: WorkspaceSnapshot['preferences']
  workspaceSwitcherStatus?: WorkspaceSwitcherStatus
  onClearLogFile(fileName: string): Promise<AppLogFileContent | undefined>
  onCreateBackup(automatic?: boolean): Promise<WorkspaceBackupRunResponse | undefined>
  onDeleteBackup(backupId: string): Promise<WorkspaceBackupSummary[] | undefined>
  onDeleteLogFile(fileName: string): Promise<AppLogFileSummary[] | undefined>
  onExportWorkspaceFile(passphrase: string, includeSecrets: boolean): Promise<string | undefined>
  onImportWorkspaceFile(passphrase: string): Promise<void>
  onListBackups(): Promise<WorkspaceBackupSummary[] | undefined>
  onListLogFiles(): Promise<AppLogFileSummary[] | undefined>
  onReadLogFile(fileName: string): Promise<AppLogFileContent | undefined>
  onRestoreBackup(backupId: string, passphrase: string): Promise<void>
  onSetKeyboardShortcut(shortcutId: AppShortcutId, shortcut: string): Promise<void>
  onSetSafeMode(enabled: boolean): void
  onSetTheme(theme: WorkspaceSnapshot['preferences']['theme']): void
  onUpdateBackupSettings(request: {
    enabled: boolean
    passphrase?: string
    intervalMinutes?: number
    maxBackups?: number
    includeSecrets?: boolean
  }): Promise<boolean>
  onOpenApiServer(): void
  onOpenMcpServer(): void
  onOpenWorkspaceSearch(): void
  onOpenSecurityChecks(): void
  onUpdateApiServerSettings(
    request: DatastoreApiServerSettingsRequest,
  ): Promise<boolean>
  onUpdateMcpServerSettings(
    request: DatastoreMcpServerSettingsRequest,
  ): Promise<boolean>
  onUpdateWorkspaceSwitcherSettings(
    request: WorkspaceSwitcherSettingsRequest,
  ): Promise<boolean>
  onUpdateWorkspaceSearchSettings(
    request: WorkspaceSearchSettingsRequest,
  ): Promise<boolean>
  onUpdateSecurityCheckSettings(
    request: DatastoreSecurityChecksSettingsRequest,
  ): Promise<boolean>
} & SettingsUpdatesProps) {
  const [section, setSection] = useState<SettingsSection>(
    normalizeSettingsSection(initialSection),
  )

  return (
    <section className="settings-workspace" aria-label="Settings">
      <aside className="settings-nav" aria-label="Settings sections">
        <div className="settings-nav-header">
          <SettingsIcon className="panel-inline-icon" />
          <strong>Settings</strong>
        </div>
        {SETTINGS_SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-nav-item${section === item.id ? ' is-active' : ''}`}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </aside>

      <div className="settings-content">
        {section === 'appearance' ? (
          <SettingsPanel title="Appearance" icon={<ThemeIcon className="panel-inline-icon" />}>
            <div className="theme-grid" role="list">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={`theme-card theme-card--${theme.base}${preferences.theme === theme.id ? ' is-active' : ''}`}
                  style={{
                    '--theme-background': theme.colors.background,
                    '--theme-surface': theme.colors.surface,
                    '--theme-accent': theme.colors.accent,
                    '--theme-text': theme.colors.text,
                  } as CSSProperties}
                  onClick={() => onSetTheme(theme.id)}
                >
                  <span className="theme-card-preview" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <strong>{theme.label}</strong>
                </button>
              ))}
            </div>
          </SettingsPanel>
        ) : null}

        {section === 'workspace' ? (
          <SettingsWorkspaceBackupsPanel
            health={health}
            preferences={preferences}
            onCreateBackup={onCreateBackup}
            onDeleteBackup={onDeleteBackup}
            onExportWorkspaceFile={onExportWorkspaceFile}
            onImportWorkspaceFile={onImportWorkspaceFile}
            onListBackups={onListBackups}
            onRestoreBackup={onRestoreBackup}
            onUpdateBackupSettings={onUpdateBackupSettings}
          />
        ) : null}

        {section === 'updates' ? (
          <SettingsUpdatesPanel
            diagnostics={diagnostics}
            health={health}
            updateCheckResult={updateCheckResult}
            updateDownload={updateDownload}
            updateError={updateError}
            updateInstallStatus={updateInstallStatus}
            updateSettings={updateSettings}
            updateStatus={updateStatus}
            onCheckForUpdates={onCheckForUpdates}
            onInstallUpdate={onInstallUpdate}
            onSetUpdatePrereleases={onSetUpdatePrereleases}
          />
        ) : null}

        {section === 'security' ? (
          <SettingsSecurityPanel
            preferences={preferences}
            onSetSafeMode={onSetSafeMode}
          />
        ) : null}

        {section === 'experimental' ? (
          <SettingsExperimentalPanel
            preferences={preferences}
            onOpenApiServer={onOpenApiServer}
            onOpenMcpServer={onOpenMcpServer}
            onOpenWorkspaceSearch={onOpenWorkspaceSearch}
            onOpenSecurityChecks={onOpenSecurityChecks}
            workspaceSwitcherStatus={workspaceSwitcherStatus}
            onUpdateApiServerSettings={onUpdateApiServerSettings}
            onUpdateMcpServerSettings={onUpdateMcpServerSettings}
            onUpdateWorkspaceSwitcherSettings={onUpdateWorkspaceSwitcherSettings}
            onUpdateWorkspaceSearchSettings={onUpdateWorkspaceSearchSettings}
            onUpdateSecurityCheckSettings={onUpdateSecurityCheckSettings}
          />
        ) : null}

        {section === 'shortcuts' ? (
          <SettingsShortcutsPanel
            preferences={preferences}
            onSetKeyboardShortcut={onSetKeyboardShortcut}
          />
        ) : null}

        {section === 'logs' ? (
          <SettingsLogsPanel
            diagnostics={diagnostics}
            onClearLogFile={onClearLogFile}
            onDeleteLogFile={onDeleteLogFile}
            onListLogFiles={onListLogFiles}
            onReadLogFile={onReadLogFile}
          />
        ) : null}

        {section === 'about' ? (
          <SettingsAboutPanel
            diagnostics={diagnostics}
            health={health}
          />
        ) : null}
      </div>
    </section>
  )
}

function normalizeSettingsSection(section: LegacySettingsSection | undefined): SettingsSection {
  if (section === 'backups') return 'workspace'
  if (section === 'health') return 'logs'
  return section ?? 'appearance'
}
