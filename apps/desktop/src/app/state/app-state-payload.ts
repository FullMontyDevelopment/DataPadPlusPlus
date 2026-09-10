import { startTransition, type Dispatch } from 'react'
import type { BootstrapPayload } from '@datapadplusplus/shared-types'
import { createId } from './helpers'
import type { AppAction } from './app-state-types'

/** External window/MCP updates must never acknowledge or replace a local unsaved draft. */
export function preserveUnsavedDraftsOnExternalPayload(next: BootstrapPayload, previous?: BootstrapPayload) {
  if (!previous) return next
  const dirty = new Map(previous.snapshot.tabs.filter(tab => tab.dirty).map(tab => [tab.id, tab]))
  if (!dirty.size) return next
  return { ...next, snapshot: { ...next.snapshot, tabs: next.snapshot.tabs.map(tab => {
    const draft = dirty.get(tab.id)
    if (!draft) return tab
    return { ...tab, queryText: draft.queryText, scriptText: draft.scriptText,
      queryViewMode: draft.queryViewMode, builderState: draft.builderState, testSuite: draft.testSuite,
      dirty: true }
  }) } }
}

export function dispatchBootstrapPayload(
  dispatch: Dispatch<AppAction>,
  payload: BootstrapPayload,
) {
  startTransition(() => {
    dispatch({ type: 'COMMAND_SUCCESS', payload })
    if (payload.persistenceWarning) {
      dispatch({
        type: 'WORKBENCH_MESSAGE_ADDED',
        openMessages: false,
        message: {
          id: createId('message'),
          severity: 'warning',
          message: payload.persistenceWarning.message,
          source: 'Workspace persistence',
          createdAt: new Date().toISOString(),
          details: payload.persistenceWarning.code,
        },
      })
    }
  })
}
