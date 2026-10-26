import { useState } from 'react'
import {
  DEFAULT_QUERY_RESULT_PREFERENCES,
  validateQueryResultPreferences,
  type QueryResultPreferences,
} from '@datapadplusplus/shared-types'
import { SettingsPanel } from './SettingsWorkspace.parts'
import { SettingsIcon } from './icons'
import { SettingsSelectedQuery, type SelectedQuerySettingsProps } from './SettingsSelectedQuery'

export function SettingsQueryResultsPanel({ preferences, onSave, selectedQuery }: {
  preferences?: QueryResultPreferences
  onSave(preferences: QueryResultPreferences): Promise<boolean>
  selectedQuery?: SelectedQuerySettingsProps
}) {
  const [draft, setDraft] = useState<QueryResultPreferences>(
    preferences ?? { ...DEFAULT_QUERY_RESULT_PREFERENCES },
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  let error = ''
  try { validateQueryResultPreferences(draft) } catch (value) {
    error = value instanceof Error ? value.message : 'Check the query settings.'
  }
  const save = async () => {
    if (error || saving) return
    setSaving(true)
    setMessage('')
    try {
      setMessage(await onSave(draft) ? 'Query settings saved. Changes apply to new executions.' : 'Unable to save query settings.')
    } catch { setMessage('Unable to save query settings. Try again.') }
    finally { setSaving(false) }
  }
  return (
    <SettingsPanel title="Queries & Results" icon={<SettingsIcon className="panel-inline-icon" />}>
      <p className="settings-inline-note">Defaults for this workspace. Load More fetches another batch; No limit never loads everything automatically.</p>
      <h3>Fetching and results</h3>
      <fieldset disabled={saving} className="settings-form-grid settings-form-grid--compact">
        <label>
          <span>Fetch batch size</span>
          <input aria-label="Fetch batch size" type="number" min={1} max={5000} step={1}
            value={Number.isNaN(draft.fetchBatchSize) ? '' : draft.fetchBatchSize}
            onChange={event => setDraft({ ...draft, fetchBatchSize: event.target.valueAsNumber })} />
          <small>1–5,000 rows per fetch. This is not a total query limit.</small>
        </label>
        {([
          ['maximumLoadedRows', 'Maximum loaded rows'],
          ['maximumExportedRows', 'Maximum exported rows'],
        ] as const).map(([key, label]) => (
          <div key={key}>
            <label className="settings-check-row">
              <input type="checkbox" checked={draft[key] === null}
                onChange={event => setDraft({ ...draft, [key]: event.target.checked ? null : 10_000 })} />
              <span>{label}: No limit</span>
            </label>
            {draft[key] !== null ? <label>
              <span>{label}</span>
              <input type="number" min={1} max={4_294_967_295} step={1}
                value={Number.isNaN(draft[key]) ? '' : draft[key]}
                onChange={event => setDraft({ ...draft, [key]: event.target.valueAsNumber })} />
            </label> : null}
          </div>
        ))}
      </fieldset>
      <p className="settings-inline-note">Large loaded results consume memory. Explicit query limits and datastore restrictions still apply. API/MCP, Explorer, and history limits are unchanged.</p>
      <h3>New builder queries</h3>
      <fieldset disabled={saving} className="settings-form-grid settings-form-grid--compact">
        <label><span>Default query limit</span><select aria-label="Default query limit" value={draft.newBuilderQueryLimit?.mode ?? 'datastore-default'} onChange={event => {
          const mode = event.target.value as 'datastore-default' | 'limited' | 'unlimited'
          setDraft({ ...draft, newBuilderQueryLimit: mode === 'limited' ? { mode, value: 20 } : { mode } })
        }}><option value="datastore-default">Datastore default</option><option value="limited">Limited</option><option value="unlimited">No limit</option></select></label>
        {draft.newBuilderQueryLimit?.mode === 'limited' ? <label><span>New builder query limit</span><input aria-label="New builder query limit" type="number" min={1} max={4_294_967_295} step={1} value={Number.isNaN(draft.newBuilderQueryLimit.value) ? '' : draft.newBuilderQueryLimit.value} onChange={event => setDraft({ ...draft, newBuilderQueryLimit: { mode: 'limited', value: event.target.valueAsNumber } })} /></label> : null}
      </fieldset>
      <p className="settings-inline-note">Only fresh visual builders use this default. Existing and saved queries are unchanged. No limit applies only where the datastore’s builder supports it; Search hit counts and DynamoDB evaluated-item semantics are preserved.</p>
      <h3>Scripts</h3>
      <fieldset disabled={saving} className="settings-form-grid settings-form-grid--compact">
        <label><span>Script timeout</span><select aria-label="Script timeout" value={draft.scriptTimeout?.mode ?? 'connection-default'} onChange={event => {
          const mode = event.target.value as 'connection-default' | 'custom' | 'unlimited'
          setDraft({ ...draft, scriptTimeout: mode === 'custom' ? { mode, seconds: 3600 } : { mode } })
        }}><option value="connection-default">Connection default</option><option value="custom">Custom duration</option><option value="unlimited">No timeout</option></select></label>
        {draft.scriptTimeout?.mode === 'custom' ? <label><span>Script duration (minutes)</span><input aria-label="Script duration (minutes)" type="number" min={1} max={525600} step={1} value={Number.isNaN(draft.scriptTimeout.seconds) ? '' : draft.scriptTimeout.seconds / 60} onChange={event => setDraft({ ...draft, scriptTimeout: { mode: 'custom', seconds: event.target.valueAsNumber * 60 } })} /><small>60 minutes = 1 hour; 240 minutes = 4 hours.</small></label> : null}
      </fieldset>
      <p className="settings-inline-note">MongoDB scripts: Connection default keeps existing per-operation timeouts. Custom duration covers the entire run, including database waits. No timeout removes that deadline. Cancellation, runaway-code safeguards, and server-enforced limits still apply.</p>
      {error ? <p role="alert" className="dialog-error">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <div className="workbench-dialog-actions">
        <button type="button" className="drawer-button" disabled={saving}
          onClick={() => { setDraft({ ...DEFAULT_QUERY_RESULT_PREFERENCES }); setMessage('') }}>Reset to defaults</button>
        <button type="button" className="drawer-button drawer-button--primary"
          disabled={saving || Boolean(error)} onClick={() => void save()}>{saving ? 'Saving…' : 'Save query settings'}</button>
      </div>
      {selectedQuery ? <SettingsSelectedQuery {...selectedQuery} /> : null}
    </SettingsPanel>
  )
}
