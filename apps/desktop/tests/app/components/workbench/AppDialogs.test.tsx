import { fireEvent, render, screen } from '@testing-library/react'
import type { EnvironmentProfile, LibraryNode } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { DeleteEnvironmentDialog, DeleteLibraryNodeDialog } from '../../../../src/app/components/workbench/AppDialogs'

describe('AppDialogs delete confirmations', () => {
  it('confirms folder deletion with descendant impact before calling delete', () => {
    const onConfirm = vi.fn()

    render(
      <DeleteLibraryNodeDialog
        node={folderNode}
        descendantCount={3}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Delete folder Reports?' })).toBeInTheDocument()
    expect(screen.getByText(/deletes the folder and 3 items inside it/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Folder' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('confirms script deletion before calling delete', () => {
    const onConfirm = vi.fn()

    render(
      <DeleteLibraryNodeDialog
        node={{ ...scriptNode, kind: 'script' }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Delete Cleanup script?' })).toBeInTheDocument()
    expect(screen.getByText(/removes the script from the workspace Library/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Script' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('confirms environment deletion and explains fallback behavior', () => {
    const onConfirm = vi.fn()

    render(
      <DeleteEnvironmentDialog
        environment={environment}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(
      screen.getByRole('dialog', { name: 'Delete environment Production?' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/will continue with No environment/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Environment' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

const folderNode: LibraryNode = {
  id: 'folder-reports',
  kind: 'folder',
  name: 'Reports',
  tags: [],
  createdAt: '2026-05-19T00:00:00.000Z',
  updatedAt: '2026-05-19T00:00:00.000Z',
}

const scriptNode: LibraryNode = {
  id: 'script-cleanup',
  kind: 'script',
  name: 'Cleanup script',
  tags: [],
  createdAt: '2026-05-19T00:00:00.000Z',
  updatedAt: '2026-05-19T00:00:00.000Z',
  queryText: 'print("cleanup")',
  language: 'text',
}

const environment: EnvironmentProfile = {
  id: 'env-prod',
  label: 'Production',
  color: '#e06c75',
  risk: 'critical',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: true,
  safeMode: true,
  exportable: false,
  createdAt: '2026-05-19T00:00:00.000Z',
  updatedAt: '2026-05-19T00:00:00.000Z',
}
