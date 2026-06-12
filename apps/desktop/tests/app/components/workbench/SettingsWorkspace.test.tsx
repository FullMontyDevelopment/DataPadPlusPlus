import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { AppHealth, DiagnosticsReport, WorkspaceBackupSummary } from '@datapadplusplus/shared-types'
import { createSeedSnapshot } from '../../../fixtures/seed-workspace'
import { SettingsWorkspace } from '../../../../src/app/components/workbench/SettingsWorkspace'

const health: AppHealth = {
  adapterHost: 'simulated',
  platform: 'windows',
  runtime: 'tauri',
  secretStorage: 'ready',
  telemetry: 'opt-in',
}

const diagnostics: DiagnosticsReport = {
  appVersion: '0.1.14',
  createdAt: '2026-05-29T00:00:00.000Z',
  platform: 'windows',
  runtime: 'browser-preview',
  warnings: [],
  counts: {
    connections: 2,
    environments: 1,
    library: 3,
    savedWork: 0,
    tabs: 1,
  },
}

function renderSettings(overrides: Partial<ComponentProps<typeof SettingsWorkspace>> = {}) {
  const preferences = createSeedSnapshot().preferences
  const props: ComponentProps<typeof SettingsWorkspace> = {
    diagnostics,
    health,
    preferences,
    updateInstallStatus: 'idle',
    updateSettings: {
      includePrereleases: false,
      supported: true,
    },
    updateStatus: 'idle',
    onCheckForUpdates: vi.fn(),
    onClearLogFile: vi.fn().mockResolvedValue({
      content: '',
      file: {
        fileName: 'datapadplusplus.log',
        id: 'datapadplusplus.log',
        modifiedAt: '1770000000',
        path: 'C:\\Users\\gmont\\AppData\\Local\\DataPad++\\logs\\datapadplusplus.log',
        sizeBytes: 0,
      },
    }),
    onCreateBackup: vi.fn().mockResolvedValue({
      backups: [],
      created: true,
      message: 'Workspace backup created.',
    }),
    onDeleteBackup: vi.fn().mockResolvedValue([]),
    onDeleteLogFile: vi.fn().mockResolvedValue([]),
    onExportWorkspaceFile: vi.fn().mockResolvedValue('workspace.datapadpp-workspace'),
    onImportWorkspaceFile: vi.fn().mockResolvedValue(undefined),
    onInstallUpdate: vi.fn(),
    onListBackups: vi.fn().mockResolvedValue([]),
    onListLogFiles: vi.fn().mockResolvedValue([]),
    onReadLogFile: vi.fn().mockResolvedValue({
      content: 'line one',
      file: {
        fileName: 'datapadplusplus.log',
        id: 'datapadplusplus.log',
        modifiedAt: '1770000000',
        path: 'C:\\Users\\gmont\\AppData\\Local\\DataPad++\\logs\\datapadplusplus.log',
        sizeBytes: 8,
      },
    }),
    onRestoreBackup: vi.fn().mockResolvedValue(undefined),
    onSetKeyboardShortcut: vi.fn().mockResolvedValue(undefined),
    onSetSafeMode: vi.fn(),
    onSetTheme: vi.fn(),
    onSetUpdatePrereleases: vi.fn(),
    onUpdateBackupSettings: vi.fn().mockResolvedValue(true),
    ...overrides,
  }

  render(<SettingsWorkspace {...props} />)
  return props
}

describe('SettingsWorkspace', () => {
  it('uses a section menu with focused settings pages', async () => {
    renderSettings()

    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Security' }))

    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument()
    expect(screen.getByText('Global safe mode')).toBeInTheDocument()
    expect(screen.queryByText('Credential storage')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Appearance' })).not.toBeInTheDocument()
  })

  it('can open directly to Security and toggle global safe mode', async () => {
    const props = renderSettings({ initialSection: 'security' })

    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument()
    const safeModeToggle = screen.getByLabelText('Global safe mode')
    expect(safeModeToggle).toBeChecked()

    fireEvent.click(safeModeToggle)

    expect(props.onSetSafeMode).toHaveBeenCalledWith(false)
  })

  it('exports and imports workspace files with the selected passphrase and secret option', async () => {
    const props = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Workspace + Backups' }))

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.change(screen.getByLabelText('Export passphrase'), {
      target: { value: 'correct-horse-battery-staple' },
    })
    fireEvent.click(screen.getByLabelText('Include passwords'))
    fireEvent.click(screen.getByRole('button', { name: 'Export Workspace' }))

    await waitFor(() => {
      expect(props.onExportWorkspaceFile).toHaveBeenCalledWith(
        'correct-horse-battery-staple',
        true,
      )
    })
    expect(screen.getByText('Workspace exported.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    fireEvent.change(screen.getByLabelText('Import passphrase'), {
      target: { value: 'correct-horse-battery-staple' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import Workspace' }))
    await waitFor(() => {
      expect(props.onImportWorkspaceFile).toHaveBeenCalledWith(
        'correct-horse-battery-staple',
      )
    })
  })

  it('manages backup rows with restore and delete confirmation', async () => {
    const backup: WorkspaceBackupSummary = {
      createdAt: '1770000000',
      fileName: 'backup.datapadpp-workspace',
      id: 'backup',
      includesSecrets: true,
      secretCount: 2,
      sizeBytes: 2048,
      version: 9,
    }
    const props = renderSettings({
      onListBackups: vi.fn().mockResolvedValue([backup]),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Workspace + Backups' }))
    const table = await screen.findByRole('table', { name: 'Workspace backups' })

    expect(within(table).getByText('2')).toBeInTheDocument()
    fireEvent.click(within(table).getByLabelText('Restore backup.datapadpp-workspace'))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => {
      expect(props.onRestoreBackup).toHaveBeenCalledWith('backup', '')
    })

    fireEvent.click(within(table).getByLabelText('Delete backup.datapadpp-workspace'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(props.onDeleteBackup).toHaveBeenCalledWith('backup')
    })
  })

  it('checks updates and saves pre-release preference', async () => {
    const props = renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'Updates' }))
    fireEvent.click(screen.getByLabelText('Pre-release updates'))
    fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }))

    expect(props.onSetUpdatePrereleases).toHaveBeenCalledWith(true)
    expect(props.onCheckForUpdates).toHaveBeenCalled()
  })

  it('shows an available update install action', async () => {
    const props = renderSettings({
      updateCheckResult: {
        status: 'available',
        channel: 'stable',
        currentVersion: '0.1.22',
        checkedAt: '1770000000',
        message: 'DataPad++ 0.1.23 is available.',
        settings: {
          includePrereleases: false,
          supported: true,
        },
        candidate: {
          version: '0.1.23',
          currentVersion: '0.1.22',
          channel: 'stable',
          releaseUrl: 'https://github.com/FullMontyDevelopment/DataPadPlusPlus/releases/app-v0.1.23',
          manifestUrl: 'https://github.com/FullMontyDevelopment/DataPadPlusPlus/releases/download/app-v0.1.23/latest.json',
        },
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Updates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update to 0.1.23' }))

    expect(screen.getByText('0.1.23')).toBeInTheDocument()
    expect(screen.getByText('Update available')).toBeInTheDocument()
    expect(props.onInstallUpdate).toHaveBeenCalled()
  })

  it('shows the updater support reason when updates are unavailable', () => {
    renderSettings({
      updateSettings: {
        includePrereleases: false,
        supported: false,
        supportMessage: 'Update signing public key is not configured for this build.',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Updates' }))

    expect(screen.getByText('Update signing public key is not configured for this build.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check for Updates' })).toBeDisabled()
  })

  it('edits shortcuts and opens logs as plain text', async () => {
    const props = renderSettings({
      onListLogFiles: vi.fn().mockResolvedValue([
        {
          fileName: 'datapadplusplus.log',
          id: 'datapadplusplus.log',
          modifiedAt: '1770000000',
          path: 'C:\\Users\\gmont\\AppData\\Local\\DataPad++\\logs\\datapadplusplus.log',
          sizeBytes: 8,
        },
      ]),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Shortcuts' }))
    const runShortcut = screen.getByLabelText('Run query shortcut')
    fireEvent.change(runShortcut, { target: { value: 'Ctrl+R' } })
    fireEvent.blur(runShortcut)

    await waitFor(() => {
      expect(props.onSetKeyboardShortcut).toHaveBeenCalledWith('runQuery', 'Ctrl+R')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    await screen.findByRole('button', { name: /datapadplusplus.log/i })
    expect(screen.getByLabelText('Log file contents')).toHaveValue('line one')
  })

  it('explains when the desktop log command is unavailable', async () => {
    renderSettings({
      onListLogFiles: vi.fn().mockResolvedValue(undefined),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))

    expect(
      await screen.findByText(
        'Logs could not be loaded. Restart the desktop debug session if this app was already running.',
      ),
    ).toBeInTheDocument()
  })
})
