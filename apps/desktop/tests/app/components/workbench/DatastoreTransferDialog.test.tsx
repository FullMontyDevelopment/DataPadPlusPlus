import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionProfile, EnvironmentProfile, OperationPlan } from '@datapadplusplus/shared-types'
import { DatastoreTransferDialog } from '../../../../src/app/components/workbench/DatastoreTransferDialog'
import { datastoreTransferManifest } from '../../../../src/services/runtime/datastore-transfer-manifests'
import { desktopClient } from '../../../../src/services/runtime/client'

const connection = {
  id: 'connection-1',
  name: 'Local SQLite',
  engine: 'sqlite',
} as ConnectionProfile

const environment = {
  id: 'environment-1',
  label: 'Development',
} as EnvironmentProfile

const plan: OperationPlan = {
  operationId: 'sqlite.table.export',
  engine: 'sqlite',
  summary: 'Export main.customers.',
  generatedRequest: 'select * from main.customers',
  requestLanguage: 'sql',
  destructive: false,
  requiredPermissions: ['read table'],
  confirmationText: 'main.customers',
  warnings: [],
}

afterEach(() => vi.restoreAllMocks())

describe('DatastoreTransferDialog', () => {
  it('requires a desktop selection and explicit validation before starting', async () => {
    const selectFile = vi.spyOn(desktopClient, 'selectDatastoreTransferFile').mockResolvedValue({
      selectionId: 'selection-1',
      fileName: 'customers.csv',
      destinationKind: 'local-file',
      expiresAt: '2026-09-01T00:00:00Z',
    })
    const onPlan = vi.fn().mockResolvedValue(plan)
    const onStart = vi.fn()
    render(
      <DatastoreTransferDialog
        connection={connection}
        environment={environment}
        manifest={datastoreTransferManifest('sqlite')}
        request={{
          connectionId: connection.id,
          environmentId: environment.id,
          operationId: 'sqlite.data.import-export',
          objectName: 'main.customers',
          parameters: { mode: 'export' },
        }}
        runtime="tauri"
        onClose={vi.fn()}
        onPlan={onPlan}
        onStart={onStart}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Transfer main.customers' })
    expect(within(dialog).getByRole('button', { name: 'Start Export' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose Destination' }))
    expect(await within(dialog).findByText('customers.csv')).toBeInTheDocument()
    expect(selectFile).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'sqlite.table.export',
      connectionId: connection.id,
      environmentId: environment.id,
      action: 'export',
      formatId: 'csv',
    }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Validate Transfer' }))
    expect(await within(dialog).findByText(/Validation completed/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start Export' }))

    expect(onPlan).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'sqlite.table.export',
      parameters: expect.objectContaining({
        conflictPolicy: 'fail',
        transferSelectionId: 'selection-1',
      }),
    }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'sqlite.table.export',
      confirmationText: 'main.customers',
    }))
  })

  it('shows native backup limitations instead of offering a pseudo-backup', async () => {
    render(
      <DatastoreTransferDialog
        connection={{ ...connection, engine: 'postgresql' }}
        environment={environment}
        manifest={datastoreTransferManifest('postgresql')}
        request={{
          connectionId: connection.id,
          environmentId: environment.id,
          operationId: 'postgresql.data.import-export',
          objectName: 'public.customers',
          parameters: { mode: 'export' },
        }}
        runtime="tauri"
        onClose={vi.fn()}
        onPlan={vi.fn()}
        onStart={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Backup unavailable' }))
    expect(await screen.findByText(/vendor tooling or storage-backend access/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Validate Transfer' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start Backup' })).toBeDisabled()
  })

  it('keeps browser-mode local execution disabled while allowing an example plan', async () => {
    const onPlan = vi.fn().mockResolvedValue(plan)
    render(
      <DatastoreTransferDialog
        connection={connection}
        environment={environment}
        manifest={datastoreTransferManifest('sqlite')}
        request={{ connectionId: connection.id, environmentId: environment.id, operationId: 'sqlite.table.export', objectName: 'main.customers' }}
        runtime="browser"
        onClose={vi.fn()}
        onPlan={onPlan}
        onStart={vi.fn()}
      />,
    )

    expect(screen.getByText(/available in the desktop application/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose Destination' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Preview Plan' }))
    expect(await screen.findByText(/Validation completed/)).toBeInTheDocument()
    expect(onPlan).toHaveBeenCalledWith(expect.objectContaining({
      parameters: expect.objectContaining({ targetPath: '<selected-local-file>.csv' }),
    }))
    expect(screen.getByRole('button', { name: 'Start Export' })).toBeDisabled()
  })

  it('requires and serializes validated datastore-specific options', async () => {
    vi.spyOn(desktopClient, 'selectDatastoreTransferFile').mockResolvedValue({
      selectionId: 'selection-memcached',
      fileName: 'value.bin',
      destinationKind: 'local-file',
      expiresAt: '2026-09-01T00:00:00Z',
    })
    const onPlan = vi.fn().mockResolvedValue({ ...plan, operationId: 'memcached.data.import-export', engine: 'memcached' })
    render(
      <DatastoreTransferDialog
        connection={{ ...connection, engine: 'memcached', name: 'Local Memcached' }}
        environment={environment}
        manifest={datastoreTransferManifest('memcached')}
        request={{
          connectionId: connection.id,
          environmentId: environment.id,
          operationId: 'memcached.data.import-export',
          objectName: 'cache:user:42',
          parameters: { mode: 'import' },
        }}
        runtime="tauri"
        onClose={vi.fn()}
        onPlan={onPlan}
        onStart={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose Source' }))
    expect(await screen.findByText('value.bin')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Validate Transfer' })).toBeDisabled()

    fireEvent.change(screen.getByRole('spinbutton', { name: /Expiry in seconds/ }), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate Transfer' }))
    expect(await screen.findByText(/Validation completed/)).toBeInTheDocument()
    expect(onPlan).toHaveBeenCalledWith(expect.objectContaining({
      parameters: expect.objectContaining({ flags: 0, expirySeconds: 300 }),
    }))
  })
})
