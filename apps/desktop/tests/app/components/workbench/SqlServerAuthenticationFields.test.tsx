import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { ConnectionProfile, SqlServerAuthStatus } from '@datapadplusplus/shared-types'
import { validateConnectionEditor } from '@datapadplusplus/shared-types'
import { SqlServerAuthenticationFields } from '../../../../src/app/components/workbench/datastores/sqlserver/SqlServerAuthenticationFields'
import { ConnectionEditorDialog } from '../../../../src/app/components/workbench/ConnectionEditorDialog'
import { createConnectionProfile } from '../../../../src/app/state/app-state-factories'
import { clientConnections } from '../../../../src/services/runtime/client-connections'
import { isTauriRuntime } from '../../../../src/services/runtime/desktop-bridge'

vi.mock('../../../../src/services/runtime/desktop-bridge', () => ({ isTauriRuntime: vi.fn(() => true), invokeDesktop: vi.fn() }))
const signedOut: SqlServerAuthStatus = { state: 'signed-out', remembered: false, windowsAvailable: true, windowsAccount: 'EXAMPLE\\tester' }
const profile = (): ConnectionProfile => ({ ...createConnectionProfile(''), engine: 'sqlserver', family: 'sql', connectionMode: 'native', environmentIds: ['test-env'],
  sqlServerOptions: { authenticationMode: 'azure-ad-interactive', azureTenantId: '11111111-1111-1111-1111-111111111111', azureClientId: '22222222-2222-2222-2222-222222222222' } })
afterEach(() => { vi.restoreAllMocks(); vi.mocked(isTauriRuntime).mockReturnValue(true) })

describe('SQL Server authentication', () => {
  it('retains input focus while editing tenant and application identifiers', async () => {
    const call = vi.spyOn(clientConnections, 'sqlServerAuthentication').mockResolvedValue(signedOut)
    function Form() {
      const [connection, setConnection] = useState({ ...profile(), sqlServerOptions: { authenticationMode: 'azure-ad-interactive' as const, azureTenantId: '', azureClientId: '' } })
      return <SqlServerAuthenticationFields profile={connection} workspaceId="workspace-unit" workspaceRevision={3} onChange={(path, value) => setConnection(previous => ({ ...previous, sqlServerOptions: { ...previous.sqlServerOptions, [path.split('.')[1]]: value } }))} />
    }
    render(<Form />)
    const tenant = screen.getByRole('textbox', { name: 'Organisation tenant ID' })
    const client = screen.getByRole('textbox', { name: 'Application client ID' })
    tenant.focus()
    for (let length = 1; length <= 36; length++) {
      fireEvent.change(tenant, { target: { value: '11111111-1111-1111-1111-111111111111'.slice(0, length) } })
      expect(tenant).toHaveFocus()
    }
    expect(tenant).toHaveFocus()
    expect(tenant).toHaveValue('11111111-1111-1111-1111-111111111111')
    client.focus()
    for (let length = 1; length <= 36; length++) {
      fireEvent.change(client, { target: { value: '22222222-2222-2222-2222-222222222222'.slice(0, length) } })
      expect(client).toHaveFocus()
    }
    expect(client).toHaveFocus()
    await waitFor(() => expect(call).toHaveBeenCalledOnce())
    expect(call.mock.calls[0][0].workspaceId).toBe('workspace-unit')
  })

  it('probes status without interactive authentication and defaults to session-only', async () => {
    const call = vi.spyOn(clientConnections, 'sqlServerAuthentication').mockResolvedValue(signedOut)
    render(<SqlServerAuthenticationFields profile={profile()} workspaceRevision={3} onChange={vi.fn()} />)
    await waitFor(() => expect(call).toHaveBeenCalledOnce())
    expect(call.mock.calls[0][1]).toBe('status')
    expect(screen.getByRole('checkbox', { name: /Remember/ })).not.toBeChecked()
    expect(screen.getByText(/You can save this profile without signing in/)).toBeInTheDocument()
  })

  it('separates signed-in account from database health and supports sign-out', async () => {
    const call = vi.spyOn(clientConnections, 'sqlServerAuthentication').mockImplementation(async (_, operation) =>
      operation === 'sign-in' ? { ...signedOut, state: 'signed-in', account: 'person@example.test' } : signedOut)
    render(<SqlServerAuthenticationFields profile={profile()} workspaceRevision={3} onChange={vi.fn()} />)
    await waitFor(() => expect(call).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/does not verify database access/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change account' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.queryByText(/person@example.test/)).not.toBeInTheDocument())
    expect(call.mock.calls.map(([, op]) => op)).toEqual(['status', 'sign-in', 'sign-out'])
  })

  it('cancels pending sign-in and ignores a late response', async () => {
    let finish!: (status: SqlServerAuthStatus) => void
    const call = vi.spyOn(clientConnections, 'sqlServerAuthentication').mockImplementation(async (_, operation) =>
      operation === 'sign-in' ? new Promise(resolve => { finish = resolve }) : signedOut)
    render(<SqlServerAuthenticationFields profile={profile()} workspaceRevision={3} onChange={vi.fn()} />)
    await waitFor(() => expect(call).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }))
    await act(async () => finish({ ...signedOut, state: 'signed-in', account: 'stale@example.test' }))
    expect(screen.queryByText(/stale@example.test/)).not.toBeInTheDocument()
    expect(call.mock.calls.some(([, operation]) => operation === 'cancel')).toBe(true)
  })

  it('cancels and clears account state when the environment changes', async () => {
    const call = vi.spyOn(clientConnections, 'sqlServerAuthentication').mockImplementation(async (_, operation) =>
      operation === 'sign-in' ? new Promise(() => undefined) : signedOut)
    const connection = profile()
    const view = render(<SqlServerAuthenticationFields profile={connection} workspaceRevision={3} onChange={vi.fn()} />)
    await waitFor(() => expect(call).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    view.rerender(<SqlServerAuthenticationFields profile={{ ...connection, environmentIds: ['other-env'] }} workspaceRevision={3} onChange={vi.fn()} />)
    await waitFor(() => expect(call.mock.calls.some(([request, operation]) => operation === 'cancel' && request.environmentId === 'test-env')).toBe(true))
    expect(call.mock.calls.at(-1)?.[0].environmentId).toBe('other-env')
  })

  it('disables native sign-in in browser preview', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false)
    vi.spyOn(clientConnections, 'sqlServerAuthentication').mockResolvedValue({ ...signedOut, state: 'unavailable' })
    render(<SqlServerAuthenticationFields profile={profile()} workspaceRevision={3} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    expect(screen.getByText(/unavailable in browser preview/)).toBeInTheDocument()
  })

  it('remembers only after an explicit opt-in and displays incomplete secure-cache cleanup', async () => {
    const call = vi.spyOn(clientConnections, 'sqlServerAuthentication').mockImplementation(async (request, operation) =>
      operation === 'sign-in' ? { ...signedOut, state: 'signed-in', remembered: request.remember ?? false, warning: 'The old encrypted cache could not be removed.' } : signedOut)
    render(<SqlServerAuthenticationFields profile={profile()} workspaceId="workspace-unit" workspaceRevision={3} onChange={vi.fn()} />)
    await waitFor(() => expect(call).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('checkbox', { name: /Remember/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The old encrypted cache could not be removed.')
    expect(call.mock.calls.at(-1)?.[0]).toMatchObject({ workspaceId: 'workspace-unit', remember: true, environmentId: 'test-env' })
  })

  it.each(['windows', 'azure-ad-interactive'] as const)('hides password fields for %s in the actual connection dialog', async authenticationMode => {
    vi.spyOn(clientConnections, 'sqlServerAuthentication').mockResolvedValue(signedOut)
    render(<ConnectionEditorDialog activeConnection={{ ...profile(), sqlServerOptions: { ...profile().sqlServerOptions, authenticationMode } }}
      environments={[]} workspaceRevision={3} isNew={false} onClose={vi.fn()} onSaveConnection={vi.fn(async () => true)}
      onTestConnection={vi.fn(async () => undefined)} onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))} onCreateLocalDatabase={vi.fn(async () => undefined)} />)
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    if (authenticationMode === 'windows') expect(await screen.findByText(/EXAMPLE\\tester/)).toBeInTheDocument()
  })

  it('validates organisation identifiers and strict TLS in both connection methods', () => {
    for (const connectionMode of ['native', 'connection-string'] as const) {
      const connection = { ...profile(), connectionMode, sqlServerOptions: { ...profile().sqlServerOptions, azureTenantId: 'common', encryptConnection: false } }
      expect(validateConnectionEditor(connection).map(error => error.path)).toEqual(expect.arrayContaining(['sqlServerOptions.azureTenantId', 'sqlServerOptions.encryptConnection']))
    }
  })
})
