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
  UpdateUiStateRequest,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { createBrowserPreviewHealth } from '../../app/data/workspace-factory'
import { buildDiagnosticsReport, migrateWorkspaceSnapshot } from '../../app/state/helpers'
import { redactErrorMessage } from '../../app/state/security-redaction'
import {
  buildBrowserPayload,
  cloneSnapshot,
  loadBrowserSnapshot,
  normalizeUiStatePatch,
  saveBrowserSnapshot,
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

  async createDiagnosticsReport(): Promise<DiagnosticsReport> {
    if (isTauriRuntime()) {
      return invokeDesktop<DiagnosticsReport>('create_diagnostics_report')
    }

    const snapshot = loadBrowserSnapshot()
    return buildDiagnosticsReport(snapshot, createBrowserPreviewHealth())
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
