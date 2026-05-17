import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EditorToolbar } from './EditorToolbar'

const baseCapabilities = {
  canCancel: false,
  canExplain: false,
  supportsLiveMetadata: true,
  editorLanguage: 'plaintext',
  defaultRowLimit: 100,
}

describe('EditorToolbar', () => {
  it('uses Redis-specific view options and command labels', () => {
    const onToggleQueryWindowMode = vi.fn()
    render(
      <EditorToolbar
        executionStatus="idle"
        capabilities={baseCapabilities}
        canCancelExecution={false}
        bottomPanelVisible={false}
        canToggleBuilderView
        builderKind="redis-key-browser"
        queryWindowMode="raw"
        executeLabel="Run Command"
        executeAriaLabel="Run Redis command"
        onExecute={vi.fn()}
        onExplain={vi.fn()}
        onCancel={vi.fn()}
        onOpenConnectionDrawer={vi.fn()}
        onToggleBottomPanel={vi.fn()}
        onToggleQueryWindowMode={onToggleQueryWindowMode}
      />,
    )

    expect(screen.getByRole('button', { name: 'Run Redis command' })).toHaveTextContent(
      'Run Command',
    )
    expect(screen.getByLabelText('Show key browser and console')).toBeInTheDocument()
    expect(screen.getByLabelText('Show key browser')).toBeInTheDocument()
    expect(screen.getByLabelText('Show Redis console')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Show key browser'))
    expect(onToggleQueryWindowMode).toHaveBeenCalledWith('builder')
  })
})
