import { useEffect, useRef, useState } from 'react'
import type { ConnectionProfile, SqlServerAuthRequest, SqlServerAuthStatus, SqlServerAuthenticationMode } from '@datapadplusplus/shared-types'
import { clientConnections } from '../../../../../services/runtime/client-connections'
import { isTauriRuntime } from '../../../../../services/runtime/desktop-bridge'

interface Props {
  profile: ConnectionProfile
  workspaceId?: string
  workspaceRevision: number
  onChange(path: string, value: unknown): void
}
export function SqlServerAuthenticationFields(props: Props) {
  const { profile, workspaceId, workspaceRevision, onChange } = props
  const mode = profile.sqlServerOptions?.authenticationMode ?? 'sql-server'
  const binding = JSON.stringify([workspaceId, profile.id, profile.environmentIds, profile.host, profile.port, profile.database, profile.connectionMode, profile.sqlServerOptions, workspaceRevision])
  // Keep editable inputs mounted while resetting only the asynchronous account state.
  return <section className="sqlserver-authentication" aria-label="SQL Server authentication">
    <h3>Authentication</h3>
    <label className="connection-editor-field"><span>Sign-in method</span><select value={mode} onChange={event => {
      const next = event.target.value as SqlServerAuthenticationMode
      onChange('sqlServerOptions.authenticationMode', next)
      if (next === 'azure-ad-interactive') { onChange('sqlServerOptions.encryptConnection', true); onChange('sqlServerOptions.trustServerCertificate', false) }
    }}>
      <option value="sql-server">SQL Server login</option>
      <option value="windows">Windows — current account</option>
      <option value="azure-ad-interactive">Microsoft Entra — browser sign-in</option>
      {!['sql-server', 'windows', 'azure-ad-interactive'].includes(mode) ? <option value={mode}>{mode} — unavailable</option> : null}
    </select></label>
    {mode === 'azure-ad-interactive' ? <div className="connection-editor-grid">
      <label className="connection-editor-field"><span>Organisation tenant ID</span><input autoComplete="off" value={profile.sqlServerOptions?.azureTenantId ?? ''} onChange={event => onChange('sqlServerOptions.azureTenantId', event.target.value)} /></label>
      <label className="connection-editor-field"><span>Application client ID</span><input autoComplete="off" value={profile.sqlServerOptions?.azureClientId ?? ''} onChange={event => onChange('sqlServerOptions.azureClientId', event.target.value)} /></label>
    </div> : null}
    <AuthenticationControls key={binding} {...props} />
  </section>
}
function AuthenticationControls({ profile, workspaceId = '', workspaceRevision }: Props) {
  const mode = profile.sqlServerOptions?.authenticationMode ?? 'sql-server'
  const tenant = profile.sqlServerOptions?.azureTenantId ?? ''
  const client = profile.sqlServerOptions?.azureClientId ?? ''
  const [status, setStatus] = useState<SqlServerAuthStatus>()
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<SqlServerAuthRequest | null>(null)
  const generation = useRef(0)
  const desktop = isTauriRuntime()
  const request: SqlServerAuthRequest = { profile, environmentId: profile.environmentIds[0] ?? '', workspaceId, workspaceRevision, remember }
  const [initialRequest] = useState(request)

  useEffect(() => {
    const version = ++generation.current
    const current = initialRequest
    if (mode !== 'azure-ad-interactive' || /^[\da-f-]{36}$/i.test(tenant) && /^[\da-f-]{36}$/i.test(client)) {
      void clientConnections.sqlServerAuthentication(current, 'status').then(value => {
        if (version === generation.current) { setStatus(value); setRemember(value.remembered) }
      }).catch(() => { /* A status probe must not prompt or prevent editing. Explicit sign-in reports actionable errors. */ })
    }
    return () => {
      generation.current += 1
      if (pending.current) {
        void clientConnections.sqlServerAuthentication(pending.current, 'cancel').catch(() => undefined)
        pending.current = null
      }
    }
  }, [initialRequest, mode, tenant, client])

  const act = async (operation: 'sign-in' | 'sign-out' | 'cancel') => {
    const version = ++generation.current
    setError(''); setBusy(operation !== 'cancel')
    if (operation === 'sign-in') pending.current = request
    try {
      const result = await clientConnections.sqlServerAuthentication(pending.current ?? request, operation)
      if (version === generation.current) { setStatus(result); setRemember(result.remembered) }
    } catch (failure) {
      if (version === generation.current) setError(failure instanceof Error ? failure.message : typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : 'Sign-in could not finish. Check your organisation’s registration and try again.')
    } finally {
      if (version === generation.current) { pending.current = null; setBusy(false) }
    }
  }

  return <>
    {mode === 'windows' ? <p role="status">{desktop && status?.windowsAvailable
      ? `Connect as ${status.windowsAccount ?? 'the current Windows process account'}. No Windows password is collected.`
      : 'Windows current-account authentication requires the Windows desktop application and a server configured for Windows authentication.'}</p> : null}
    {mode === 'azure-ad-interactive' ? <>
      <p>Use your organisation’s desktop app registration. Sign-in opens your system browser and supports MFA. Device-compliance policies requiring an OS broker are not supported.</p>
      {!desktop ? <p>Native sign-in is unavailable in browser preview.</p> : null}
      <label><input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)} />Remember this account on this device</label>
      <div className="sqlserver-authentication-actions">
        <button type="button" disabled={!desktop || busy || !tenant.trim() || !client.trim()} onClick={() => void act('sign-in')}>{status?.state === 'signed-in' ? 'Change account' : 'Sign in'}</button>
        {busy ? <button type="button" onClick={() => void act('cancel')}>Cancel sign-in</button> : status?.state === 'signed-in' ? <button type="button" onClick={() => void act('sign-out')}>Sign out</button> : null}
      </div>
      <p role="status">{busy ? 'Waiting for Microsoft sign-in in your browser… (up to 5 minutes)' : status?.state === 'signed-in' ? `Signed in as ${status.account ?? 'the selected account'}. This does not verify database access; use Test connection.` : 'Sign-in required before connecting. You can save this profile without signing in.'}</p>
    </> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {status?.warning ? <p role="alert">{status.warning}</p> : null}
  </>
}
