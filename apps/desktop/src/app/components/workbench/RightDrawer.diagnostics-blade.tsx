import { useMemo, useState } from 'react'
import type {
  AppHealth,
  DiagnosticsReport,
  ExportBundle,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import {
  CopyIcon,
  DownloadIcon,
  RefreshIcon,
  SettingsIcon,
  ThemeIcon,
} from './icons'
import { SHORTCUTS } from './RightDrawer.helpers'
import { DrawerDetailRow, DrawerHeader, FormField } from './RightDrawer.primitives'

const PASSPHRASE_MIN_LENGTH = 8

export function DiagnosticsBlade({
  diagnostics,
  exportBundle,
  exportPassphrase,
  health,
  importPayload,
  theme,
  onClose,
  onExportPassphraseChange,
  onExportWorkspace,
  onImportPayloadChange,
  onImportWorkspace,
  onRefreshDiagnostics,
  onToggleTheme,
}: {
  diagnostics?: DiagnosticsReport
  exportBundle?: ExportBundle
  exportPassphrase: string
  health: AppHealth
  importPayload: string
  theme: WorkspaceSnapshot['preferences']['theme']
  onClose(): void
  onExportPassphraseChange(value: string): void
  onExportWorkspace(): void
  onImportPayloadChange(value: string): void
  onImportWorkspace(encryptedPayload: string): void
  onRefreshDiagnostics(): void
  onToggleTheme(): void
}) {
  const [bundleMessage, setBundleMessage] = useState('')
  const [exportPassphraseUsed, setExportPassphraseUsed] = useState('')
  const exportedBundleText = useMemo(
    () => (exportBundle ? JSON.stringify(exportBundle, null, 2) : ''),
    [exportBundle],
  )
  const passphraseReady = exportPassphrase.trim().length >= PASSPHRASE_MIN_LENGTH
  const bundlePassphraseChanged =
    Boolean(exportedBundleText) && exportPassphraseUsed !== exportPassphrase
  const restorePayload = normalizeBundlePayload(importPayload)
  const restoreReady = passphraseReady && Boolean(restorePayload)
  const warnings = diagnostics?.warnings ?? []

  const copyExportedBundle = async () => {
    if (!exportedBundleText) {
      return
    }

    try {
      await navigator.clipboard?.writeText(exportedBundleText)
      setBundleMessage('Backup bundle copied.')
    } catch {
      setBundleMessage('Unable to copy backup bundle.')
    }
  }

  const downloadExportedBundle = () => {
    if (!exportedBundleText) {
      return
    }

    const blob = new Blob([exportedBundleText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `datapadplusplus-workspace-${new Date()
      .toISOString()
      .slice(0, 10)}.dppbundle.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setBundleMessage('Backup bundle downloaded.')
  }

  const restoreWorkspace = () => {
    if (!restorePayload) {
      setBundleMessage('Paste a valid workspace bundle before restoring.')
      return
    }

    const confirmed = window.confirm(
      'Restore this workspace backup? This replaces the current local workspace.',
    )

    if (confirmed) {
      onImportWorkspace(restorePayload)
    }
  }

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
            <DrawerDetailRow label="Current theme" value={theme} />
            <DrawerDetailRow label="Secret storage" value={health.secretStorage} />
          </div>
        </section>

        <section className="drawer-section settings-card">
          <div className="drawer-section-header">
            <div>
              <strong>Workspace Backup</strong>
              <p className="drawer-copy">
                Create an encrypted bundle of your local workspace layout, Library, environments,
                and connection profiles. Secrets are kept in the desktop secret store and are not
                written into the bundle.
              </p>
            </div>
          </div>

          <FormField label="Backup passphrase">
            <input
              type="password"
              autoComplete="new-password"
              value={exportPassphrase}
              onChange={(event) => {
                setBundleMessage('')
                onExportPassphraseChange(event.target.value)
              }}
              placeholder="At least 8 characters"
            />
          </FormField>
          <p className="settings-helper-text">
            You will need this passphrase to restore the workspace later. DataPad++ does not store
            it for you.
          </p>

          <div className="drawer-button-row">
            <button
              type="button"
              className="drawer-button drawer-button--primary"
              disabled={!passphraseReady}
              onClick={() => {
                setBundleMessage('')
                setExportPassphraseUsed(exportPassphrase)
                onExportWorkspace()
              }}
            >
              Create Backup Bundle
            </button>
            <button
              type="button"
              className="drawer-button"
              disabled={!exportedBundleText}
              onClick={() => void copyExportedBundle()}
            >
              <CopyIcon className="drawer-inline-icon" />
              Copy Bundle
            </button>
            <button
              type="button"
              className="drawer-button"
              disabled={!exportedBundleText}
              onClick={downloadExportedBundle}
            >
              <DownloadIcon className="drawer-inline-icon" />
              Download
            </button>
          </div>

          {exportedBundleText ? (
            <div className="settings-bundle-preview">
              <div className="drawer-section-header">
                <strong>Backup bundle ready</strong>
                <span>encrypted</span>
              </div>
              {bundlePassphraseChanged ? (
                <p className="settings-helper-text">
                  This bundle was created before the passphrase field changed.
                </p>
              ) : null}
              <pre className="drawer-code settings-bundle-code">
                <code>{exportedBundleText}</code>
              </pre>
            </div>
          ) : null}
        </section>

        <section className="drawer-section settings-card">
          <div className="drawer-section-header">
            <div>
              <strong>Restore Workspace</strong>
              <p className="drawer-copy">
                Paste a DataPad++ backup bundle. Restoring replaces the current workspace after the
                passphrase unlocks the bundle.
              </p>
            </div>
          </div>

          <FormField label="Workspace bundle">
            <textarea
              rows={7}
              value={importPayload}
              onChange={(event) => {
                setBundleMessage('')
                onImportPayloadChange(event.target.value)
              }}
              placeholder="Paste the full .dppbundle JSON or encrypted payload"
            />
          </FormField>

          <div className="settings-restore-summary">
            <span>{restorePayload ? 'Bundle format looks valid.' : 'Waiting for a bundle.'}</span>
            <button
              type="button"
              className="drawer-button drawer-button--primary"
              disabled={!restoreReady}
              onClick={restoreWorkspace}
            >
              Restore Workspace
            </button>
          </div>
        </section>

        {bundleMessage ? (
          <div className="settings-inline-message" role="status">
            {bundleMessage}
          </div>
        ) : null}

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

function normalizeBundlePayload(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<ExportBundle>

    if (
      parsed.format === 'datapadplusplus-bundle' &&
      typeof parsed.encryptedPayload === 'string'
    ) {
      return parsed.encryptedPayload.trim()
    }
  } catch {
    // Raw encrypted payloads are still accepted for older copied bundles.
  }

  return trimmed
}
