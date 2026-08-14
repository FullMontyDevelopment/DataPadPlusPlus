import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceExportDialog,
  WorkspaceImportDialog,
} from '../../../../src/app/components/workbench/WorkspaceTransferDialogs'

const selection = {
  selectionId: 'selection-1',
  fileName: 'qa-workspace.datapadpp-workspace',
  encryptedSizeBytes: 4096,
}

const preview = {
  ...selection,
  suggestedWorkspaceName: 'QA Workspace',
  workspaceRevision: 7,
  formatVersion: 2,
  workspaceSchemaVersion: 12,
  createdAt: '2026-08-14T00:00:00.000Z',
  includesSecrets: true,
  secretCount: 2,
  decryptedSizeBytes: 8192,
  connections: 4,
  environments: 2,
  openTabs: 3,
  closedTabs: 1,
  savedItems: 5,
  warnings: ['Passwords are available but require explicit opt-in.'],
}

function renderImport(overrides: Partial<Parameters<typeof WorkspaceImportDialog>[0]> = {}) {
  const props: Parameters<typeof WorkspaceImportDialog>[0] = {
    canImportSecrets: true,
    currentWorkspaceName: 'Current Workspace',
    onCancelSelection: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    onCommit: vi.fn().mockResolvedValue({
      status: 'completed',
      value: {
        payload: {} as never,
        workspaceSwitcherStatus: {} as never,
      },
    }),
    onCompleted: vi.fn(),
    onPreview: vi.fn().mockResolvedValue({ status: 'completed', value: preview }),
    onSelectFile: vi.fn().mockResolvedValue({ status: 'completed', value: selection }),
    ...overrides,
  }
  render(<WorkspaceImportDialog {...props} />)
  return props
}

describe('WorkspaceTransferDialogs', () => {
  it('uses a file-first import and commits a named new workspace', async () => {
    const props = renderImport()
    const dialog = screen.getByRole('dialog', { name: 'Import a workspace' })

    expect(within(dialog).queryByLabelText('Passphrase')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose Workspace File' }))
    expect(await within(dialog).findByText(selection.fileName)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Passphrase'), {
      target: { value: 'correct-horse-battery-staple' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock and Review' }))

    expect(await within(dialog).findByLabelText('Workspace name')).toHaveValue('QA Workspace')
    fireEvent.change(within(dialog).getByLabelText('Workspace name'), {
      target: { value: 'QA Imported' },
    })
    fireEvent.click(within(dialog).getByLabelText(/Import 2 included passwords/))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create and Import' }))

    await waitFor(() => {
      expect(props.onCommit).toHaveBeenCalledWith({
        selectionId: selection.selectionId,
        workspaceRevision: 7,
        importSecrets: true,
        importAsNew: true,
        workspaceName: 'QA Imported',
      })
    })
    expect(props.onCompleted).toHaveBeenCalledWith('QA Imported', undefined)
  })

  it('keeps the selected file after a wrong passphrase and allows retry', async () => {
    const onPreview = vi
      .fn()
      .mockResolvedValueOnce({ status: 'failed', message: 'The passphrase is incorrect.' })
      .mockResolvedValueOnce({ status: 'completed', value: preview })
    const props = renderImport({ onPreview })
    const dialog = screen.getByRole('dialog', { name: 'Import a workspace' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose Workspace File' }))
    const input = await within(dialog).findByLabelText('Passphrase')
    fireEvent.change(input, { target: { value: 'wrong-passphrase' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock and Review' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('incorrect')

    fireEvent.change(input, { target: { value: 'correct-horse-battery-staple' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock and Review' }))
    expect(await within(dialog).findByLabelText('Workspace name')).toBeInTheDocument()
    expect(props.onSelectFile).toHaveBeenCalledOnce()
    expect(onPreview).toHaveBeenCalledTimes(2)
  })

  it('makes replacing the current workspace an explicit destructive choice', async () => {
    const props = renderImport()
    const dialog = screen.getByRole('dialog', { name: 'Import a workspace' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose Workspace File' }))
    fireEvent.change(await within(dialog).findByLabelText('Passphrase'), {
      target: { value: 'correct-horse-battery-staple' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock and Review' }))
    await within(dialog).findByLabelText('Workspace name')

    fireEvent.click(within(dialog).getByLabelText(/Replace Current Workspace/))
    expect(within(dialog).getByText(/creating a recovery copy/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace Current Workspace' }))

    await waitFor(() => {
      expect(props.onCommit).toHaveBeenCalledWith({
        selectionId: selection.selectionId,
        workspaceRevision: 7,
        importSecrets: false,
        importAsNew: false,
        workspaceName: undefined,
      })
    })
  })

  it('keeps export open when the save picker is canceled', async () => {
    const onExport = vi.fn().mockResolvedValue({ status: 'canceled' })
    render(
      <WorkspaceExportDialog
        canIncludeSecrets
        workspaceName="QA Workspace"
        onClose={vi.fn()}
        onCompleted={vi.fn()}
        onExport={onExport}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Export QA Workspace' })
    fireEvent.change(within(dialog).getByLabelText('Passphrase'), {
      target: { value: 'correct-horse-battery-staple' },
    })
    fireEvent.change(within(dialog).getByLabelText('Confirm passphrase'), {
      target: { value: 'correct-horse-battery-staple' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose Location and Export' }))

    expect(await within(dialog).findByText(/No file was saved/)).toBeInTheDocument()
    expect(onExport).toHaveBeenCalledWith('correct-horse-battery-staple', false)
  })

  it('traps focus and cancels the staged selection on Escape', async () => {
    const props = renderImport()
    const dialog = screen.getByRole('dialog', { name: 'Import a workspace' })
    const choose = within(dialog).getByRole('button', { name: 'Choose Workspace File' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })

    cancel.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(choose).toHaveFocus()

    fireEvent.click(choose)
    await within(dialog).findByText(selection.fileName)
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(props.onCancelSelection).toHaveBeenCalledWith(selection.selectionId)
      expect(props.onClose).toHaveBeenCalledOnce()
    })
  })
})
