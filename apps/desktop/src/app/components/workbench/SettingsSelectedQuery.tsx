import { useState } from 'react'
import type { QueryTabResultSettingsRequest, QueryTabState, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { queryLimitBuilder, queryLimitValue, removeQueryLimit, supportsUnlimitedQueryLimit } from '../../../../../../packages/query-compiler/src/query-limit-settings'

export interface SelectedQuerySettingsProps {
  snapshot?: WorkspaceSnapshot
  initialTabId?: string
  windowId?: string
  onApply?(request: QueryTabResultSettingsRequest): Promise<boolean>
}

export function SettingsSelectedQuery({ snapshot, initialTabId, windowId = 'main', onApply }: SelectedQuerySettingsProps) {
  const tabs = snapshot?.tabs.filter(tab => !tab.tabKind || tab.tabKind === 'query') ?? []
  const [selectedId, setSelectedId] = useState(initialTabId ?? tabs[0]?.id ?? '')
  const [reload, setReload] = useState(0)
  const tab = tabs.find(tab => tab.id === selectedId)
  return <details className="settings-selected-query">
    <summary>Selected query</summary>
    <p className="settings-inline-note">Advanced options for one open query. These apply to its next execution, not existing results.</p>
    <label className="settings-query-selector"><span>Open query</span><select aria-label="Open query" value={selectedId} onChange={event => setSelectedId(event.target.value)}>
      {!tab ? <option value={selectedId}>{tabs.length ? 'Choose an open query' : 'No open queries'}</option> : null}
      {tabs.map(item => <option key={item.id} value={item.id}>{item.title} — {snapshot?.connections.find(connection => connection.id === item.connectionId)?.name ?? 'Missing connection'} / {snapshot?.environments.find(environment => environment.id === item.environmentId)?.label ?? 'Missing environment'}</option>)}
    </select></label>
    {tab && snapshot ? <SelectedQueryForm key={`${tab.id}:${reload}`} tab={tab} snapshot={snapshot} windowId={windowId} onApply={onApply} onReload={() => setReload(value => value + 1)} /> : <p role="status">The selected query is no longer open. Choose another query.</p>}
  </details>
}

function fingerprint(tab: QueryTabState) {
  return JSON.stringify([tab.connectionId, tab.environmentId, tab.queryViewMode, tab.queryText, tab.scriptText, tab.builderState, tab.scopedTarget, tab.sqlScope, tab.queryFetchBatchSize])
}

function SelectedQueryForm({ tab, snapshot, windowId, onApply, onReload }: {
  tab: QueryTabState; snapshot: WorkspaceSnapshot; windowId: string
  onApply?: SelectedQuerySettingsProps['onApply']; onReload(): void
}) {
  const [baseline, setBaseline] = useState(fingerprint(tab))
  const [inherit, setInherit] = useState(tab.queryFetchBatchSize === undefined)
  const [size, setSize] = useState(tab.queryFetchBatchSize ?? snapshot.preferences.queryResults?.fetchBatchSize ?? 500)
  const [removeLimit, setRemoveLimit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const connection = snapshot.connections.find(item => item.id === tab.connectionId)
  const environment = snapshot.environments.find(item => item.id === tab.environmentId)
  const builder = connection ? queryLimitBuilder(tab, connection) : undefined
  const unlimited = builder && queryLimitValue(builder) === null
  const stale = baseline !== fingerprint(tab)
  const otherWindow = snapshot.ui.workspaceWindows?.some(window => window.id !== windowId && window.tabIds.includes(tab.id))
  const blocked = snapshot.lockState.isLocked ? 'Unlock the workspace to change this query.'
    : otherWindow ? 'Move this query to this window before changing its advanced settings.'
      : tab.activeExecution || ['running', 'queued'].includes(tab.status) ? 'Wait for this query to finish before applying changes.'
        : !connection || !environment ? 'The query’s connection or environment is unavailable.' : ''
  const invalid = !inherit && (!Number.isSafeInteger(size) || size < 1 || size > 5000)
  const apply = async () => {
    if (busy || blocked || stale || invalid || !onApply) return
    setBusy(true); setMessage('')
    try {
      const success = await onApply({ tabId: tab.id, expectedRevision: snapshot.workspaceRevision ?? 0,
        fetchBatchSize: inherit ? undefined : size, removeQueryLimit: removeLimit && !unlimited })
      setMessage(success ? 'Applied to the selected query. Existing results are unchanged.' : 'Changes were not applied. Review the query and try again.')
      if (success) {
        const updated = removeLimit && !unlimited && connection ? removeQueryLimit({ tab, connection }) : {}
        setBaseline(fingerprint({ ...tab, ...updated, queryFetchBatchSize: inherit ? undefined : size }))
        setRemoveLimit(false)
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Changes were not applied.') }
    finally { setBusy(false) }
  }
  return <div>
    <p className="settings-inline-note"><strong>{tab.title}</strong><br />{connection?.name ?? 'Missing connection'} / {environment?.label ?? 'Missing environment'}</p>
    <fieldset disabled={busy || Boolean(blocked) || stale} className="settings-form-grid settings-form-grid--compact">
      <label className="settings-check-row"><input type="checkbox" checked={inherit} onChange={event => setInherit(event.target.checked)} />Use workspace batch size ({snapshot.preferences.queryResults?.fetchBatchSize ?? 500})</label>
      {!inherit ? <label><span>Query batch size</span><input aria-label="Query batch size" type="number" min={1} max={5000} step={1} value={Number.isNaN(size) ? '' : size} onChange={event => setSize(event.target.valueAsNumber)} /></label> : null}
      {supportsUnlimitedQueryLimit(builder) ? unlimited ? <p>This query has no builder limit. Enter a number on its query tab to add one.</p>
        : <label className="settings-check-row"><input type="checkbox" checked={removeLimit} onChange={event => setRemoveLimit(event.target.checked)} />Remove builder query limit</label>
        : <p className="settings-inline-note">This query’s native limits are unchanged. Removing a limit is available only for supported visual builders.</p>}
    </fieldset>
    {blocked || invalid ? <p role="alert">{blocked || 'Batch size must be from 1 to 5,000.'}</p> : null}
    {stale ? <p role="status">This query changed. <button type="button" className="drawer-button" disabled={busy} onClick={onReload}>Review latest query</button></p> : null}
    {message ? <p role="status">{message}</p> : null}
    <div className="workbench-dialog-actions"><button type="button" className="drawer-button" disabled={busy || Boolean(blocked) || stale || invalid || !onApply} onClick={() => void apply()}>{busy ? 'Applying…' : 'Apply to selected query'}</button></div>
  </div>
}
