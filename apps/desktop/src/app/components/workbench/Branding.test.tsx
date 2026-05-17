import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActivityBar } from './ActivityBar'
import { BootSurface, WelcomeSurface } from './BootSurfaces'

describe('workbench branding', () => {
  it('uses the public logo on the startup surface', () => {
    const { container } = render(
      <BootSurface
        title="Loading DataPad++ workspace..."
        copy="Connections and environments are being restored."
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading DataPad++ workspace...')
    expect(container.querySelector('img[src="/logo_transparent.png"]')).not.toBeNull()
  })

  it('uses the public logo on first-run onboarding', () => {
    const noop = vi.fn()
    const { container } = render(
      <WelcomeSurface
        onCreateConnection={noop}
        onImportWorkspace={noop}
        onOpenDiagnostics={noop}
      />,
    )

    expect(screen.getByLabelText('First run onboarding')).toBeInTheDocument()
    expect(container.querySelector('img[src="/logo_dark.png"]')).not.toBeNull()
    expect(container.querySelector('img[src="/logo.png"]')).not.toBeNull()
  })

  it('uses the compact public mark in the activity bar', () => {
    const { container } = render(
      <ActivityBar
        activeActivity="connections"
        sidebarCollapsed={false}
        theme="dark"
        onToggleSidebar={vi.fn()}
        onSelectActivity={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Activity bar')).toBeInTheDocument()
    expect(screen.getByLabelText('Tests view')).toBeInTheDocument()
    expect(container.querySelector('img[src="/icon.png"]')).not.toBeNull()
  })

  it('selects the tests activity from the activity bar', () => {
    const onSelectActivity = vi.fn()
    render(
      <ActivityBar
        activeActivity="connections"
        sidebarCollapsed={false}
        theme="dark"
        onToggleSidebar={vi.fn()}
        onSelectActivity={onSelectActivity}
        onToggleTheme={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText('Tests view'))

    expect(onSelectActivity).toHaveBeenCalledWith('tests')
  })
})
