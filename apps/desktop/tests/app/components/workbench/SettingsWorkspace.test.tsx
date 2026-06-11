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
    onCreateBackup: vi.fn().mockResolvedValue(undefined),
    onDeleteBackup: vi.fn().mockResolvedValue([]),
    onExportWorkspaceFile: vi.fn().mockResolvedValue('workspace.datapadpp-workspace'),
    onImportWorkspaceFile: vi.fn().mockResolvedValue(undefined),
    onListBackups: vi.fn().mockResolvedValue([]),
    onRefreshDiagnostics: vi.fn(),
    onRestoreBackup: vi.fn().mockResolvedValue(undefined),
    onSetSafeMode: vi.fn(),
    onSetTheme: vi.fn(),
    onUpdateBackupSettings: vi.fn().mockResolvedValue(undefined),
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
    expect(screen.getByText('Credential storage')).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))

    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'correct-horse-battery-staple' },
    })
    fireEvent.click(screen.getByLabelText('Include passwords'))
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => {
      expect(props.onExportWorkspaceFile).toHaveBeenCalledWith(
        'correct-horse-battery-staple',
        true,
      )
    })
    expect(screen.getByText('Workspace exported.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'Backups' }))
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
})
