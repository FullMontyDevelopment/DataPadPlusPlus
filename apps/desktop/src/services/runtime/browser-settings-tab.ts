import type { QueryTabState, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createId } from '../../app/state/helpers'
import { cloneSnapshot } from './browser-store'
import { upsertTab } from './browser-tabs'

export function createSettingsTabInSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const existingSettingsTab = next.tabs.find((tab) => tab.tabKind === 'settings')

  if (existingSettingsTab) {
    const focused = upsertTab(next, existingSettingsTab)
    focused.ui.activeActivity = 'library'
    focused.ui.activeSidebarPane = 'library'
    focused.ui.rightDrawer = 'none'
    return focused
  }

  const connection =
    next.connections.find((item) => item.id === next.ui.activeConnectionId) ?? next.connections[0]
  const environment =
    next.environments.find((item) => item.id === next.ui.activeEnvironmentId) ?? next.environments[0]
  const tab: QueryTabState = {
    id: createId('settings-tab'),
    title: 'Settings',
    tabKind: 'settings',
    connectionId: connection?.id ?? '',
    environmentId: environment?.id ?? '',
    family: connection?.family ?? 'sql',
    language: 'text',
    editorLabel: 'Settings',
    queryText: '',
    queryViewMode: undefined,
    scriptText: undefined,
    status: 'idle',
    dirty: false,
    history: [],
  }

  const focused = upsertTab(next, tab)
  focused.ui.activeActivity = 'library'
  focused.ui.activeSidebarPane = 'library'
  focused.ui.rightDrawer = 'none'
  return focused
}
