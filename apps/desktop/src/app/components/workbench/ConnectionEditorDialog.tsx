import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CONNECTION_EDITOR_CATALOG, connectionFieldValue, setConnectionField, validateConnectionEditor,
  type ConnectionEditorField, type ConnectionProfile, type ConnectionSecretMutation,
  type ConnectionTestResult, type EnvironmentProfile, type LocalDatabaseCreateRequest,
  type LocalDatabaseCreateResult, type LocalDatabasePickRequest, type LocalDatabasePickResult,
} from '@datapadplusplus/shared-types'
import { DatastoreEngineSelect } from './RightDrawer.engine-select'
import { defaultPortForEngine, engineFamily, engineOption, inferConnectionName, isCustomConnectionName } from './RightDrawer.helpers'
import { ConnectionSecretField } from './ConnectionSecretField'
import './ConnectionEditorDialog.css'

export interface ConnectionEditorDialogProps {
  activeConnection: ConnectionProfile
  environments: EnvironmentProfile[]
  workspaceRevision: number
  isNew: boolean
  onClose(): void
  onSaveConnection(profile: ConnectionProfile, secret?: string, mutations?: ConnectionSecretMutation[]): Promise<boolean>
  onTestConnection(profile: ConnectionProfile, environmentId: string, secret?: string): Promise<ConnectionTestResult | undefined>
  onPickLocalDatabaseFile(request: LocalDatabasePickRequest): Promise<LocalDatabasePickResult>
  onCreateLocalDatabase(request: LocalDatabaseCreateRequest): Promise<LocalDatabaseCreateResult | undefined>
}

export function ConnectionEditorDialog(props: ConnectionEditorDialogProps) {
  const [draft, setDraft] = useState<ConnectionProfile>(() => ({ ...props.activeConnection,
    name: isCustomConnectionName(props.activeConnection) ? props.activeConnection.name : inferConnectionName(props.activeConnection),
    connectionString: undefined }))
  const [secrets, setSecrets] = useState<Record<string, ConnectionSecretMutation>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<ConnectionTestResult>()
  const [localIntent, setLocalIntent] = useState<'open' | 'create'>('open')
  const [folder, setFolder] = useState('')
  const [filename, setFilename] = useState('database')
  const [starter, setStarter] = useState(false)
  const [createdPath, setCreatedPath] = useState('')
  const [discard, setDiscard] = useState(false)
  const [dirty, setDirty] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const discardRef = useRef<HTMLElement>(null)
  const discardOriginRef = useRef<HTMLElement | null>(null)
  const generation = useRef(0)
  const capability = CONNECTION_EDITOR_CATALOG[draft.engine]
  const method = draft.connectionMode ?? capability.methods[0]
  const methodId = useId()
  const uri = method === 'connection-string'
  const local = method === 'local-file'
  const changed = () => { generation.current += 1; setDirty(true); setTest(undefined); setError('') }
  const change = (path: string, value: unknown) => {
    changed()
    setDraft(current => setConnectionField(current, path, value))
  }
  const close = () => {
    if (discard) { setDiscard(false); return }
    if (busy) return
    if (dirty) {
      discardOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setDiscard(true)
    } else props.onClose()
  }
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })

  useLayoutEffect(() => {
    if (discard) discardRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    else if (discardOriginRef.current) {
      discardOriginRef.current.focus({ preventScroll: true })
      discardOriginRef.current = null
    }
  }, [discard])

  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const scope = discardRef.current ?? dialogRef.current
      const items = [...(scope?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, textarea:not([disabled])') ?? [])]
        .filter(item => item.tabIndex !== -1 && !item.matches(':disabled') && (!item.closest('details:not([open])') || item.tagName === 'SUMMARY'))
      const first = items[0]; const last = items.at(-1)
      if (!scope?.contains(document.activeElement)) { event.preventDefault(); first?.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { generation.current += 1; document.removeEventListener('keydown', key); origin?.focus() }
  }, [])

  const setSecret = (slot: string, mutation?: ConnectionSecretMutation) => {
    generation.current += 1
    setSecrets(current => { const next = { ...current }; if (mutation) next[slot] = mutation; else delete next[slot]; return next })
    setDirty(true); setTest(undefined); setError('')
  }
  const secret = (slot: string, label: string) => <ConnectionSecretField
    key={draft.engine + slot} profile={draft} revision={props.workspaceRevision} slot={slot} label={label}
    mutation={secrets[slot]} onChange={mutation => setSecret(slot, mutation)} />
  const field = (item: ConnectionEditorField) => {
    if (item.kind === 'secret') return secret(item.path, item.label)
    const value = connectionFieldValue(draft, item.path)
    const labelId = 'connection-field-' + item.path
    const helpId = item.help ? labelId + '-help' : undefined
    return <label key={item.path} className="connection-editor-field">
      <span id={labelId}>{item.label}</span>
      {item.kind === 'boolean' ? <select aria-labelledby={labelId} aria-describedby={helpId} value={value === undefined ? '' : String(value)}
        onChange={event => change(item.path, event.target.value === '' ? undefined : event.target.value === 'true')}>
        <option value="">Driver default</option><option value="true">Enabled</option><option value="false">Disabled</option>
      </select> : item.kind === 'select' ? <select aria-labelledby={labelId} aria-describedby={helpId} value={String(value ?? '')}
        onChange={event => change(item.path, event.target.value || undefined)}>
        <option value="">Driver default</option>
        {value && !item.values?.includes(String(value)) ? <option value={String(value)}>{String(value)} — unavailable</option> : null}
        {item.values?.map(choice => <option key={choice} value={choice}>{choice}</option>)}
      </select> : <input aria-labelledby={labelId} aria-describedby={helpId} type="text" inputMode={item.kind === 'integer' ? 'numeric' : undefined}
        value={Array.isArray(value) ? value.join(', ') : String(value ?? '')} placeholder={item.kind === 'list' ? 'Separate values with commas' : item.defaultDescription}
        onChange={event => {
          const text = event.target.value
          change(item.path, text === '' ? undefined : item.kind === 'integer' ? (/^-?\d+$/.test(text) ? Number(text) : text)
            : item.kind === 'list' ? text.split(',').map(part => part.trim()) : text)
        }} />}
      {item.help ? <small id={helpId}>{item.help}</small> : null}
    </label>
  }
  const validate = () => {
    const errors = validateConnectionEditor(draft)
    if (uri && !draft.auth.connectionStringSecretRef && !secrets['auth.connectionStringSecretRef']?.value) errors.push({ path: 'connectionString', message: 'Enter the complete connection string.' })
    for (const mutation of Object.values(secrets)) if (mutation.action === 'replace' && !mutation.value) errors.push({ path: mutation.slot, message: 'Enter a replacement value or undo the credential change.' })
    if (errors.length) { setError(errors.map(item => item.message).join(' ')); return false }
    return true
  }
  const save = async () => {
    if (!validate()) return
    const current = ++generation.current
    setBusy(true); setError('')
    try {
      let profile = uri ? { ...draft, host: '', port: undefined, database: undefined } : draft
      if (local && localIntent === 'create' && !createdPath) {
        if (draft.engine === 'litedb' && draft.auth.secretRef && !secrets['auth.secretRef']) {
          setError('For a new encrypted database, explicitly enter its new password. To create an unencrypted file, choose Remove for the saved database password.'); return
        }
        if (!folder || !filename.trim() || /[\\/:*?"<>|]/.test(filename) || /^\.\.?$/.test(filename)) {
          setError('Choose a folder and enter a valid database filename.'); return
        }
        const path = folder.replace(/[\\/]$/, '') + '/' + filename.trim() + '.' + capability.local?.extension
        const result = await props.onCreateLocalDatabase({ engine: draft.engine, path, mode: starter ? 'starter' : 'empty', password: draft.engine === 'litedb' ? secrets['auth.secretRef']?.value : undefined })
        if (generation.current !== current) return
        if (!result) { setError('The database could not be created. No connection was saved.'); return }
        setCreatedPath(result.path)
        profile = { ...draft, host: result.path, database: result.path }
        setDraft(profile)
      }
      const saved = await props.onSaveConnection(profile, undefined, Object.values(secrets))
      if (!saved) setError(local && (createdPath || localIntent === 'create')
        ? 'The database file was created, but the connection was not saved. Retry Save Connection; the file will not be created again.'
        : 'The connection was not saved. Your draft is unchanged. Check the application error for details, then retry.')
    } catch {
      setError('The operation failed. Your draft is unchanged. No automatic retry was attempted.')
    } finally { setBusy(false) }
  }
  const testConnection = async () => {
    if (!validate()) return
    const current = ++generation.current
    setBusy(true); setError('')
    try {
      const profile = { ...draft, ...(uri ? { host: '', port: undefined, database: undefined } : {}),
        connectionString: secrets['auth.connectionStringSecretRef']?.value }
      const result = await props.onTestConnection(profile, draft.environmentIds[0] ?? '', secrets['auth.secretRef']?.value)
      if (generation.current === current) setTest(result)
    } catch { setError('Connection testing failed. Check the application error for details.'); }
    finally { setBusy(false) }
  }
  const pick = async (purpose: 'open' | 'create') => {
    const current = ++generation.current
    setBusy(true)
    try {
      const selection = await props.onPickLocalDatabaseFile({ engine: draft.engine, purpose })
      if (generation.current !== current) return
      if (selection.path) {
        if (purpose === 'create') { setFolder(selection.path); changed() }
        else { change('database', selection.path); change('host', selection.path) }
      }
    } catch { setError('The file selection could not be completed.') }
    finally { setBusy(false) }
  }

  return createPortal(<><div className="workbench-modal-overlay connection-editor-overlay">
    <div ref={dialogRef} inert={discard} aria-hidden={discard || undefined} className="workbench-dialog connection-editor-dialog" role="dialog" aria-modal="true" aria-label="connection drawer" aria-labelledby="connection-editor-title" data-tour-id="connection-drawer">
      <header><div><small>Connections</small><h2 id="connection-editor-title">{props.isNew ? 'Create connection' : 'Edit connection'}</h2></div>
        <button type="button" aria-label="Close connection editor" disabled={busy} onClick={close}>×</button></header>
      <div className="connection-editor-body">
        <fieldset disabled={busy}>
          <section aria-label="General">
            <h3>General</h3>
            {capability.status === 'local-only' ? <p className="connection-editor-support">This runtime supports local or contract endpoints only. Full managed-cloud connection support is unavailable.</p> : null}
            <div className="connection-editor-grid">
              <label className="connection-editor-field"><span>Name</span><input value={draft.name} onChange={event => change('name', event.target.value)} /></label>
              <label className="connection-editor-field"><span>Environment</span><select value={draft.environmentIds[0] ?? ''} onChange={event => change('environmentIds', event.target.value ? [event.target.value] : [])}>
                <option value="">No environment</option>{props.environments.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select></label>
              <div className="connection-editor-field connection-editor-datastore"><span>Datastore</span>{props.isNew ? <DatastoreEngineSelect value={draft.engine} onChange={engine => {
                generation.current += 1
                setDraft(current => {
                  const next = { ...current, engine, family: engineFamily(engine), port: defaultPortForEngine(engine), connectionMode: CONNECTION_EDITOR_CATALOG[engine].methods[0], auth: {}, connectionString: undefined }
                  return { ...next, name: current.name === inferConnectionName(current) ? inferConnectionName(next) : current.name }
                })
                setSecrets({}); setTest(undefined); setCreatedPath(''); setFolder(''); setDirty(true)
              }} /> : <strong>{engineOption(draft.engine)?.label ?? draft.engine}</strong>}</div>
            </div>
            <div className="connection-editor-method">
              <h3 id={methodId + '-label'}>Connection method</h3>
              <div role="tablist" aria-labelledby={methodId + '-label'} className="connection-method-tabs">
                {capability.methods.map((mode, index) => <button key={mode} type="button" role="tab"
                  id={methodId + '-' + mode} aria-selected={method === mode} aria-controls={methodId + '-panel'}
                  tabIndex={method === mode ? 0 : -1} onClick={() => { if (method !== mode) change('connectionMode', mode) }}
                  onKeyDown={event => {
                    if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? capability.methods.length - 1
                      : (index + (event.key === 'ArrowRight' ? 1 : -1) + capability.methods.length) % capability.methods.length
                    if (method !== capability.methods[next]) change('connectionMode', capability.methods[next])
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
                  }}>
                  {({ native: 'Connection fields', 'connection-string': 'Connection string', 'local-file': 'Local database file', 'cloud-sdk': 'Cloud / endpoint settings', 'cloud-iam': 'Cloud identity' })[mode]}
                </button>)}
              </div>
            </div>
            <div role="tabpanel" id={methodId + '-panel'} aria-labelledby={methodId + '-' + method} className="connection-method-panel">
            {uri ? <div className="connection-editor-uri">{secret('auth.connectionStringSecretRef', 'Complete connection string')}</div>
              : local ? <div className="connection-local-flow">
                <div role="group" aria-label="Local database action">
                  <button type="button" aria-pressed={localIntent === 'open'} disabled={Boolean(createdPath)} onClick={() => { setLocalIntent('open'); changed() }}>Open existing database</button>
                  <button type="button" aria-pressed={localIntent === 'create'} disabled={Boolean(createdPath)} onClick={() => { setLocalIntent('create'); changed() }}>Create new database</button>
                </div>
                {localIntent === 'open' ? <label className="connection-editor-field"><span>Database file</span><div className="connection-editor-inline"><input value={draft.database ?? ''} onChange={event => { change('database', event.target.value); change('host', event.target.value) }} /><button type="button" onClick={() => void pick('open')}>Browse…</button></div></label>
                  : <><p>A new {engineOption(draft.engine)?.label} database will be created when you save. Existing files will never be replaced.</p>
                    <div className="connection-editor-inline"><span>{createdPath || folder || 'No folder selected'}</span><button type="button" disabled={Boolean(createdPath)} onClick={() => void pick('create')}>Choose folder…</button></div>
                    <label className="connection-editor-field"><span>Filename (.{capability.local?.extension})</span><input disabled={Boolean(createdPath)} value={filename} onChange={event => { setFilename(event.target.value); changed() }} /></label>
                    {capability.local?.starter ? <label><input type="checkbox" disabled={Boolean(createdPath)} checked={starter} onChange={event => { setStarter(event.target.checked); changed() }} />Include example tables and data</label> : null}
                    {createdPath ? <p role="status">Database created. Save the connection to finish.</p> : null}
                  </>}
                {capability.fields.some(item => item.section === 'general') ? <div className="connection-editor-grid">{capability.fields.filter(item => item.section === 'general').map(field)}</div> : null}
              </div>
              : <div className="connection-editor-grid">
                <label className="connection-editor-field"><span>Host</span><input value={draft.host} onChange={event => change('host', event.target.value)} /></label>
                {!(draft.engine === 'mongodb' && draft.mongodbOptions?.connectionScheme === 'mongodb+srv') ? <label className="connection-editor-field"><span>Port</span><input inputMode="numeric" value={draft.port ?? ''} onChange={event => {
                  const text = event.target.value
                  change('port', text === '' ? undefined : /^\d+$/.test(text) ? Number(text) : text)
                }} /></label> : null}
                <label className="connection-editor-field"><span>Database / default scope</span><input value={draft.database ?? ''} onChange={event => change('database', event.target.value)} /></label>
                {capability.fields.filter(item => item.section === 'general').map(field)}
              </div>}
            <div className="connection-editor-flags">
              <label><input type="checkbox" checked={draft.readOnly} onChange={event => change('readOnly', event.target.checked)} />Read-only connection</label>
              <label><input type="checkbox" checked={draft.favorite} onChange={event => change('favorite', event.target.checked)} />Favorite</label>
            </div>
          {!uri ? (['authentication', 'tls', 'advanced'] as const).map(section => {
            const fields = capability.fields.filter(item => item.section === section)
            if (!fields.length && !(section === 'authentication' && capability.credentials)) return null
            return <details key={section}>
              <summary>{({ authentication: 'Authentication', tls: 'TLS & certificates', advanced: 'Advanced' })[section]}</summary>
              <fieldset className="connection-editor-grid" disabled={draft.engine === 'litedb' && Boolean(createdPath) && section === 'authentication'}>
                {section === 'authentication' && capability.credentials ? <>
                  {capability.username !== false && !local ? <label className="connection-editor-field"><span>Username</span><input autoComplete="off" value={draft.auth.username ?? ''} onChange={event => change('auth.username', event.target.value)} /></label> : null}
                  {secret('auth.secretRef', capability.credentialLabel ?? 'Password')}
                </> : null}
                {fields.map(field)}
              </fieldset>
            </details>
          }) : null}
            </div>
          </section>
          {capability.limitations.length ? <details className="connection-editor-limitations"><summary>Runtime support and limitations</summary><ul>{capability.limitations.map(item => <li key={item}>{item}</li>)}</ul></details> : null}
        </fieldset>
        {test ? <div role="status" className={test.ok ? 'connection-editor-test' : 'form-error'}>{test.message}{test.warnings.map(warning => <p key={warning}>{warning}</p>)}</div> : null}
        {error ? <p role="alert" className="form-error">{error}</p> : null}
      </div>
      <footer><button type="button" title={local && localIntent === 'create' && !createdPath ? 'Create the database before testing it.' : Object.values(secrets).some(item => item.action === 'remove' || !['auth.secretRef', 'auth.connectionStringSecretRef'].includes(item.slot)) ? 'Save secondary credential changes before testing this connection.' : undefined}
        disabled={busy || local && localIntent === 'create' && !createdPath || Object.values(secrets).some(item => item.action === 'remove' || !['auth.secretRef', 'auth.connectionStringSecretRef'].includes(item.slot))} onClick={() => void testConnection()}>Test connection</button>
        <span /> <button type="button" disabled={busy} onClick={close}>Cancel</button>
        <button type="button" className="drawer-button--primary" disabled={busy} onClick={() => void save()}>{busy ? 'Working…' : local && localIntent === 'create' && !createdPath ? 'Create Database and Save Connection' : 'Save Connection'}</button></footer>
    </div>
  </div>
    {discard ? <div className="workbench-modal-overlay connection-discard-overlay">
      <section ref={discardRef} className="workbench-dialog connection-discard-dialog" role="alertdialog" aria-modal="true"
        aria-labelledby={methodId + '-discard-title'} aria-describedby={methodId + '-discard-description'}>
        <h2 id={methodId + '-discard-title'}>Discard connection changes?</h2>
        <div id={methodId + '-discard-description'} className="connection-discard-message">
          <p>Your changes have not been saved. Keep editing this connection, or discard the unsaved changes.</p>
          {createdPath ? <p>The created database file will remain on disk.</p> : null}
        </div>
        <div className="workbench-dialog-actions">
          <button type="button" className="drawer-button drawer-button--primary" onClick={() => setDiscard(false)}>Keep editing</button>
          <button type="button" className="drawer-button drawer-button--danger" onClick={props.onClose}>Discard changes</button>
        </div>
      </section>
    </div> : null}
  </>, document.body)
}
