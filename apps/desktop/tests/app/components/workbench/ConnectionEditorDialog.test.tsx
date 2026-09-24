import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONNECTION_EDITOR_CATALOG, DATASTORE_ENGINES, setConnectionField, validateConnectionEditor } from '@datapadplusplus/shared-types'
import { ConnectionEditorDialog, type ConnectionEditorDialogProps } from '../../../../src/app/components/workbench/ConnectionEditorDialog'
import { ConnectionSecretField } from '../../../../src/app/components/workbench/ConnectionSecretField'
import { createConnectionProfile } from '../../../../src/app/state/app-state-factories'
import { desktopClient } from '../../../../src/services/runtime/client'

const profile = () => ({ ...createConnectionProfile(''), environmentIds: [], updatedAt: '2026-09-21T12:00:00Z' })
const storedProfile = () => ({ ...profile(), auth: { secretRef: {
  id: 'secret', service: 'DataPad++', account: 'connection', provider: 'os-keyring' as const, label: 'Password',
} } })
function setup(overrides: Partial<ConnectionEditorDialogProps> = {}) {
  const props: ConnectionEditorDialogProps = {
    activeConnection: profile(), environments: [], workspaceRevision: 1, isNew: true,
    onClose: vi.fn(), onSaveConnection: vi.fn(async () => true),
    onTestConnection: vi.fn(async () => undefined),
    onPickLocalDatabaseFile: vi.fn(async () => ({ canceled: true })),
    onCreateLocalDatabase: vi.fn(async () => undefined), ...overrides,
  }
  render(<ConnectionEditorDialog {...props} />)
  return props
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('Connection editor', () => {
  it.each(['native', 'connection-string'] as const)('omits redundant save helper text in %s mode', connectionMode => {
    setup({ activeConnection: { ...profile(), connectionMode } })
    const input = screen.getByLabelText(connectionMode === 'native' ? 'Password' : 'Complete connection string')
    expect(screen.queryByText('Saved securely with the connection.')).not.toBeInTheDocument()
    expect(screen.queryByText('Stored exactly as entered when you save the connection.')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(input.closest('.connection-secret')?.querySelector('.connection-secret-actions')).toBeNull()
  })
  it('retains the saved-secret status and reveal control', () => {
    setup({ activeConnection: storedProfile(), isNew: false })
    fireEvent.click(screen.getByText('Authentication'))
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Stored in credential vault. Leave blank to keep it.')
    expect(screen.getByRole('button', { name: 'Reveal…' })).toBeInTheDocument()
  })
  it.each(DATASTORE_ENGINES)('exposes only supported connection methods as tabs for %s', engine => {
    const capability = CONNECTION_EDITOR_CATALOG[engine]
    setup({ activeConnection: { ...profile(), engine, connectionMode: capability.methods[0] } })
    const tabs = within(screen.getByRole('tablist', { name: 'Connection method' })).getAllByRole('tab')
    expect(tabs).toHaveLength(capability.methods.length)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[0].id)
    expect(screen.queryByRole('combobox', { name: 'Connection method' })).not.toBeInTheDocument()
    for (const tab of tabs.slice(1)) {
      expect(tab).toHaveAttribute('aria-selected', 'false')
      expect(tab).toHaveAttribute('tabindex', '-1')
    }
  })
  it('does not mark a draft dirty when its already-selected method is activated', () => {
    const props = setup()
    const selected = screen.getByRole('tab', { name: 'Connection fields' })
    fireEvent.click(selected)
    fireEvent.keyDown(selected, { key: 'Home' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alertdialog', { name: 'Discard connection changes?' })).not.toBeInTheDocument()
  })
  it('supports arrow, Home, and End navigation and preserves drafts across method tabs', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'draft.example.test' } })
    const fields = screen.getByRole('tab', { name: 'Connection fields' })
    const uri = screen.getByRole('tab', { name: 'Connection string' })
    fields.focus()
    fireEvent.keyDown(fields, { key: 'ArrowRight' })
    expect(uri).toHaveFocus()
    expect(uri).toHaveAttribute('aria-selected', 'true')
    fireEvent.change(screen.getByLabelText('Complete connection string'), { target: { value: 'postgres://fixture.test/db' } })
    fireEvent.keyDown(uri, { key: 'ArrowRight' })
    expect(fields).toHaveFocus()
    expect(screen.getByLabelText('Host')).toHaveValue('draft.example.test')
    fireEvent.keyDown(fields, { key: 'End' })
    expect(screen.getByLabelText('Complete connection string')).toHaveValue('postgres://fixture.test/db')
    fireEvent.keyDown(uri, { key: 'Home' })
    expect(fields).toHaveFocus()
    fireEvent.keyDown(fields, { key: 'ArrowLeft' })
    expect(uri).toHaveFocus()
  })
  it('prevents method switching while saving', async () => {
    let finish!: (saved: boolean) => void
    const props = setup({ onSaveConnection: vi.fn(() => new Promise(done => { finish = done })) })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    const uri = screen.getByRole('tab', { name: 'Connection string' })
    expect(uri).toBeDisabled()
    fireEvent.keyDown(uri, { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Connection fields' })).toHaveAttribute('aria-selected', 'true')
    await act(async () => finish(true))
    expect(props.onSaveConnection).toHaveBeenCalledOnce()
  })
  it.each([false, true])('saves typed passwords with the connection without another save action (existing: %s)', existing => {
    const props = setup({ activeConnection: existing ? storedProfile() : profile(), isNew: !existing })
    fireEvent.click(screen.getByText('Authentication'))
    const password = screen.getByLabelText('Password')
    expect(password).not.toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: /^(Enter value|Replace|Save password|Save secret)$/ })).not.toBeInTheDocument()
    fireEvent.change(password, { target: { value: ' exact fixture secret ' } })
    expect(props.onSaveConnection).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    expect(props.onSaveConnection).toHaveBeenCalledWith(expect.anything(), undefined, [
      { slot: 'auth.secretRef', action: 'replace', value: ' exact fixture secret ' },
    ])
  })
  it('preserves a stored password when its replacement is cleared', () => {
    const props = setup({ activeConnection: storedProfile(), isNew: false })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'draft' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    expect(props.onSaveConnection).toHaveBeenCalledWith(expect.anything(), undefined, [])
  })
  it('saves explicit credential removal only with the connection and allows undo', () => {
    const props = setup({ activeConnection: storedProfile(), isNew: false })
    fireEvent.click(screen.getByText('Authentication'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(props.onSaveConnection).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Password')).toHaveAttribute('placeholder', 'Removed when you save')
    fireEvent.click(screen.getByRole('button', { name: 'Undo change' }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('placeholder', '••••••••')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    expect(props.onSaveConnection).toHaveBeenCalledWith(expect.anything(), undefined, [{ slot: 'auth.secretRef', action: 'remove' }])
  })
  it('keeps saved connection strings unchanged when left blank and saves replacements exactly', async () => {
    const props = setup({ activeConnection: { ...profile(), connectionMode: 'connection-string', auth: { connectionStringSecretRef: storedProfile().auth.secretRef } }, isNew: false })
    expect(screen.getByLabelText('Complete connection string')).toHaveAttribute('placeholder', '••••••••')
    expect(screen.getByRole('button', { name: 'Reveal…' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Connection' })).toBeEnabled())
    expect(props.onSaveConnection).toHaveBeenLastCalledWith(expect.anything(), undefined, [])
    fireEvent.change(screen.getByLabelText('Complete connection string'), { target: { value: 'exact opaque string\n ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    expect(props.onSaveConnection).toHaveBeenLastCalledWith(expect.anything(), undefined, [{ slot: 'auth.connectionStringSecretRef', action: 'replace', value: 'exact opaque string\n ' }])
  })
  it('saves secondary secret slots through the same connection action', () => {
    const props = setup({ activeConnection: { ...profile(), engine: 'redis', family: 'keyvalue', connectionMode: 'native' } })
    const secretField = CONNECTION_EDITOR_CATALOG.redis.fields.find(item => item.kind === 'secret')!
    fireEvent.change(screen.getByLabelText(secretField.label), { target: { value: 'sentinel-fixture' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    expect(props.onSaveConnection).toHaveBeenCalledWith(expect.anything(), undefined, [{ slot: secretField.path, action: 'replace', value: 'sentinel-fixture' }])
  })
  it('can show an unsaved password but remasks it on blur without discarding the draft', () => {
    setup()
    fireEvent.click(screen.getByText('Authentication'))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fixture-draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
    fireEvent.blur(window)
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Password')).toHaveValue('fixture-draft')
  })
  it('preserves typed credentials when saving fails', async () => {
    setup({ onSaveConnection: vi.fn(async () => false) })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fixture-draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    await screen.findByText(/connection was not saved/)
    expect(screen.getByLabelText('Password')).toHaveValue('fixture-draft')
  })
  it('keeps MongoDB driver defaults absent and saves explicit native options', async () => {
    const props = setup({ activeConnection: { ...profile(), engine: 'mongodb', family: 'document', connectionMode: 'native', mongodbOptions: {} } })
    expect(screen.getByLabelText('Retry eligible writes')).toHaveValue('')
    expect(screen.getByLabelText('Connect timeout (ms)')).toHaveValue('')
    fireEvent.click(screen.getByText('Advanced'))
    fireEvent.change(screen.getByLabelText('Connect timeout (ms)'), { target: { value: '7500' } })
    fireEvent.change(screen.getByLabelText('Retry eligible writes'), { target: { value: 'false' } })
    fireEvent.change(screen.getByLabelText('Read preference'), { target: { value: 'secondaryPreferred' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    await waitFor(() => expect(props.onSaveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ mongodbOptions: { connectTimeoutMs: 7500, retryWrites: false, readPreference: 'secondaryPreferred' } }), undefined, [],
    ))
  })

  it('validates incompatible MongoDB options without coercing invalid drafts', () => {
    const base = { ...profile(), engine: 'mongodb' as const, connectionMode: 'native' as const }
    expect(validateConnectionEditor({ ...base, mongodbOptions: { directConnection: true, connectionScheme: 'mongodb+srv' } }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'mongodbOptions.directConnection' })]))
    expect(validateConnectionEditor({ ...base, mongodbOptions: { minPoolSize: 10, maxPoolSize: 2 } }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'mongodbOptions.minPoolSize' })]))
    expect(validateConnectionEditor({ ...base, mongodbOptions: { minPoolSize: 10, maxPoolSize: 0 } })).toEqual([])
    expect(validateConnectionEditor({ ...base, mongodbOptions: { tls: false, tlsCaFile: '/certs/ca.pem' } }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'mongodbOptions.tls' })]))
    expect(validateConnectionEditor({ ...base, connectionMode: 'connection-string', mongodbOptions: { minPoolSize: 10, maxPoolSize: 2 } })).toEqual([])
  })
  it('renders a portal dialog with secondary sections collapsed', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'Create connection' })
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(screen.getByText('Authentication').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('Advanced').closest('details')).not.toHaveAttribute('open')
  })
  it('cancels a clean draft without creating or saving anything', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onSaveConnection).not.toHaveBeenCalled()
    expect(props.onCreateLocalDatabase).not.toHaveBeenCalled()
  })
  it('asks before discarding a changed draft', () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Local analytics' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Local analytics')
  })
  it.each(['Cancel', 'Close connection editor', 'Escape'])('shows a viewport-level confirmation from %s', action => {
    const props = setup()
    const editor = screen.getByRole('dialog', { name: 'Create connection' })
    const scroll = editor.querySelector('.connection-editor-body')!
    scroll.scrollTop = 420
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved analytics' } })
    if (action === 'Escape') fireEvent.keyDown(document, { key: 'Escape' })
    else fireEvent.click(screen.getByRole('button', { name: action }))
    const confirmation = screen.getByRole('alertdialog', { name: 'Discard connection changes?' })
    expect(confirmation.parentElement?.parentElement).toBe(document.body)
    expect(scroll.contains(confirmation)).toBe(false)
    expect(editor).toHaveAttribute('inert')
    expect(editor).toHaveAttribute('aria-hidden', 'true')
    expect(confirmation).toHaveAccessibleDescription('Your changes have not been saved. Keep editing this connection, or discard the unsaved changes.')
    expect(within(confirmation).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(props.onSaveConnection).not.toHaveBeenCalled()
  })
  it.each(['Keep editing', 'Escape'])('returns to the same draft, focus, and scroll position with %s', action => {
    const props = setup()
    const input = screen.getByLabelText('Name')
    const editor = screen.getByRole('dialog', { name: 'Create connection' })
    const scroll = editor.querySelector('.connection-editor-body')!
    fireEvent.change(input, { target: { value: 'Unsaved analytics' } })
    input.focus()
    scroll.scrollTop = 420
    fireEvent.keyDown(input, { key: 'Escape' })
    if (action === 'Escape') fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    else fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(input).toHaveValue('Unsaved analytics')
    expect(input).toHaveFocus()
    expect(scroll.scrollTop).toBe(420)
    expect(editor).not.toHaveAttribute('inert')
    expect(editor).not.toHaveAttribute('aria-hidden')
    expect(props.onClose).not.toHaveBeenCalled()
    expect(props.onSaveConnection).not.toHaveBeenCalled()
  })
  it('keeps keyboard focus inside the confirmation until a choice is made', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved analytics' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const keep = screen.getByRole('button', { name: 'Keep editing' })
    const discard = screen.getByRole('button', { name: 'Discard changes' })
    fireEvent.keyDown(keep, { key: 'Tab', shiftKey: true })
    expect(discard).toHaveFocus()
    fireEvent.keyDown(discard, { key: 'Tab' })
    expect(keep).toHaveFocus()
  })
  it('does not discard when the confirmation backdrop is clicked', () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved analytics' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const confirmation = screen.getByRole('alertdialog')
    fireEvent.click(confirmation.parentElement!)
    expect(confirmation).toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()
  })
  it('discards only after the explicit destructive action and never saves the draft', () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved analytics' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onSaveConnection).not.toHaveBeenCalled()
  })
  it('does not open a discard confirmation while saving', async () => {
    let finish!: (saved: boolean) => void
    const props = setup({ onSaveConnection: vi.fn(() => new Promise(done => { finish = done })) })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Saving analytics' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(props.onClose).not.toHaveBeenCalled()
    await act(async () => finish(true))
  })
  it('saves profile changes without submitting display masks', async () => {
    const props = setup({ activeConnection: storedProfile(), isNew: false })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    await waitFor(() => expect(props.onSaveConnection).toHaveBeenCalledWith(expect.objectContaining({ connectionString: undefined }), undefined, []))
  })
  it('keeps invalid numeric drafts without attempting a test or save', () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    expect(screen.getByRole('alert')).toHaveTextContent('between 1 and 65535')
    expect(props.onSaveConnection).not.toHaveBeenCalled()
  })
  it('preserves partially typed ports and rejects them without coercion', () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '54x' } })
    expect(screen.getByLabelText('Port')).toHaveValue('54x')
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(props.onTestConnection).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Port')).toHaveValue('54x')
  })
  it('does not block connection strings on a hidden native port draft', async () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '54x' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(screen.getByLabelText('Complete connection string'), { target: { value: 'postgres://localhost/example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    await waitFor(() => expect(props.onSaveConnection).toHaveBeenCalledWith(expect.objectContaining({ port: undefined }), undefined, expect.any(Array)))
  })
  it('treats local creation choices as an unsaved draft and enables testing after changing method', () => {
    const props = setup({ activeConnection: { ...profile(), engine: 'sqlite', connectionMode: 'local-file' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create new database' }))
    fireEvent.change(screen.getByLabelText('Filename (.sqlite)'), { target: { value: 'draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled()
  })
  it('keeps the complete multiline connection string in the secret mutation only', async () => {
    const props = setup({ activeConnection: { ...profile(), connectionMode: 'connection-string' } })
    const value = 'mongodb://user:p%40ss@host1,host2/db?appName=DataPad++\n'
    fireEvent.change(screen.getByLabelText('Complete connection string'), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    await waitFor(() => expect(props.onSaveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: undefined }), undefined,
      [{ slot: 'auth.connectionStringSecretRef', action: 'replace', value }],
    ))
  })
  it('does not create local files merely by selecting a folder', async () => {
    const props = setup({
      activeConnection: { ...profile(), engine: 'sqlite', connectionMode: 'local-file' },
      onPickLocalDatabaseFile: vi.fn(async () => ({ canceled: false, path: 'C:/isolated' })),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create new database' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    await screen.findByText('C:/isolated')
    expect(props.onCreateLocalDatabase).not.toHaveBeenCalled()
    expect(props.onSaveConnection).not.toHaveBeenCalled()
  })
  it('does not recreate the file if saving its profile fails', async () => {
    const props = setup({
      activeConnection: { ...profile(), engine: 'sqlite', connectionMode: 'local-file' },
      onPickLocalDatabaseFile: vi.fn(async () => ({ canceled: false, path: 'C:/isolated' })),
      onCreateLocalDatabase: vi.fn(async () => ({ engine: 'sqlite', path: 'C:/isolated/database.sqlite', message: 'Created', warnings: [] })),
      onSaveConnection: vi.fn(async () => false),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create new database' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    await screen.findByText('C:/isolated')
    fireEvent.click(screen.getByRole('button', { name: 'Create Database and Save Connection' }))
    await screen.findByText(/database file was created, but the connection was not saved/)
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    await waitFor(() => expect(props.onSaveConnection).toHaveBeenCalledTimes(2))
    expect(props.onCreateLocalDatabase).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(/The created database file will remain on disk\./)
  })
  it('requires an explicit password choice when creating from an encrypted LiteDB profile', async () => {
    const props = setup({
      activeConnection: { ...storedProfile(), engine: 'litedb', connectionMode: 'local-file' }, isNew: false,
      onPickLocalDatabaseFile: vi.fn(async () => ({ canceled: false, path: 'C:/isolated' })),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create new database' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    await screen.findByText('C:/isolated')
    fireEvent.click(screen.getByRole('button', { name: 'Create Database and Save Connection' }))
    await screen.findByText(/explicitly enter its new password/)
    expect(props.onCreateLocalDatabase).not.toHaveBeenCalled()
    expect(props.onSaveConnection).not.toHaveBeenCalled()
  })
  it('keeps the created LiteDB file password fixed while retrying profile persistence', async () => {
    const props = setup({
      activeConnection: { ...profile(), engine: 'litedb', connectionMode: 'local-file' },
      onPickLocalDatabaseFile: vi.fn(async () => ({ canceled: false, path: 'C:/isolated' })),
      onCreateLocalDatabase: vi.fn(async () => ({ engine: 'litedb', path: 'C:/isolated/database.db', message: 'Created', warnings: [] })),
      onSaveConnection: vi.fn(async () => false),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create new database' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    await screen.findByText('C:/isolated')
    fireEvent.click(screen.getByText('Authentication'))
    fireEvent.change(screen.getByLabelText('Database password'), { target: { value: ' exact password ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Database and Save Connection' }))
    await screen.findByText(/database file was created, but the connection was not saved/)
    expect(screen.getByLabelText('Database password')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    await waitFor(() => expect(props.onSaveConnection).toHaveBeenCalledTimes(2))
    expect(props.onCreateLocalDatabase).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ password: ' exact password ' }))
  })
})

describe('Saved credential viewer', () => {
  it('does not let a delayed reveal overwrite a newly entered replacement', async () => {
    let resolve!: (value: { value: string }) => void
    vi.spyOn(desktopClient, 'revealConnectionSecret').mockReturnValue(new Promise(done => { resolve = done }))
    setup({ activeConnection: storedProfile(), isNew: false })
    fireEvent.click(screen.getByText('Authentication'))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal saved value' }))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'replacement' } })
    await act(async () => resolve({ value: 'old-value' }))
    expect(screen.getByLabelText('Password')).toHaveValue('replacement')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })
  it('reveals stored connection strings read-only and does not submit them as replacements', async () => {
    vi.spyOn(desktopClient, 'revealConnectionSecret').mockResolvedValue({ value: 'stored opaque string' })
    const props = setup({ activeConnection: { ...profile(), connectionMode: 'connection-string', auth: { connectionStringSecretRef: storedProfile().auth.secretRef } }, isNew: false })
    fireEvent.click(screen.getByRole('button', { name: 'Reveal…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal saved value' }))
    await waitFor(() => expect(screen.getByLabelText('Complete connection string')).toHaveValue('stored opaque string'))
    expect(screen.getByLabelText('Complete connection string')).toHaveAttribute('readonly')
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    expect(props.onSaveConnection).toHaveBeenCalledWith(expect.anything(), undefined, [])
  })
  it('does not transfer a reveal into another workspace revision', async () => {
    let resolve!: (value: { value: string }) => void
    vi.spyOn(desktopClient, 'revealConnectionSecret').mockReturnValue(new Promise(done => { resolve = done }))
    const profile = storedProfile()
    const { rerender } = render(<ConnectionSecretField profile={profile} revision={7} slot="auth.secretRef" label="Password" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reveal…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal saved value' }))
    rerender(<ConnectionSecretField profile={profile} revision={8} slot="auth.secretRef" label="Password" onChange={vi.fn()} />)
    await act(async () => resolve({ value: 'private-value' }))
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Password')).toHaveAttribute('placeholder', '••••••••')
    expect(screen.queryByRole('group', { name: 'Confirm credential reveal' })).not.toBeInTheDocument()
  })
  it('requires explicit confirmation, uses a scoped slot, and remasks on blur', async () => {
    const reveal = vi.spyOn(desktopClient, 'revealConnectionSecret').mockResolvedValue({ value: 'private-value' })
    const profile = storedProfile()
    render(<ConnectionSecretField profile={profile} revision={7} slot="auth.secretRef" label="Password" onChange={vi.fn()} />)
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Password')).toHaveAttribute('placeholder', '••••••••')
    fireEvent.click(screen.getByRole('button', { name: 'Reveal…' }))
    expect(reveal).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal saved value' }))
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue('private-value'))
    expect(reveal).toHaveBeenCalledWith({ connectionId: profile.id, expectedUpdatedAt: profile.updatedAt, workspaceRevision: 7, slot: 'auth.secretRef', confirmed: true })
    fireEvent.blur(window)
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })
  it('ignores a reveal response after the window loses focus', async () => {
    let resolve!: (value: { value: string }) => void
    vi.spyOn(desktopClient, 'revealConnectionSecret').mockReturnValue(new Promise(done => { resolve = done }))
    render(<ConnectionSecretField profile={storedProfile()} revision={7} slot="auth.secretRef" label="Password" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reveal…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal saved value' }))
    fireEvent.blur(window)
    await act(async () => resolve({ value: 'private-value' }))
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })
  it('remasks after thirty seconds', async () => {
    vi.useFakeTimers()
    vi.spyOn(desktopClient, 'revealConnectionSecret').mockResolvedValue({ value: 'private-value' })
    render(<ConnectionSecretField profile={storedProfile()} revision={7} slot="auth.secretRef" label="Password" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reveal…' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reveal saved value' })))
    expect(screen.getByLabelText('Password')).toHaveValue('private-value')
    act(() => vi.advanceTimersByTime(30_000))
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })
})

describe('Connection capability catalogue', () => {
  it('covers all 29 engines with explicit methods and unique field paths', () => {
    expect(Object.keys(CONNECTION_EDITOR_CATALOG).sort()).toEqual([...DATASTORE_ENGINES].sort())
    for (const engine of DATASTORE_ENGINES) {
      const capability = CONNECTION_EDITOR_CATALOG[engine]
      expect(capability.methods.length).toBeGreaterThan(0)
      expect(new Set(capability.fields.map(field => field.path)).size).toBe(capability.fields.length)
    }
  })
  it('rejects unsafe paths and does not mutate the source profile', () => {
    const original = profile()
    expect(() => setConnectionField(original, '__proto__.secret', 'bad')).toThrow()
    expect(() => setConnectionField(original, 'auth.secretRef', {})).toThrow()
    expect(() => setConnectionField(original, 'oracleOptions.sid', 'unrelated')).toThrow()
    expect(() => setConnectionField(original, 'unknown', 'bad')).toThrow()
    const changed = setConnectionField(original, 'auth.username', 'reader')
    expect(original.auth.username).toBeUndefined()
    expect(changed.auth.username).toBe('reader')
  })
  it('accepts SQLite negative cache budgets without accepting negative timeouts', () => {
    const sqlite = { ...profile(), engine: 'sqlite' as const, connectionMode: 'local-file' as const }
    expect(validateConnectionEditor(setConnectionField(sqlite, 'sqliteOptions.cacheSize', -2048))).toEqual([])
    expect(validateConnectionEditor(setConnectionField(sqlite, 'sqliteOptions.busyTimeoutMs', -1))).not.toEqual([])
  })
  it('does not silently turn invalid timeout drafts into zero', () => {
    const invalid = setConnectionField(profile(), 'postgresOptions.connectTimeoutMs', '12e')
    expect(validateConnectionEditor(invalid)).toContainEqual({ path: 'postgresOptions.connectTimeoutMs', message: 'Enter a non-negative whole number.' })
  })
})

