import type {
  BootstrapPayload,
  DiagnosticsReport,
  ExportBundle,
  WorkspaceBackupDeleteRequest,
  WorkspaceBackupFileAnalysisRequest,
  WorkspaceBackupRestoreRequest,
  WorkspaceBackupRunRequest,
  WorkspaceBackupRunResponse,
  WorkspaceBackupSettingsRequest,
  WorkspaceBackupSummary,
  WorkspaceActivationResponse,
  WorkspaceStorageAnalysisRequest,
  WorkspaceStorageReport,
  WorkspaceBundleFileExportRequest,
  WorkspaceBundleFileExportResponse,
  WorkspaceBundleFileImportRequest,
  WorkspaceCreateRequest,
  WorkspaceImportCancelRequest,
  WorkspaceImportCommitRequest,
  WorkspaceImportCommitResponse,
  WorkspaceImportPreview,
  WorkspaceImportPreviewRequest,
  WorkspaceImportSelection,
  WorkspaceRenameRequest,
  DatastoreSecurityCheckSnapshot,
  DatastoreSecurityChecksRefreshRequest,
  DatastoreSecurityChecksSettingsRequest,
  DatastoreSecurityChecksStatus,
  DatastoreTestsSettingsRequest,
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
  importBrowserWorkspace,
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
  createBrowserWorkspaceBundleV2,
  decryptBrowserWorkspaceBundleV2,
  decryptBrowserWorkspaceBundleV2WithMetadata,
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

interface BrowserPendingWorkspaceImport {
  bundle: ExportBundle
  fileName: string
  encryptedSizeBytes: number
  workspaceRevision: number
  createdAt: number
  snapshot?: WorkspaceSnapshot
  sourceWorkspaceName?: string
}

const browserPendingWorkspaceImports = new Map<string, BrowserPendingWorkspaceImport>()
const BROWSER_PENDING_IMPORT_TTL_MS = 10 * 60 * 1000

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

  async createWorkspace(request: WorkspaceCreateRequest): Promise<WorkspaceActivationResponse> {
    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceActivationResponse>('create_workspace', { request })
    }

    return {
      payload: buildBrowserPayload(createBrowserWorkspace(request)),
      workspaceSwitcherStatus: getBrowserWorkspaceSwitcherStatus(),
    }
  },

  async renameWorkspace(request: WorkspaceRenameRequest): Promise<WorkspaceSwitcherStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceSwitcherStatus>('rename_workspace', { request })
    }

    return renameBrowserWorkspace(request)
  },

  async switchWorkspace(request: WorkspaceSwitchRequest): Promise<WorkspaceActivationResponse> {
    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceActivationResponse>('switch_workspace', { request })
    }

    return {
      payload: buildBrowserPayload(switchBrowserWorkspace(request)),
      workspaceSwitcherStatus: getBrowserWorkspaceSwitcherStatus(),
    }
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
          activeBrowserWorkspaceName(),
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

    const snapshot = migrateWorkspaceSnapshot(loadBrowserSnapshot())
    const fileBundle = await createBrowserWorkspaceBundleV2(
      request.passphrase,
      await createBrowserWorkspaceBundlePayloadText(snapshot, activeBrowserWorkspaceName()),
      snapshot.schemaVersion,
    )
    downloadBrowserWorkspaceBundle(fileBundle, activeBrowserWorkspaceName())
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

    const selection = await pickBrowserWorkspaceBundleFile()
    if (!selection) {
      return buildBrowserPayload(loadBrowserSnapshot())
    }
    const parsed = JSON.parse(selection.text) as ExportBundle
    if (parsed.formatVersion === 2) {
      const snapshot = migrateWorkspaceSnapshot(
        await decryptBrowserWorkspaceBundleV2(request.passphrase, parsed),
      )
      saveBrowserSnapshot(snapshot)
      return buildBrowserPayload(snapshot)
    }
    return clientWorkspace.importWorkspaceBundle(request.passphrase, parsed.encryptedPayload)
  },

  async previewWorkspaceImportFile(
    request: WorkspaceImportPreviewRequest,
  ): Promise<WorkspaceImportPreview | undefined> {
    validateWorkspaceBundlePassphrase(request.passphrase)
    if (isTauriRuntime()) {
      return (await invokeDesktop<WorkspaceImportPreview | null>('preview_workspace_import_file', {
        request: {
          ...request,
          passphrase: toDesktopWorkspaceBundlePassphrase(request.passphrase),
        },
      })) ?? undefined
    }

    const pending = browserPendingWorkspaceImports.get(request.selectionId)
    if (!pending || Date.now() - pending.createdAt > BROWSER_PENDING_IMPORT_TTL_MS) {
      browserPendingWorkspaceImports.delete(request.selectionId)
      throw new Error('The workspace import selection expired. Choose the file again.')
    }
    const parsed = await decryptBrowserWorkspaceBundleV2WithMetadata(
      request.passphrase,
      pending.bundle,
    )
    const snapshot = migrateWorkspaceSnapshot(parsed.snapshot)
    const workspaceRevision = loadBrowserSnapshot().workspaceRevision ?? 0
    pending.snapshot = snapshot
    pending.sourceWorkspaceName = parsed.sourceWorkspaceName
    pending.workspaceRevision = workspaceRevision
    pending.createdAt = Date.now()
    browserPendingWorkspaceImports.set(request.selectionId, pending)
    const serializedSize = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength

    return {
      selectionId: request.selectionId,
      fileName: pending.fileName,
      suggestedWorkspaceName: suggestedBrowserWorkspaceName(
        parsed.sourceWorkspaceName,
        pending.fileName,
      ),
      workspaceRevision,
      formatVersion: pending.bundle.formatVersion ?? 1,
      workspaceSchemaVersion: snapshot.schemaVersion,
      createdAt: pending.bundle.createdAt,
      includesSecrets: false,
      secretCount: 0,
      encryptedSizeBytes: pending.encryptedSizeBytes,
      decryptedSizeBytes: serializedSize,
      connections: snapshot.connections.length,
      environments: snapshot.environments.length,
      openTabs: snapshot.tabs.length,
      closedTabs: snapshot.closedTabs.length,
      savedItems: snapshot.libraryNodes.length,
      warnings: [],
    }
  },

  async selectWorkspaceImportFile(): Promise<WorkspaceImportSelection | undefined> {
    if (isTauriRuntime()) {
      return (await invokeDesktop<WorkspaceImportSelection | null>(
        'select_workspace_import_file',
      )) ?? undefined
    }

    const file = await pickBrowserWorkspaceBundleFile()
    if (!file) return undefined
    const bundle = JSON.parse(file.text) as ExportBundle
    if (
      bundle.format !== 'datapadplusplus-bundle'
      || bundle.formatVersion !== 2
      || typeof bundle.encryptedPayload !== 'string'
      || !bundle.encryptedPayload
      || !bundle.kdf
      || !bundle.cipher
    ) {
      throw new Error('This file is not a supported DataPad++ workspace bundle.')
    }
    if (bundle.includesSecrets || (bundle.secretCount ?? 0) > 0) {
      throw new Error('Browser preview cannot import workspace bundles that include passwords.')
    }
    const selectionId = browserWorkspaceImportSelectionId()
    browserPendingWorkspaceImports.set(selectionId, {
      bundle,
      fileName: file.fileName,
      encryptedSizeBytes: file.sizeBytes,
      workspaceRevision: loadBrowserSnapshot().workspaceRevision ?? 0,
      createdAt: Date.now(),
    })
    return { selectionId, fileName: file.fileName, encryptedSizeBytes: file.sizeBytes }
  },

  async commitWorkspaceImport(
    request: WorkspaceImportCommitRequest,
  ): Promise<WorkspaceImportCommitResponse> {
    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceImportCommitResponse>('commit_workspace_import', { request })
    }

    const pending = browserPendingWorkspaceImports.get(request.selectionId)
    if (!pending || Date.now() - pending.createdAt > BROWSER_PENDING_IMPORT_TTL_MS) {
      browserPendingWorkspaceImports.delete(request.selectionId)
      throw new Error('The workspace import selection expired. Choose the file again.')
    }
    if (!pending.snapshot) {
      throw new Error('Unlock and review the selected workspace before importing it.')
    }
    if (
      pending.workspaceRevision !== request.workspaceRevision
      || (loadBrowserSnapshot().workspaceRevision ?? 0) !== request.workspaceRevision
    ) {
      throw new Error('The workspace changed after the import preview. Review the file again.')
    }
    if (request.importSecrets) {
      throw new Error('Browser preview cannot import workspace passwords.')
    }
    const imported = importBrowserWorkspace(
      pending.snapshot,
      request.workspaceName,
      request.importAsNew ?? true,
    )
    browserPendingWorkspaceImports.delete(request.selectionId)
    return {
      payload: buildBrowserPayload(imported.snapshot),
      workspaceSwitcherStatus: imported.status,
    }
  },

  async cancelWorkspaceImport(request: WorkspaceImportCancelRequest): Promise<boolean> {
    if (isTauriRuntime()) {
      return invokeDesktop<boolean>('cancel_workspace_import', { request })
    }
    return browserPendingWorkspaceImports.delete(request.selectionId)
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

  async updateDatastoreTestsSettings(
    request: DatastoreTestsSettingsRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_datastore_tests_settings', { request })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    if (
      !request.enabled &&
      next.tabs.some(
        (tab) =>
          tab.tabKind === 'test-suite' &&
          (tab.activeExecution || tab.status === 'running' || tab.status === 'queued'),
      )
    ) {
      throw new Error(
        'Wait for the active datastore test run to finish or cancel it before disabling the plugin.',
      )
    }
    next.preferences.datastoreTests = { enabled: Boolean(request.enabled) }
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

  async analyzeWorkspaceStorage(
    request: WorkspaceStorageAnalysisRequest = {},
  ): Promise<WorkspaceStorageReport> {
    if (isTauriRuntime()) {
      return invokeDesktop<WorkspaceStorageReport>('analyze_workspace_storage', { request })
    }

    const snapshot = loadBrowserSnapshot()
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
    const backups = browserBackupSummaries()
    const backupTotalBytes = backups.reduce((total, backup) => total + backup.sizeBytes, 0)
    const tabContribution = (tab: WorkspaceSnapshot['tabs'][number], closed: boolean) => ({
      tabId: tab.id,
      title: tab.title,
      closed,
      totalBytes: bytes(tab),
      draftBytes: bytes({
        queryText: tab.queryText,
        sqlScope: tab.sqlScope,
        builderState: tab.builderState,
        queryEditorState: tab.queryEditorState,
        testSuite: tab.testSuite,
      }),
      historyBytes: bytes(tab.history),
      objectBytes: bytes(tab.objectViewState?.payload),
      metricsBytes: bytes(tab.metricsState?.diagnostics),
      testBytes: bytes(tab.testRun),
    })
    const largestTabs = [
      ...snapshot.tabs.map((tab) => tabContribution(tab, false)),
      ...snapshot.closedTabs.map((tab) => tabContribution(tab, true)),
    ].sort((left, right) => right.totalBytes - left.totalBytes).slice(0, 10)
    const projectedPlaintextBytes = bytes(snapshot)

    return {
      schemaVersion: snapshot.schemaVersion,
      workspaceBytes: projectedPlaintextBytes,
      recoveryBytes: 0,
      backupCount: backups.length,
      backupTotalBytes,
      backupAverageBytes: backups.length ? Math.floor(backupTotalBytes / backups.length) : 0,
      invalidBackupCount: backups.filter((backup) => backup.isCorrupt).length,
      projectedPlaintextBytes,
      projectedCompressedBytes: projectedPlaintextBytes,
      projectedEncryptedBytes: Math.ceil(projectedPlaintextBytes * 4 / 3),
      sections: [
        { key: 'connections', label: 'Connections', sizeBytes: bytes(snapshot.connections), itemCount: snapshot.connections.length },
        { key: 'environments', label: 'Environments', sizeBytes: bytes(snapshot.environments), itemCount: snapshot.environments.length },
        { key: 'open-tabs', label: 'Open tabs', sizeBytes: bytes(snapshot.tabs), itemCount: snapshot.tabs.length },
        { key: 'closed-tabs', label: 'Closed tabs', sizeBytes: bytes(snapshot.closedTabs), itemCount: snapshot.closedTabs.length },
        { key: 'saved-work', label: 'Saved work', sizeBytes: bytes([snapshot.libraryNodes, snapshot.savedWork]), itemCount: snapshot.libraryNodes.length + snapshot.savedWork.length },
        { key: 'adapter-manifests', label: 'Adapter manifests', sizeBytes: bytes(snapshot.adapterManifests), itemCount: snapshot.adapterManifests.length },
      ],
      largestTabs,
    }
  },

  async analyzeWorkspaceBackupFile(
    request: WorkspaceBackupFileAnalysisRequest,
  ): Promise<WorkspaceStorageReport | undefined> {
    validateWorkspaceBundlePassphrase(request.passphrase)
    if (isTauriRuntime()) {
      return (await invokeDesktop<WorkspaceStorageReport | null>(
        'analyze_workspace_backup_file',
        {
          request: {
            ...request,
            passphrase: toDesktopWorkspaceBundlePassphrase(request.passphrase),
          },
        },
      )) ?? undefined
    }
    throw new Error('Backup file analysis is available in the desktop app.')
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

function activeBrowserWorkspaceName() {
  const status = getBrowserWorkspaceSwitcherStatus()
  return status.workspaces.find((workspace) => workspace.id === status.activeWorkspaceId)?.name
}

function browserWorkspaceImportSelectionId() {
  return globalThis.crypto?.randomUUID?.() ?? `workspace-import-${Date.now()}`
}

function suggestedBrowserWorkspaceName(sourceWorkspaceName: string | undefined, fileName: string) {
  const source = sourceWorkspaceName?.trim()
  if (source) return source.slice(0, 80)

  const cleaned = fileName
    .replace(/\.datapadpp-workspace$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return (cleaned || 'Imported Workspace').slice(0, 80)
}
