import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_QUERY_RESULT_PREFERENCES } from '@datapadplusplus/shared-types'
import { createSeedSnapshot } from '../../fixtures/seed-workspace'
import { createQueryTabForConnection, createScopedQueryTabInSnapshot } from '../../../src/services/runtime/browser-tabs'
import { clientWorkspace } from '../../../src/services/runtime/client-workspace'
import { loadBrowserSnapshot, saveBrowserSnapshot } from '../../../src/services/runtime/browser-store'
import * as browserStore from '../../../src/services/runtime/browser-store'
import { initializeQueryLimit, removeQueryLimit } from '../../../../../packages/query-compiler/src/query-limit-settings'
import { createDefaultMongoFindBuilderState } from '../../../src/app/components/workbench/query-builder/mongo-find'

afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks() })

function fixture() {
  const snapshot = structuredClone(createSeedSnapshot())
  const connection = snapshot.connections.find(item => item.engine === 'mongodb')!
  connection.id = 'custom-limit-connection'
  const tab = createQueryTabForConnection(snapshot, connection, true)
  tab.queryViewMode = 'builder'
  tab.builderState = createDefaultMongoFindBuilderState('orders', 30)
  tab.queryText = JSON.stringify({ collection: 'orders', filter: {}, limit: 30 })
  snapshot.tabs.push(tab)
  return { snapshot, connection, tab }
}

describe('query limit settings runtime', () => {
  it.each(['datastore-default', 'limited', 'unlimited'] as const)('applies %s only on fresh builder creation', mode => {
    const { snapshot, connection } = fixture()
    snapshot.preferences.queryResults = { ...DEFAULT_QUERY_RESULT_PREFERENCES, newBuilderQueryLimit: mode === 'limited' ? { mode, value: 123 } : { mode } }
    const target = { kind: 'collection', label: 'new-items', path: ['catalog', 'Collections'], scope: 'collection:catalog:new-items', preferredBuilder: 'mongo-find' as const }
    const opened = createScopedQueryTabInSnapshot(snapshot, { connectionId: connection.id, target })
    const tab = opened.tabs.find(tab => tab.id === opened.ui.activeTabId)!
    expect(tab.builderState).toMatchObject({ limit: mode === 'limited' ? 123 : mode === 'unlimited' ? null : 20 })
    opened.preferences.queryResults!.newBuilderQueryLimit = { mode: 'limited', value: 456 }
    const reopened = createScopedQueryTabInSnapshot(opened, { connectionId: connection.id, target })
    expect(reopened.tabs.find(item => item.id === tab.id)).toEqual(tab)
    expect(reopened.tabs.slice(0, snapshot.tabs.length)).toEqual(snapshot.tabs)
  })

  it('leaves raw queries, scripts and native aggregation stages unchanged', () => {
    const { tab, connection } = fixture()
    const raw = { ...tab, queryViewMode: 'raw' as const }
    expect(initializeQueryLimit({ tab: raw, connection, policy: { mode: 'unlimited' } })).toBe(raw)
    expect(() => removeQueryLimit({ tab: raw, connection })).toThrow()
    const aggregation = { ...tab, builderState: { kind: 'mongo-aggregation' as const, collection: 'orders', stages: [{ id: 'limit', stage: '$limit', body: '7', enabled: true }], limit: 30, lastAppliedQueryText: '' } }
    const updated = removeQueryLimit({ tab: aggregation, connection })
    expect(updated.builderState).toMatchObject({ limit: null, stages: aggregation.builderState.stages })
    expect(JSON.parse(updated.queryText).pipeline).toContainEqual({ $limit: 7 })
    const legacy = { ...tab, builderState: undefined, queryText: JSON.stringify({ collection: 'orders', pipeline: [{ $limit: 7 }, { $sort: { date: 1 } }], limit: 30 }) }
    expect(JSON.parse(removeQueryLimit({ tab: legacy, connection }).queryText).pipeline).toEqual([{ $limit: 7 }, { $sort: { date: 1 } }])
  })

  it('updates only the selected query and preserves results, identity, drafts and workspace defaults', async () => {
    const { snapshot, connection, tab } = fixture()
    snapshot.ui.activeTabId = snapshot.tabs[0].id
    snapshot.ui.activeConnectionId = snapshot.connections.find(item => item.id !== connection.id)!.id
    tab.queryFetchBatchSize = 750
    saveBrowserSnapshot(snapshot)
    const before = structuredClone(loadBrowserSnapshot())
    const response = await clientWorkspace.setQueryTabResultSettings({ tabId: tab.id, expectedRevision: before.workspaceRevision!, fetchBatchSize: 1200, removeQueryLimit: true })
    const changed = response.snapshot.tabs.find(item => item.id === tab.id)!
    expect(changed).toMatchObject({ connectionId: connection.id, environmentId: tab.environmentId, queryFetchBatchSize: 1200, builderState: { limit: null }, dirty: true })
    expect(changed.result).toEqual(before.tabs.find(item => item.id === tab.id)?.result)
    expect(response.snapshot.tabs.filter(item => item.id !== tab.id)).toEqual(before.tabs.filter(item => item.id !== tab.id))
    expect(response.snapshot.preferences).toEqual(before.preferences)
    expect(response.snapshot.ui.activeTabId).toEqual(before.ui.activeTabId)
    const reset = await clientWorkspace.setQueryTabResultSettings({ tabId: tab.id, expectedRevision: response.snapshot.workspaceRevision!, removeQueryLimit: false })
    expect(reset.snapshot.tabs.find(item => item.id === tab.id)?.queryFetchBatchSize).toBeUndefined()
  })

  it.each(['stale', 'closed', 'running', 'queued', 'invalid-draft', 'other-window', 'invalid-batch'] as const)('rejects %s without mutating the query', async reason => {
    const { snapshot, tab } = fixture()
    if (reason === 'closed') snapshot.tabs = snapshot.tabs.filter(item => item.id !== tab.id)
    if (reason === 'running' || reason === 'queued') tab.status = reason
    if (reason === 'invalid-draft' && tab.builderState?.kind === 'mongo-find') tab.builderState.filters = [{ id: 'bad', field: 'n', operator: 'eq', valueType: 'number', value: 'bad' }]
    if (reason === 'other-window') {
      snapshot.preferences.multiWindowTabs = { enabled: true }
      snapshot.ui.workspaceWindows = [{ id: 'editor-other', role: 'editor', tabIds: [tab.id], activeTabId: tab.id, maximized: false }]
    }
    saveBrowserSnapshot(snapshot)
    if (reason === 'running' || reason === 'queued') {
      // Running state is deliberately not persisted; model the live runtime snapshot.
      const live = loadBrowserSnapshot()
      live.tabs.find(item => item.id === tab.id)!.status = reason
      vi.spyOn(browserStore, 'loadBrowserSnapshot').mockReturnValue(live)
    }
    const before = structuredClone(loadBrowserSnapshot())
    const error = await clientWorkspace.setQueryTabResultSettings({ tabId: tab.id, expectedRevision: before.workspaceRevision! - (reason === 'stale' ? 1 : 0), fetchBatchSize: reason === 'invalid-batch' ? 0 : 800, removeQueryLimit: true }).then(() => undefined, error => error)
    expect(error).toBeInstanceOf(Error)
    expect(loadBrowserSnapshot()).toEqual(before)
  })
})
