import { fireEvent, render, screen } from '@testing-library/react'
import type { AppHealth, DiagnosticsReport } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { DiagnosticsBlade } from '../../../../src/app/components/workbench/RightDrawer.diagnostics-blade'

describe('DiagnosticsBlade', () => {
  it('keeps workspace transfer controls out of the diagnostics drawer', () => {
    renderDiagnostics()

    expect(screen.queryByRole('button', { name: 'Create Backup Bundle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore Workspace' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Encrypted workspace bundle')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Include connection passwords/i)).not.toBeInTheDocument()
  })

  it('renders Settings status values as user-facing labels', () => {
    renderDiagnostics({ health: { ...health, secretStorage: 'planned' }, theme: 'system' })

    expect(screen.getByText('Current theme')).toBeInTheDocument()
    expect(screen.getByText('Use system setting')).toBeInTheDocument()
    expect(screen.getByText('Credential storage')).toBeInTheDocument()
    expect(screen.getByText('Preview mode')).toBeInTheDocument()
    expect(screen.getByText('Window lifecycle')).toBeInTheDocument()
    expect(screen.getByText('C:\\logs\\datapadplusplus-window-lifecycle.log')).toBeInTheDocument()
    expect(screen.queryByText('planned')).not.toBeInTheDocument()
  })

  it('keeps appearance and health actions available', () => {
    const onRefreshDiagnostics = vi.fn()
    const onToggleTheme = vi.fn()

    renderDiagnostics({ onRefreshDiagnostics, onToggleTheme })

    fireEvent.click(screen.getByRole('button', { name: 'Switch theme' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(onToggleTheme).toHaveBeenCalledOnce()
    expect(onRefreshDiagnostics).toHaveBeenCalledOnce()
  })
})

function renderDiagnostics({
  health: healthOverride = health,
  theme = 'dark',
  onRefreshDiagnostics = vi.fn(),
  onToggleTheme = vi.fn(),
}: {
  health?: AppHealth
  theme?: 'dark' | 'light' | 'system'
  onRefreshDiagnostics?: () => void
  onToggleTheme?: () => void
} = {}) {
  return render(
    <DiagnosticsBlade
      diagnostics={diagnostics}
      health={healthOverride}
      theme={theme}
      onClose={vi.fn()}
      onRefreshDiagnostics={onRefreshDiagnostics}
      onToggleTheme={onToggleTheme}
    />,
  )
}

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
  windowLifecyclePath: 'C:\\logs\\datapadplusplus-window-lifecycle.log',
  createdAt: '2026-05-22T00:00:00.000Z',
}
