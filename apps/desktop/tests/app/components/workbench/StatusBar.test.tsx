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
  it('does not show API or MCP indicators when neither server feature is visible', () => {
    renderStatusBar()

    expect(
      screen.queryByRole('button', { name: /Open API Server workspace/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Open MCP Server workspace/ }),
    ).not.toBeInTheDocument()
  })

  it('shows a muted API indicator without a badge when enabled but stopped', () => {
    const onOpen = vi.fn()
    renderStatusBar({
      apiServerIndicator: {
        visible: true,
        runningCount: 0,
        onOpen,
      },
    })

    const button = screen.getByRole('button', {
      name: 'Open API Server workspace, stopped',
    })

    expect(button).toHaveTextContent('API')
    expect(button).toHaveClass('status-button--server')
    expect(button).not.toHaveClass('is-running')
    expect(button.querySelector('.status-server-badge')).not.toBeInTheDocument()

    fireEvent.click(button)

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('shows a colored API indicator with the running server count badge', () => {
    const onOpen = vi.fn()
    renderStatusBar({
      apiServerIndicator: {
        visible: true,
        runningCount: 2,
        onOpen,
      },
    })

    const button = screen.getByRole('button', {
      name: 'Open API Server workspace, 2 running',
    })

    expect(button).toHaveClass('status-button--server', 'is-running')
    expect(button).toHaveTextContent('API')
    expect(button.querySelector('.status-server-badge')).toHaveTextContent('2')

    fireEvent.click(button)

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('shows a muted MCP text indicator when enabled but stopped', () => {
    const onOpen = vi.fn()
    renderStatusBar({
      mcpServerIndicator: {
        visible: true,
        running: false,
        onOpen,
      },
    })

    const button = screen.getByRole('button', {
      name: 'Open MCP Server workspace, stopped',
    })

    expect(button).toHaveClass('status-button--server')
    expect(button).not.toHaveClass('is-running')
    expect(button).toHaveTextContent('MCP')

    fireEvent.click(button)

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('shows a colored MCP text indicator when running', () => {
    const onOpen = vi.fn()
    renderStatusBar({
      mcpServerIndicator: {
        visible: true,
        running: true,
        onOpen,
      },
    })

    const button = screen.getByRole('button', {
      name: 'Open MCP Server workspace, running',
    })

    expect(button).toHaveClass('status-button--server', 'is-running')
    expect(button).toHaveTextContent('MCP')

    fireEvent.click(button)

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('shows a colored Security Checks indicator for high findings', () => {
    const onOpen = vi.fn()
    renderStatusBar({
      securityChecksIndicator: {
        criticalCount: 0,
        highCount: 2,
        onOpen,
      },
    })

    const button = screen.getByRole('button', {
      name: 'Open Security Checks workspace, 0 critical and 2 high findings',
    })

    expect(button).toHaveClass('status-button--security', 'is-high')
    expect(button).toHaveTextContent('Security: 2')

    fireEvent.click(button)

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('uses the critical Security Checks color when any critical finding exists', () => {
    const onOpen = vi.fn()
    renderStatusBar({
      securityChecksIndicator: {
        criticalCount: 1,
        highCount: 3,
        onOpen,
      },
    })

    const button = screen.getByRole('button', {
      name: 'Open Security Checks workspace, 1 critical and 3 high findings',
    })

    expect(button).toHaveClass('status-button--security', 'is-critical')
    expect(button).toHaveTextContent('Security: 4')
  })

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
