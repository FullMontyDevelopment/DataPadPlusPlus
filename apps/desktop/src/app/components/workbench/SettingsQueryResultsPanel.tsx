import { useState } from 'react'
import {
  DEFAULT_QUERY_RESULT_PREFERENCES,
  validateQueryResultPreferences,
  type QueryResultPreferences,
} from '@datapadplusplus/shared-types'
import { SettingsPanel } from './SettingsWorkspace.parts'
import { SettingsIcon } from './icons'

export function SettingsQueryResultsPanel({ preferences, onSave }: {
  preferences?: QueryResultPreferences
  onSave(preferences: QueryResultPreferences): Promise<boolean>
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
      {error ? <p role="alert" className="dialog-error">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <div className="workbench-dialog-actions">
        <button type="button" className="drawer-button" disabled={saving}
          onClick={() => { setDraft({ ...DEFAULT_QUERY_RESULT_PREFERENCES }); setMessage('') }}>Reset to defaults</button>
        <button type="button" className="drawer-button drawer-button--primary"
          disabled={saving || Boolean(error)} onClick={() => void save()}>{saving ? 'Saving…' : 'Save query settings'}</button>
      </div>
    </SettingsPanel>
  )
}
