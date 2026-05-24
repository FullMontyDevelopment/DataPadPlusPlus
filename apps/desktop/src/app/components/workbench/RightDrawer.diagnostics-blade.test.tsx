import { fireEvent, render, screen } from '@testing-library/react'
import type {
  AppHealth,
  DiagnosticsReport,
  ExportBundle,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { DiagnosticsBlade } from './RightDrawer.diagnostics-blade'

describe('DiagnosticsBlade', () => {
  it('keeps encrypted backup bundle text hidden until requested', () => {
    render(
      <DiagnosticsBlade
        diagnostics={diagnostics}
        exportBundle={exportBundle}
        exportPassphrase="correct horse"
        health={health}
        importPayload=""
        theme="dark"
        onClose={vi.fn()}
        onExportPassphraseChange={vi.fn()}
        onExportWorkspace={vi.fn()}
        onImportPayloadChange={vi.fn()}
        onImportWorkspace={vi.fn()}
        onRefreshDiagnostics={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    )

    expect(screen.getByText('Backup bundle ready')).toBeInTheDocument()
    expect(screen.getByText('The bundle is encrypted and ready to download or copy. Secrets are not included.')).toBeInTheDocument()
    expect(screen.queryByText(/ciphertext-secret-looking-value/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show encrypted bundle text' }))

    expect(screen.getByLabelText('Encrypted workspace bundle')).toHaveTextContent('ciphertext-secret-looking-value')
    expect(screen.getByRole('button', { name: 'Hide encrypted bundle text' })).toBeInTheDocument()
  })

  it('renders Settings status values as user-facing labels', () => {
    render(
      <DiagnosticsBlade
        diagnostics={diagnostics}
        exportBundle={undefined}
        exportPassphrase=""
        health={{ ...health, secretStorage: 'planned' }}
        importPayload=""
        theme="system"
        onClose={vi.fn()}
        onExportPassphraseChange={vi.fn()}
        onExportWorkspace={vi.fn()}
        onImportPayloadChange={vi.fn()}
        onImportWorkspace={vi.fn()}
        onRefreshDiagnostics={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    )

    expect(screen.getByText('Current theme')).toBeInTheDocument()
    expect(screen.getByText('Use system setting')).toBeInTheDocument()
    expect(screen.getByText('Credential storage')).toBeInTheDocument()
    expect(screen.getByText('Preview mode')).toBeInTheDocument()
    expect(screen.queryByText('planned')).not.toBeInTheDocument()
  })
})

const health: AppHealth = {
  runtime: 'tauri',
  adapterHost: 'connected',
  secretStorage: 'ready',
  platform: 'windows',
  telemetry: 'disabled',
}

const diagnostics: DiagnosticsReport = {
  appVersion: '0.1.9',
  platform: 'windows',
  runtime: 'desktop',
  counts: {
    connections: 1,
    savedWork: 0,
    library: 2,
    environments: 1,
    tabs: 0,
  },
  warnings: [],
  createdAt: '2026-05-22T00:00:00.000Z',
}

const exportBundle: ExportBundle = {
  format: 'datapadplusplus-bundle',
  version: 1,
  encryptedPayload: 'ciphertext-secret-looking-value',
}
