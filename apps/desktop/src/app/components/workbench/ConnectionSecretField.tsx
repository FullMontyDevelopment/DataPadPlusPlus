import { useEffect, useRef, useState } from 'react'
import type { ConnectionProfile, ConnectionSecretMutation } from '@datapadplusplus/shared-types'
import { connectionFieldValue } from '@datapadplusplus/shared-types'
import { desktopClient } from '../../../services/runtime/client'
import { HideIcon, ShowIcon } from './icons'

type ConnectionSecretFieldProps = {
  profile: ConnectionProfile
  revision: number
  slot: string
  label: string
  mutation?: ConnectionSecretMutation
  onChange(mutation?: ConnectionSecretMutation): void
}

export function ConnectionSecretField(props: ConnectionSecretFieldProps) {
  const { profile, revision, slot } = props
  // Remount on authoritative context changes, clearing any revealed value and
  // invalidating pending replies without carrying a secret into another profile.
  const context = JSON.stringify([profile.id, profile.updatedAt, revision, slot, connectionFieldValue(profile, slot)])
  return <ScopedConnectionSecretField key={context} {...props} />
}

function ScopedConnectionSecretField({ profile, revision, slot, label, mutation, onChange }: ConnectionSecretFieldProps) {
  const [revealed, setRevealed] = useState<string>()
  const [showDraft, setShowDraft] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const stored = Boolean(connectionFieldValue(profile, slot))
  const multiline = slot === 'auth.connectionStringSecretRef'
  const inputId = 'connection-secret-' + slot
  const replacement = mutation?.action === 'replace'
  const value = replacement ? mutation.value ?? '' : revealed ?? ''
  const visible = revealed !== undefined || showDraft
  const resetReveal = () => {
    generation.current += 1
    setRevealed(undefined); setConfirm(false); setBusy(false); setError('')
  }
  useEffect(() => {
    const hide = () => { generation.current += 1; setRevealed(undefined); setShowDraft(false); setConfirm(false); setBusy(false) }
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', hide)
    return () => {
      generation.current += 1
      window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [])
  useEffect(() => {
    if (revealed === undefined && !showDraft) return
    const timer = window.setTimeout(() => { setRevealed(undefined); setShowDraft(false) }, 30_000)
    return () => window.clearTimeout(timer)
  }, [revealed, showDraft])

  const reveal = async () => {
    const current = ++generation.current
    setBusy(true)
    setError('')
    try {
      const result = await desktopClient.revealConnectionSecret({
        connectionId: profile.id, expectedUpdatedAt: profile.updatedAt,
        workspaceRevision: revision, slot, confirmed: true,
      })
      if (current === generation.current) setRevealed(result.value)
    } catch {
      if (current === generation.current) setError('The saved value could not be revealed. Reopen the editor or replace the unavailable credential.')
    } finally {
      if (current === generation.current) { setBusy(false); setConfirm(false) }
    }
  }
  const placeholder = mutation?.action === 'remove' ? 'Removed when you save'
    : stored ? '••••••••' : multiline ? 'Paste the complete connection string' : 'Enter ' + label.toLowerCase()
  const update = (next: string) => {
    resetReveal()
    onChange(next === '' ? undefined : { slot, action: 'replace', value: next })
  }
  const status = mutation?.action === 'remove' ? 'Removed when you save the connection.'
    : replacement ? 'Saved securely when you save the connection.'
    : stored ? 'Stored in credential vault. Leave blank to keep it.' : undefined
  return <div className="connection-secret">
    <label htmlFor={inputId}>{label}</label>
    <div className="connection-secret-input">
      {multiline
        ? <textarea id={inputId} aria-describedby={status ? inputId + '-status' : undefined} spellCheck={false} autoComplete="off" rows={3}
            readOnly={revealed !== undefined} className={!visible && value ? 'connection-secret-masked' : undefined}
            value={value} placeholder={placeholder} onChange={event => update(event.target.value)} />
        : <input id={inputId} aria-describedby={status ? inputId + '-status' : undefined} type={visible ? 'text' : 'password'}
            autoComplete="new-password" spellCheck={false} readOnly={revealed !== undefined}
            value={value} placeholder={placeholder} onChange={event => update(event.target.value)} />}
      {stored && !mutation ? <button type="button" disabled={busy} onClick={() => {
        if (revealed !== undefined) resetReveal()
        else setConfirm(true)
      }}>{revealed !== undefined ? <HideIcon /> : <ShowIcon />}{revealed !== undefined ? 'Hide' : 'Reveal…'}</button>
        : replacement && value ? <button type="button" aria-label={(showDraft ? 'Hide ' : 'Show ') + label.toLowerCase()}
            title={(showDraft ? 'Hide ' : 'Show ') + label.toLowerCase()} onClick={() => setShowDraft(current => !current)}>
            {showDraft ? <HideIcon /> : <ShowIcon />}
          </button> : null}
    </div>
    {stored || mutation ? <div className="connection-secret-actions">
      <small id={inputId + '-status'}>{status}</small>
      {mutation ? <button type="button" disabled={busy} onClick={() => { resetReveal(); setShowDraft(false); onChange(undefined) }}>
        {stored ? 'Undo change' : 'Clear'}
      </button> : null}
      {stored && mutation?.action !== 'remove' && slot !== 'auth.connectionStringSecretRef'
        ? <button type="button" disabled={busy} onClick={() => { resetReveal(); setShowDraft(false); onChange({ slot, action: 'remove' }) }}>Remove</button> : null}
    </div> : null}
    {confirm ? <div className="connection-secret-confirm" role="group" aria-label="Confirm credential reveal">
      <span>Anyone viewing this screen can see the saved value. It hides after 30 seconds or when you leave this window.</span>
      <button type="button" disabled={busy} onClick={() => void reveal()}>{busy ? 'Revealing…' : 'Reveal saved value'}</button>
      <button type="button" disabled={busy} onClick={() => setConfirm(false)}>Cancel reveal</button>
    </div> : null}
    {error ? <small role="alert" className="form-error">{error}</small> : null}
  </div>
}
