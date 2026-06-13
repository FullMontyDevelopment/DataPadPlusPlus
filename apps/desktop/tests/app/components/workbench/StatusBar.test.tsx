import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StatusBar } from '../../../../src/app/components/workbench/StatusBar'

function renderStatusBar(overrides: Partial<Parameters<typeof StatusBar>[0]> = {}) {
  const props: Parameters<typeof StatusBar>[0] = {
    bottomPanelVisible: false,
    messageCount: 0,
    updateInstallStatus: 'idle',
    updateStatus: 'idle',
    onInstallUpdate: vi.fn(),
    onOpenDiagnostics: vi.fn(),
    onOpenMessages: vi.fn(),
    onToggleBottomPanel: vi.fn(),
    ...overrides,
  }

  render(<StatusBar {...props} />)
  return props
}

describe('StatusBar', () => {
  it('shows an install update button before the errors button', () => {
    const props = renderStatusBar({
      availableUpdateVersion: '0.1.33',
      messageCount: 1,
    })

    const updateButton = screen.getByRole('button', {
      name: 'Install DataPad++ 0.1.33 update',
    })
    const errorButton = screen.getByRole('button', {
      name: 'Show 1 workbench message',
    })

    expect(updateButton.compareDocumentPosition(errorButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(updateButton).toHaveTextContent('Update: 0.1.33')

    fireEvent.click(updateButton)

    expect(props.onInstallUpdate).toHaveBeenCalled()
  })

  it('disables the update button while the update is installing', () => {
    const props = renderStatusBar({
      availableUpdateVersion: '0.1.33',
      updateInstallStatus: 'installing',
    })

    const updateButton = screen.getByRole('button', {
      name: 'Installing DataPad++ 0.1.33 update',
    })

    expect(updateButton).toBeDisabled()
    expect(updateButton).toHaveTextContent('Updating...')

    fireEvent.click(updateButton)

    expect(props.onInstallUpdate).not.toHaveBeenCalled()
  })
})
