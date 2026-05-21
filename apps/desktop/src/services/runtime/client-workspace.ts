import type { BootstrapPayload, DiagnosticsReport, ExportBundle, UpdateUiStateRequest, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createBrowserPreviewHealth } from '../../app/data/workspace-factory'
import { buildDiagnosticsReport, migrateWorkspaceSnapshot } from '../../app/state/helpers'
import { decodeBase64, encodeBase64, buildBrowserPayload, cloneSnapshot, hashPassphrase, loadBrowserSnapshot, saveBrowserSnapshot, updateUiStateLocally } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'

const WORKSPACE_BUNDLE_PASSPHRASE_MIN_LENGTH = 8

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

  async createDiagnosticsReport(): Promise<DiagnosticsReport> {
    if (isTauriRuntime()) {
      return invokeDesktop<DiagnosticsReport>('create_diagnostics_report')
    }

    const snapshot = loadBrowserSnapshot()
    return buildDiagnosticsReport(snapshot, createBrowserPreviewHealth())
  },

  async exportWorkspaceBundle(passphrase: string): Promise<ExportBundle> {
    validateWorkspaceBundlePassphrase(passphrase)

    if (isTauriRuntime()) {
      return invokeDesktop<ExportBundle>('export_workspace_bundle', { passphrase })
    }

    return {
      format: 'datapadplusplus-bundle',
      version: 3,
      encryptedPayload: encodeBase64(
        JSON.stringify({
          passphraseHash: hashPassphrase(passphrase),
          snapshot: migrateWorkspaceSnapshot(loadBrowserSnapshot()),
        }),
      ),
    }
  },

  async importWorkspaceBundle(
    passphrase: string,
    encryptedPayload: string,
  ): Promise<BootstrapPayload> {
    validateWorkspaceBundlePassphrase(passphrase)

    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('import_workspace_bundle', {
        passphrase,
        encryptedPayload,
      })
    }

    try {
      const decoded = JSON.parse(decodeBase64(encryptedPayload)) as {
        snapshot?: WorkspaceSnapshot
        passphraseHash?: string
      }

      if (!decoded.snapshot) {
        throw new Error('Missing snapshot payload.')
      }

      if (
        typeof decoded.passphraseHash === 'string' &&
        decoded.passphraseHash !== hashPassphrase(passphrase)
      ) {
        throw new Error('Passphrase does not match the exported bundle.')
      }

      const snapshot = migrateWorkspaceSnapshot(decoded.snapshot)
      saveBrowserSnapshot(snapshot)
      return buildBrowserPayload(snapshot)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to import the encrypted bundle.'

      throw new Error(message, {
        cause: error,
      })
    }
  },

  async updateUiState(patch: UpdateUiStateRequest): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_ui_state', { patch })
    }

    const snapshot = updateUiStateLocally(loadBrowserSnapshot(), patch)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },
}

function validateWorkspaceBundlePassphrase(passphrase: string) {
  if (passphrase.trim().length < WORKSPACE_BUNDLE_PASSPHRASE_MIN_LENGTH) {
    throw new Error('Use a workspace backup passphrase with at least 8 characters.')
  }
}
