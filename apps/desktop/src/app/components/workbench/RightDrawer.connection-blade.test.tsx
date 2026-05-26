import { fireEvent, render, screen } from '@testing-library/react'
import type { ConnectionProfile, EnvironmentProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionBlade } from './RightDrawer.connection-blade'

describe('ConnectionBlade', () => {
  it('keeps typed credentials for testing but clears them after save and close actions', () => {
    const onClose = vi.fn()
    const onSaveConnection = vi.fn()
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={connection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={onClose}
        onSaveConnection={onSaveConnection}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    const credentialInput = screen.getByLabelText('Password / Credential')

    fireEvent.change(credentialInput, { target: { value: 'do-not-keep-me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: connection.id }),
      environment.id,
      'do-not-keep-me',
    )
    expect(credentialInput).toHaveValue('do-not-keep-me')

    fireEvent.change(credentialInput, { target: { value: 'do-not-keep-me-again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    expect(onSaveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: connection.id }),
      'do-not-keep-me-again',
    )
    expect(credentialInput).toHaveValue('')

    fireEvent.change(credentialInput, { target: { value: 'close-clears-too' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }))
    expect(onClose).toHaveBeenCalled()
    expect(credentialInput).toHaveValue('')
  })

  it('keeps stored credentials write-only when editing an existing connection', () => {
    render(
      <ConnectionBlade
        activeConnection={connectionWithStoredSecret}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn()}
        onTestConnection={vi.fn()}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    const credentialInput = screen.getByLabelText('Password / Credential')

    expect(credentialInput).toHaveValue('')
    expect(credentialInput).toHaveAttribute('placeholder', 'Stored credential')
  })
})

const environment: EnvironmentProfile = {
  id: 'env-local',
  label: 'Local',
  color: '#5dd6b0',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  variableDefinitions: [],
  requiresConfirmation: false,
  safeMode: false,
  exportable: true,
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const connection: ConnectionProfile = {
  id: 'conn-postgres',
  name: 'PostgreSQL',
  engine: 'postgresql',
  family: 'sql',
  host: 'localhost',
  port: 5432,
  database: 'app',
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'PG',
  auth: {
    username: 'app',
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const connectionWithStoredSecret: ConnectionProfile = {
  ...connection,
  auth: {
    ...connection.auth,
    secretRef: {
      id: 'secret-connection-password',
      provider: 'os-keyring',
      service: 'datapadplusplus',
      account: 'conn-postgres',
      label: 'PostgreSQL credential',
    },
  },
}
