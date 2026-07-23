import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EditorToolbar } from '../../../../src/app/components/workbench/EditorToolbar'

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
        canToggleBuilderView
        builderKind="redis-key-browser"
        queryWindowMode="raw"
        executeLabel="Run Command"
        executeAriaLabel="Run Redis command"
        onExecute={vi.fn()}
        onExplain={vi.fn()}
        onCancel={vi.fn()}
        onOpenConnectionDrawer={vi.fn()}
        onToggleQueryWindowMode={onToggleQueryWindowMode}
      />,
    )

    expect(screen.getByRole('button', { name: 'Run Redis command' })).toHaveTextContent(
      'Run Command',
    )
    expect(screen.queryByLabelText('Show key browser and console')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Key Browser')).toBeInTheDocument()
    expect(screen.getByLabelText('Redis Console')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Key Browser'))
    expect(onToggleQueryWindowMode).toHaveBeenCalledWith('builder')
  })

  it('shows Mongo builder, raw, and scripting modes without side-by-side', () => {
    const onToggleQueryWindowMode = vi.fn()
    const onAddDocument = vi.fn()
    render(
      <EditorToolbar
        executionStatus="idle"
        capabilities={baseCapabilities}
        canCancelExecution={false}
        canToggleBuilderView
        builderKind="mongo-find"
        queryWindowMode="builder"
        onExecute={vi.fn()}
        onExplain={vi.fn()}
        onCancel={vi.fn()}
        onOpenConnectionDrawer={vi.fn()}
        onToggleQueryWindowMode={onToggleQueryWindowMode}
        canAddDocument
        onAddDocument={onAddDocument}
      />,
    )

    expect(screen.getByLabelText('Query Builder')).toBeInTheDocument()
    expect(screen.getByLabelText('Raw')).toBeInTheDocument()
    expect(screen.getByLabelText('Scripting')).toBeInTheDocument()
    expect(screen.getByLabelText('Add document')).toBeInTheDocument()
    expect(screen.queryByLabelText('Show builder and raw')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Scripting'))
    expect(onToggleQueryWindowMode).toHaveBeenCalledWith('script')
    fireEvent.click(screen.getByLabelText('Add document'))
    expect(onAddDocument).toHaveBeenCalledTimes(1)
  })

  it('enables cancellation while a cancellable Mongo query is running', () => {
    const onCancel = vi.fn()

    render(
      <EditorToolbar
        executionStatus="loading"
        capabilities={{ ...baseCapabilities, canCancel: true, editorLanguage: 'mongodb' }}
        canCancelExecution
        canToggleBuilderView
        builderKind="mongo-find"
        queryWindowMode="builder"
        onExecute={vi.fn()}
        onExplain={vi.fn()}
        onCancel={onCancel}
        onOpenConnectionDrawer={vi.fn()}
        onToggleQueryWindowMode={vi.fn()}
      />,
    )

    const cancelButton = screen.getByRole('button', { name: 'Cancel query' })
    expect(cancelButton).not.toBeDisabled()
    fireEvent.click(cancelButton)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('locks query-changing controls while keeping cancellation and guide access available', () => {
    render(
      <EditorToolbar
        executionStatus="loading"
        executionLocked
        capabilities={{ ...baseCapabilities, canCancel: true, canExplain: true }}
        canCancelExecution
        canToggleBuilderView
        canAddDocument
        canToggleDocumentEfficiency
        builderKind="mongo-find"
        queryWindowMode="script"
        showScriptingGuideToggle
        scriptingGuideVisible
        onExecute={vi.fn()}
        onExplain={vi.fn()}
        onCancel={vi.fn()}
        onOpenConnectionDrawer={vi.fn()}
        onToggleQueryWindowMode={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Run query' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Explain query' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Query Builder' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Raw' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Scripting' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add document' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Efficiency mode off' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Change connection' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel query' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Hide scripting guide' })).toBeEnabled()
  })

  it('makes active document efficiency mode visually and semantically obvious', () => {
    const onToggleDocumentEfficiency = vi.fn()
    const { container } = render(
      <EditorToolbar
        executionStatus="idle"
        capabilities={baseCapabilities}
        canCancelExecution={false}
        canToggleBuilderView={false}
        queryWindowMode="raw"
        onExecute={vi.fn()}
        onExplain={vi.fn()}
        onCancel={vi.fn()}
        onOpenConnectionDrawer={vi.fn()}
        onToggleQueryWindowMode={vi.fn()}
        canToggleDocumentEfficiency
        documentEfficiencyMode
        onToggleDocumentEfficiency={onToggleDocumentEfficiency}
      />,
    )

    const toggle = screen.getByRole('button', { name: 'Efficiency mode on' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveClass('toolbar-icon-action--efficiency', 'is-active')
    expect(container.querySelector('.toolbar-efficiency-active-dot')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(onToggleDocumentEfficiency).toHaveBeenCalledTimes(1)
  })

  it('omits results panel controls from the editor toolbar', () => {
    render(
      <EditorToolbar
        executionStatus="idle"
        capabilities={baseCapabilities}
        canCancelExecution={false}
        canToggleBuilderView={false}
        queryWindowMode="raw"
        onExecute={vi.fn()}
        onExplain={vi.fn()}
        onCancel={vi.fn()}
        onOpenConnectionDrawer={vi.fn()}
        onToggleQueryWindowMode={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Show results panel' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Dock results to right' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Dock results to bottom' }),
    ).not.toBeInTheDocument()
  })

  it('toggles the MongoDB scripting guide with an accessible icon action', () => {
    const onToggleScriptingGuide = vi.fn()
    const { rerender } = render(
      <EditorToolbar
        executionStatus="idle"
        capabilities={baseCapabilities}
        canCancelExecution={false}
        canToggleBuilderView
        builderKind="mongo-find"
        queryWindowMode="script"
        showScriptingGuideToggle
        scriptingGuideVisible
        onToggleScriptingGuide={onToggleScriptingGuide}
        onExecute={vi.fn()}
        onExplain={vi.fn()}
        onCancel={vi.fn()}
        onOpenConnectionDrawer={vi.fn()}
        onToggleQueryWindowMode={vi.fn()}
      />,
    )

    const hide = screen.getByRole('button', { name: 'Hide scripting guide' })
    expect(hide).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(hide)
    expect(onToggleScriptingGuide).toHaveBeenCalledOnce()

    rerender(
      <EditorToolbar
        executionStatus="idle"
        capabilities={baseCapabilities}
        canCancelExecution={false}
        canToggleBuilderView
        builderKind="mongo-find"
        queryWindowMode="script"
        showScriptingGuideToggle
        scriptingGuideVisible={false}
        onToggleScriptingGuide={onToggleScriptingGuide}
        onExecute={vi.fn()}
        onExplain={vi.fn()}
        onCancel={vi.fn()}
        onOpenConnectionDrawer={vi.fn()}
        onToggleQueryWindowMode={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Show scripting guide' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
