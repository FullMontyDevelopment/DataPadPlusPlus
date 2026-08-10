import { render, screen } from '@testing-library/react'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentContextMenu } from '../../../../../src/app/components/workbench/results/document-context-menu'
import { documentResultBehaviorForConnection } from '../../../../../src/app/components/workbench/results/datastore-result-behaviors'
import type { DocumentGridRow } from '../../../../../src/app/components/workbench/results/document-grid-model'

describe('DocumentContextMenu', () => {
  it('offers Add Field for object/root rows and calls it', () => {
    const onAddField = vi.fn()
    renderMenu(rootRow(), connection(), { onAddField })
    screen.getByRole('menuitem', { name: 'Add Field' }).click()
    expect(onAddField).toHaveBeenCalledOnce()
    expect(screen.getByRole('menuitem', { name: 'Edit Raw JSON' })).toBeEnabled()
  })

  it('hides Add Field for arrays and array elements', () => {
    const { rerender } = renderMenu(
      { ...rootRow(), path: ['items'], parentPath: [], type: 'array', label: 'items' },
      connection(),
    )
    expect(screen.queryByRole('menuitem', { name: 'Add Field' })).toBeNull()

    rerender(menu(
      { ...rootRow(), path: ['items', 0], parentPath: ['items'], type: 'string', label: '[0]' },
      connection(),
    ))
    expect(screen.queryByRole('menuitem', { name: 'Add Field' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Remove Field' })).toBeDisabled()
  })

  it('shows guarded actions disabled with a read-only reason', () => {
    renderMenu(
      { ...rootRow(), path: ['name'], parentPath: [], type: 'string', label: 'name' },
      { ...connection(), readOnly: true },
      { editUnavailableReason: 'This connection is read-only.' },
    )
    expect(screen.getByRole('menuitem', { name: 'Edit Value' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Remove Field' })).toHaveAttribute(
      'title',
      'This connection is read-only.',
    )
  })
})

function renderMenu(
  row: DocumentGridRow,
  profile: ConnectionProfile,
  overrides: Partial<ComponentProps<typeof DocumentContextMenu>> = {},
) {
  return render(menu(row, profile, overrides))
}

function menu(
  row: DocumentGridRow,
  profile: ConnectionProfile,
  overrides: Partial<ComponentProps<typeof DocumentContextMenu>> = {},
) {
  const noop = vi.fn()
  return (
    <DocumentContextMenu
      behavior={documentResultBehaviorForConnection(profile)}
      row={row}
      x={0}
      y={0}
      onAddField={noop}
      onClose={noop}
      onCopyDocument={noop}
      onCopyPath={noop}
      onCopyValue={noop}
      onDelete={noop}
      onDeleteDocument={noop}
      onEditRawJson={noop}
      onEditValue={noop}
      onRename={noop}
      onViewRawJson={noop}
      {...overrides}
    />
  )
}

function rootRow(): DocumentGridRow {
  return {
    id: 'document:0:[]',
    depth: 0,
    label: 'one',
    fieldPath: '_id',
    type: 'object',
    valueLabel: '{2 field(s)}',
    value: { _id: 'one', name: 'Ada' },
    expandable: true,
    lazy: false,
    documentIndex: 0,
    parentPath: [],
    path: [],
  }
}

function connection(): ConnectionProfile {
  return {
    id: 'mongo',
    name: 'MongoDB',
    engine: 'mongodb',
    family: 'document',
    host: 'localhost',
    port: 27017,
    environmentIds: ['env'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'mongodb',
    auth: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}
