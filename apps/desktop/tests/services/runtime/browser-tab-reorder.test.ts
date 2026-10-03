import { describe, expect, it } from 'vitest'
import type { QueryTabState, WorkspaceWindowState } from '@datapadplusplus/shared-types'
import { createBlankSnapshot } from '../../../src/app/data/workspace-factory'
import { normalizeWorkspaceWindows } from '../../../src/app/state/helpers'
import { reorderQueryTabsInSnapshot } from '../../../src/services/runtime/browser-tabs'
import { loadBrowserSnapshot, saveBrowserSnapshot } from '../../../src/services/runtime/browser-store'

function tab(id: string): QueryTabState {
  return { id, title: `Draft ${id}`, tabKind: 'query', connectionId: '', environmentId: `env-${id}`,
    family: 'sql', language: 'sql', editorLabel: 'SQL', queryText: 'select 42;',
    status: 'idle', dirty: true, pinned: true, history: [] }
}

function windowState(id: string, tabIds: string[]): WorkspaceWindowState {
  return { id, role: id === 'main' ? 'main' : 'editor', tabIds, activeTabId: tabIds.at(-1) ?? '' }
}

describe('persisted tab reordering', () => {
  it.each([false, true])('survives saving and reloading with multi-window enabled %s', (enabled) => {
    const snapshot = createBlankSnapshot()
    snapshot.preferences.multiWindowTabs = { enabled }
    snapshot.tabs = ['one', 'two', 'three'].map(tab)
    snapshot.ui.activeTabId = 'two'
    snapshot.ui.workspaceWindows = normalizeWorkspaceWindows(snapshot)
    const next = reorderQueryTabsInSnapshot(snapshot, { windowId: 'main', orderedTabIds: ['three', 'one', 'two'] })
    saveBrowserSnapshot(next)
    const reloaded = loadBrowserSnapshot()
    expect(reloaded.ui.workspaceWindows?.[0].tabIds).toEqual(['three', 'one', 'two'])
    expect(reloaded.ui.workspaceWindows?.[0].activeTabId).toBe('two')
    expect(next.ui.activeTabId).toBe('two')
    for (const original of snapshot.tabs) expect(next.tabs.find(item => item.id === original.id)).toEqual(original)
    expect(snapshot.tabs.map(item => item.id)).toEqual(['one', 'two', 'three'])
  })

  it('updates only the owning window and preserves every tab and selection', () => {
    const snapshot = createBlankSnapshot()
    snapshot.preferences.multiWindowTabs = { enabled: true }
    snapshot.tabs = ['one', 'two', 'three', 'four'].map(tab)
    snapshot.ui.activeTabId = 'two'
    snapshot.ui.workspaceWindows = [windowState('main', ['one', 'two']), windowState('editor-one', ['three', 'four'])]
    const originalWindows = normalizeWorkspaceWindows(snapshot)
    const main = reorderQueryTabsInSnapshot(snapshot, { windowId: 'main', orderedTabIds: ['two', 'one'] })
    const next = reorderQueryTabsInSnapshot(main, { windowId: 'editor-one', orderedTabIds: ['four', 'three'] })
    expect(normalizeWorkspaceWindows(next)).toEqual([
      { ...originalWindows[0], tabIds: ['two', 'one'] },
      { ...originalWindows[1], tabIds: ['four', 'three'] },
    ])
    expect(next.tabs).toEqual(snapshot.tabs)
    expect(next.ui.activeTabId).toBe('two')
  })

  it.each([
    ['main', ['one', 'one']], ['main', ['one']], ['main', ['one', 'missing']],
    ['main', ['one', 'three']], ['missing', ['one', 'two']],
  ])('rejects a stale or foreign order for %s: %s', (windowId, orderedTabIds) => {
    const snapshot = createBlankSnapshot()
    snapshot.preferences.multiWindowTabs = { enabled: true }
    snapshot.tabs = ['one', 'two', 'three'].map(tab)
    snapshot.ui.workspaceWindows = [windowState('main', ['one', 'two']), windowState('editor-one', ['three'])]
    expect(reorderQueryTabsInSnapshot(snapshot, { windowId, orderedTabIds })).toEqual(snapshot)
  })
})
