import type {
  BootstrapPayload,
  DiagnosticsReport,
  ExportBundle,
  WorkspaceBackupDeleteRequest,
  WorkspaceBackupRestoreRequest,
  WorkspaceBackupRunRequest,
  WorkspaceBackupRunResponse,
  WorkspaceBackupSettingsRequest,
  WorkspaceBackupSummary,
  WorkspaceBundleFileExportRequest,
  WorkspaceBundleFileExportResponse,
  WorkspaceBundleFileImportRequest,
  WorkspaceCreateRequest,
  WorkspaceRenameRequest,
  DatastoreSecurityCheckSnapshot,
  DatastoreSecurityChecksRefreshRequest,
  DatastoreSecurityChecksSettingsRequest,
  DatastoreSecurityChecksStatus,
  UpdateUiStateRequest,
  WorkspaceSearchSettingsRequest,
  WorkspaceSnapshot,
  WorkspaceSwitcherSettingsRequest,
  WorkspaceSwitcherStatus,
  WorkspaceSwitchRequest,
  AppLogFileContent,
  AppLogFileSummary,
  AppShortcutId,
  ExplorerFolderOrderRequest,
  FirstInstallGuidePersistedStatus,
  FirstInstallGuideStepId,
} from '@datapadplusplus/shared-types'
import { createBrowserPreviewHealth } from '../../app/data/workspace-factory'
import { buildDiagnosticsReport, migrateWorkspaceSnapshot } from '../../app/state/helpers'
import { redactErrorMessage } from '../../app/state/security-redaction'
import {
  buildBrowserPayload,
  cloneSnapshot,
  createBrowserWorkspace,
  getBrowserWorkspaceSwitcherStatus,
  loadBrowserSnapshot,
  normalizeUiStatePatch,
  renameBrowserWorkspace,
  saveBrowserSnapshot,
  setBrowserWorkspaceSwitcherEnabled,
  switchBrowserWorkspace,
  updateUiStateLocally,
} from './browser-store'
import {
  browserBackupSummaries,
  decryptBrowserWorkspacePayload,
  downloadBrowserWorkspaceBundle,
  encryptBrowserWorkspacePayload,
  extractBrowserWorkspaceSnapshot,
  pickBrowserWorkspaceBundleFile,
  toDesktopWorkspaceBundlePassphrase,
  validateWorkspaceBundlePassphrase,
  validateWorkspaceBundlePayload,
} from './client-workspace-bundles'
import { createBrowserWorkspaceBundlePayloadText } from './client-workspace-integrity'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'

const FIRST_INSTALL_GUIDE_STEP_IDS: FirstInstallGuideStepId[] = [
  'welcome',
  'folder',
  'connection',
  'save',
  'explorer',
  'query',
  'settings',
]

function isFirstInstallGuideStepId(
  value: FirstInstallGuideStepId | undefined,
): value is FirstInstallGuideStepId {
  return typeof value === 'string' && FIRST_INSTALL_GUIDE_STEP_IDS.includes(value)
}

function browserSecurityCheckStatus(
  snapshot: WorkspaceSnapshot,
): DatastoreSecurityChecksStatus {
  const preferences = snapshot.preferences.datastoreSecurityChecks ?? {
    enabled: false,
    refreshIntervalDays: 7,
  }
  return {
    supported: false,
    enabled: Boolean(preferences.enabled),
    message: 'Datastore Security Checks require the desktop app.',
    canRefresh: false,
    refreshBlockedReason: 'Network-backed security checks are disabled in browser preview.',
    preferences,
    snapshot: snapshot.datastoreSecurityChecks,
  }
}

export const clientWorkspace = {
  async bootstrapApp(): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      const payload = await invokeDesktop<BootstrapPayload>('bootstrap_app')

      return payload.snapshot.lockState.isLocked
        ? invokeDesktop<BootstrapPayload>('unlock_app')
        : payload
    }

    return buildBrowserPayload(loadBrowserSnapshot())
  },

  async getWorkspaceSwitcherStatus(): Promise<WorkspaceSwitcherStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceSwitcherStatus>('get_workspace_switcher_status')
    }

    return getBrowserWorkspaceSwitcherStatus()
  },

  async setWorkspaceSwitcherEnabled(
    request: WorkspaceSwitcherSettingsRequest,
  ): Promise<WorkspaceSwitcherStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceSwitcherStatus>('set_workspace_switcher_enabled', { request })
    }

    return setBrowserWorkspaceSwitcherEnabled(request)
  },

  async createWorkspace(request: WorkspaceCreateRequest): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_workspace', { request })
    }

    return buildBrowserPayload(createBrowserWorkspace(request))
  },

  async renameWorkspace(request: WorkspaceRenameRequest): Promise<WorkspaceSwitcherStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceSwitcherStatus>('rename_workspace', { request })
    }

    return renameBrowserWorkspace(request)
  },

  async switchWorkspace(request: WorkspaceSwitchRequest): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('switch_workspace', { request })
    }

    return buildBrowserPayload(switchBrowserWorkspace(request))
  },

  async setTheme(theme: WorkspaceSnapshot['preferences']['theme']): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_theme', { theme })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    next.preferences.theme = theme
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async setSafeModeEnabled(enabled: boolean): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_safe_mode_enabled', { enabled })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    next.preferences.safeModeEnabled = enabled
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async setKeyboardShortcut(
    shortcutId: AppShortcutId,
    shortcut: string,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_keyboard_shortcut', {
        shortcutId,
        shortcut,
      })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    next.preferences.keyboardShortcuts = {
      ...(next.preferences.keyboardShortcuts ?? {}),
      [shortcutId]: shortcut,
    }
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async setFirstInstallGuideStatus(
    status: FirstInstallGuidePersistedStatus,
    currentStepId?: FirstInstallGuideStepId,
  ): Promise<BootstrapPayload> {
    const normalizedCurrentStepId =
      status === 'started' && isFirstInstallGuideStepId(currentStepId)
        ? currentStepId
        : undefined

    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_first_install_guide_status', {
        status,
        currentStepId: normalizedCurrentStepId,
      })
    }

    const now = new Date().toISOString()
    const next = cloneSnapshot(loadBrowserSnapshot())
    next.preferences.firstInstallGuide = {
      status,
      ...(normalizedCurrentStepId ? { currentStepId: normalizedCurrentStepId } : {}),
      updatedAt: now,
      completedAt: status === 'completed' ? now : undefined,
    }
    next.updatedAt = now
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async setExplorerFolderOrder(
    request: ExplorerFolderOrderRequest,
  ): Promise<BootstrapPayload> {
    const orderKey = request.orderKey.trim()
    const orderedNodeKeys = [...new Set(
      request.orderedNodeKeys.map((nodeKey) => nodeKey.trim()).filter(Boolean),
    )]

    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_explorer_folder_order', {
        request: { orderKey, orderedNodeKeys },
      })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    next.preferences.explorerFolderOrders = {
      ...(next.preferences.explorerFolderOrders ?? {}),
    }
    if (orderedNodeKeys.length) {
      next.preferences.explorerFolderOrders[orderKey] = orderedNodeKeys
    } else {
      delete next.preferences.explorerFolderOrders[orderKey]
    }
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async createDiagnosticsReport(): Promise<DiagnosticsReport> {
    if (isTauriRuntime()) {
      return invokeDesktop<DiagnosticsReport>('create_diagnostics_report')
    }

    const snapshot = loadBrowserSnapshot()
    return buildDiagnosticsReport(snapshot, createBrowserPreviewHealth())
  },

  async listAppLogFiles(): Promise<AppLogFileSummary[]> {
    if (isTauriRuntime()) {
      return invokeDesktop<AppLogFileSummary[]>('list_app_log_files')
    }

    return []
  },

  async readAppLogFile(fileName: string): Promise<AppLogFileContent> {
    if (isTauriRuntime()) {
      return invokeDesktop<AppLogFileContent>('read_app_log_file', { fileName })
    }

    throw new Error('Log files are available in the desktop app.')
  },

  async clearAppLogFile(fileName: string): Promise<AppLogFileContent> {
    if (isTauriRuntime()) {
      return invokeDesktop<AppLogFileContent>('clear_app_log_file', { fileName })
    }

    throw new Error('Log files are available in the desktop app.')
  },

  async deleteAppLogFile(fileName: string): Promise<AppLogFileSummary[]> {
    if (isTauriRuntime()) {
      return invokeDesktop<AppLogFileSummary[]>('delete_app_log_file', { fileName })
    }

    return []
  },

  async exportWorkspaceBundle(
    passphrase: string,
    includeSecrets = false,
  ): Promise<ExportBundle> {
    validateWorkspaceBundlePassphrase(passphrase)

    if (isTauriRuntime()) {
      return invokeDesktop<ExportBundle>('export_workspace_bundle', {
        passphrase: toDesktopWorkspaceBundlePassphrase(passphrase),
        includeSecrets,
      })
    }

    return {
      format: 'datapadplusplus-bundle',
      version: 3,
      includesSecrets: false,
      secretCount: 0,
      encryptedPayload: await encryptBrowserWorkspacePayload(
        passphrase,
        await createBrowserWorkspaceBundlePayloadText(
          migrateWorkspaceSnapshot(loadBrowserSnapshot()),
        ),
      ),
    }
  },

  async exportWorkspaceBundleFile(
    request: WorkspaceBundleFileExportRequest,
  ): Promise<WorkspaceBundleFileExportResponse> {
    validateWorkspaceBundlePassphrase(request.passphrase)

    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceBundleFileExportResponse>('export_workspace_bundle_file', {
        request: {
          ...request,
          passphrase: toDesktopWorkspaceBundlePassphrase(request.passphrase),
        },
      })
    }

    const bundle = await clientWorkspace.exportWorkspaceBundle(request.passphrase, false)
    downloadBrowserWorkspaceBundle(bundle)
    return {
      saved: true,
      includesSecrets: false,
      secretCount: 0,
    }
  },

  async importWorkspaceBundle(
    passphrase: string,
    encryptedPayload: string,
  ): Promise<BootstrapPayload> {
    validateWorkspaceBundlePassphrase(passphrase)
    validateWorkspaceBundlePayload(encryptedPayload)

    if (isTauriRuntime()) {
      const desktopPassphrase = toDesktopWorkspaceBundlePassphrase(passphrase)

      try {
        return await invokeDesktop<BootstrapPayload>('import_workspace_bundle', {
          passphrase: desktopPassphrase,
          encryptedPayload,
        })
      } catch (error) {
        if (desktopPassphrase === passphrase) {
          throw error
        }

        try {
          return await invokeDesktop<BootstrapPayload>('import_workspace_bundle', {
            passphrase,
            encryptedPayload,
          })
        } catch (fallbackError) {
          const fallbackMessage = redactErrorMessage(
            fallbackError,
            'Unable to import the encrypted bundle.',
          )

          if (fallbackMessage.includes('at least 8 characters')) {
            const message = redactErrorMessage(
              error,
              'Unable to import the encrypted bundle.',
            )
            throw new Error(message, { cause: fallbackError })
          }

          throw new Error(fallbackMessage, { cause: fallbackError })
        }
      }
    }

    try {
      const snapshot = migrateWorkspaceSnapshot(
        extractBrowserWorkspaceSnapshot(
          await decryptBrowserWorkspacePayload(passphrase, encryptedPayload),
        ),
      )
      saveBrowserSnapshot(snapshot)
      return buildBrowserPayload(snapshot)
    } catch (error) {
      const message = redactErrorMessage(
        error,
        'Unable to import the encrypted bundle.',
      )

      // eslint-disable-next-line preserve-caught-error -- The original bundle import error can contain user-provided plaintext; only rethrow the redacted message.
      throw new Error(message)
    }
  },

  async importWorkspaceBundleFile(
    request: WorkspaceBundleFileImportRequest,
  ): Promise<BootstrapPayload> {
    validateWorkspaceBundlePassphrase(request.passphrase)

    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('import_workspace_bundle_file', {
        request: {
          ...request,
          passphrase: toDesktopWorkspaceBundlePassphrase(request.passphrase),
        },
      })
    }

    const fileText = await pickBrowserWorkspaceBundleFile()
    const parsed = JSON.parse(fileText) as ExportBundle
    return clientWorkspace.importWorkspaceBundle(request.passphrase, parsed.encryptedPayload)
  },

  async updateWorkspaceBackupSettings(
    request: WorkspaceBackupSettingsRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_workspace_backup_settings', { request })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    next.preferences.workspaceBackups = {
      enabled: request.enabled,
      intervalMinutes: request.intervalMinutes ?? next.preferences.workspaceBackups?.intervalMinutes ?? 30,
      maxBackups: request.maxBackups ?? next.preferences.workspaceBackups?.maxBackups ?? 20,
      includeSecrets: Boolean(request.includeSecrets),
      passphraseSecretRef: request.enabled
        ? next.preferences.workspaceBackups?.passphraseSecretRef ?? {
            id: 'browser-preview-workspace-backup-passphrase',
            provider: 'session',
            service: 'datapadplusplus.workspace-backup',
            account: 'workspace:auto-backup',
            label: 'Workspace auto-backup passphrase',
          }
        : undefined,
      lastBackupAt: next.preferences.workspaceBackups?.lastBackupAt,
      lastWorkspaceUpdatedAt: next.preferences.workspaceBackups?.lastWorkspaceUpdatedAt,
    }
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async updateWorkspaceSearchSettings(
    request: WorkspaceSearchSettingsRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_workspace_search_settings', { request })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    next.preferences.workspaceSearch = {
      enabled: Boolean(request.enabled),
    }
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async getDatastoreSecurityCheckStatus(): Promise<DatastoreSecurityChecksStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreSecurityChecksStatus>(
        'get_datastore_security_check_status',
      )
    }

    const snapshot = loadBrowserSnapshot()
    return browserSecurityCheckStatus(snapshot)
  },

  async updateDatastoreSecurityCheckSettings(
    request: DatastoreSecurityChecksSettingsRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_datastore_security_check_settings', {
        request,
      })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    next.preferences.datastoreSecurityChecks = {
      enabled: Boolean(request.enabled),
      refreshIntervalDays: Math.min(
        30,
        Math.max(1, Math.round(request.refreshIntervalDays ?? 7)),
      ),
      mutedFindingIds: Array.isArray(request.mutedFindingIds)
        ? Array.from(
            new Set(
              request.mutedFindingIds
                .filter((id) => typeof id === 'string' && id.trim())
                .map((id) => id.trim()),
            ),
          ).sort()
        : (next.preferences.datastoreSecurityChecks?.mutedFindingIds ?? []),
      lastRefreshAttemptAt:
        next.preferences.datastoreSecurityChecks?.lastRefreshAttemptAt,
      lastSuccessfulRefreshAt:
        next.preferences.datastoreSecurityChecks?.lastSuccessfulRefreshAt,
      nextManualRefreshAllowedAt:
        next.preferences.datastoreSecurityChecks?.nextManualRefreshAllowedAt,
    }
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async refreshDatastoreSecurityChecks(
    request: DatastoreSecurityChecksRefreshRequest = { manual: true },
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('refresh_datastore_security_checks', { request })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    const now = new Date()
    const snapshot: DatastoreSecurityCheckSnapshot = {
      status: 'unsupported',
      checkedAt: now.toISOString(),
      sourceMetadata: [],
      targets: [],
      findings: [],
      postureChecks: [],
      warnings: [],
      errors: ['Datastore Security Checks require the desktop app.'],
    }
    next.preferences.datastoreSecurityChecks = {
      enabled: Boolean(next.preferences.datastoreSecurityChecks?.enabled),
      refreshIntervalDays:
        next.preferences.datastoreSecurityChecks?.refreshIntervalDays ?? 7,
      mutedFindingIds:
        next.preferences.datastoreSecurityChecks?.mutedFindingIds ?? [],
      lastRefreshAttemptAt: now.toISOString(),
      lastSuccessfulRefreshAt:
        next.preferences.datastoreSecurityChecks?.lastSuccessfulRefreshAt,
      nextManualRefreshAllowedAt: request.manual
        ? new Date(now.getTime() + 60_000).toISOString()
        : next.preferences.datastoreSecurityChecks?.nextManualRefreshAllowedAt,
    }
    next.datastoreSecurityChecks = snapshot
    next.updatedAt = now.toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async listWorkspaceBackups(): Promise<WorkspaceBackupSummary[]> {
    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceBackupSummary[]>('list_workspace_backups')
    }

    return browserBackupSummaries()
  },

  async createWorkspaceBackupNow(
    request: WorkspaceBackupRunRequest,
  ): Promise<WorkspaceBackupRunResponse> {
    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceBackupRunResponse>('create_workspace_backup_now', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const preferences = snapshot.preferences.workspaceBackups
    if (!preferences?.enabled) {
      return {
        created: false,
        backups: browserBackupSummaries(),
        message: 'Auto-backups are off.',
      }
    }

    if (request.automatic && preferences.lastWorkspaceUpdatedAt === snapshot.updatedAt) {
      return {
        created: false,
        backups: browserBackupSummaries(),
        message: 'Workspace is already backed up.',
      }
    }

    const bundle = await clientWorkspace.exportWorkspaceBundle('browser-preview-backup', false)
    const id = `backup-${Date.now()}`
    const summary: WorkspaceBackupSummary = {
      id,
      fileName: `${id}.datapadpp-workspace`,
      createdAt: new Date().toISOString(),
      sizeBytes: JSON.stringify(bundle).length,
      includesSecrets: false,
      secretCount: 0,
      version: bundle.version,
    }
    const backups = [summary, ...browserBackupSummaries()].slice(0, preferences.maxBackups ?? 20)
    globalThis.localStorage?.setItem('datapadplusplus-browser-backups', JSON.stringify(backups))
    snapshot.preferences.workspaceBackups = {
      ...preferences,
      lastBackupAt: summary.createdAt,
      lastWorkspaceUpdatedAt: snapshot.updatedAt,
    }
    saveBrowserSnapshot(snapshot)
    return {
      created: true,
      backup: summary,
      backups,
      message: 'Workspace backup created.',
    }
  },

  async restoreWorkspaceBackup(
    request: WorkspaceBackupRestoreRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('restore_workspace_backup', { request })
    }

    throw new Error('Browser preview backups cannot be restored automatically.')
  },

  async deleteWorkspaceBackup(
    request: WorkspaceBackupDeleteRequest,
  ): Promise<WorkspaceBackupSummary[]> {
    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceBackupSummary[]>('delete_workspace_backup', { request })
    }

    const backups = browserBackupSummaries().filter((backup) => backup.id !== request.backupId)
    globalThis.localStorage?.setItem('datapadplusplus-browser-backups', JSON.stringify(backups))
    return backups
  },

  async updateUiState(patch: UpdateUiStateRequest): Promise<BootstrapPayload> {
    const normalizedPatch = normalizeUiStatePatch(patch)

    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_ui_state', { patch: normalizedPatch })
    }

    const snapshot = updateUiStateLocally(loadBrowserSnapshot(), normalizedPatch)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

}
