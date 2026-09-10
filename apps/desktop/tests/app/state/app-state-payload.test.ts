import { describe, expect, it, vi } from 'vitest'
import { createBlankBootstrapPayload } from '../../../src/app/data/workspace-factory'
import { dispatchBootstrapPayload, preserveUnsavedDraftsOnExternalPayload } from '../../../src/app/state/app-state-payload'
import { createSeedBootstrapPayload } from '../../fixtures/seed-workspace'

describe('bootstrap payload application', () => {
  it('applies external Library edits to clean tabs while retaining unsaved drafts and ownership', () => {
    const previous = createSeedBootstrapPayload()
    previous.snapshot.tabs[0].dirty = true
    previous.snapshot.tabs[0].queryText = 'unsaved local SQL'
    const next = structuredClone(previous)
    next.snapshot.workspaceRevision = 42
    next.snapshot.tabs[0].queryText = 'MCP saved SQL'
    next.snapshot.tabs[0].dirty = false
    next.snapshot.tabs[1].queryText = 'updated clean SQL'
    next.snapshot.libraryNodes = [{ id: 'saved', kind: 'query', name: 'MCP library rename', tags: [], createdAt: '', updatedAt: '' }]
    const merged = preserveUnsavedDraftsOnExternalPayload(next, previous)
    expect(merged.snapshot.tabs[0].queryText).toBe('unsaved local SQL')
    expect(merged.snapshot.tabs[0].dirty).toBe(true)
    expect(merged.snapshot.tabs[1].queryText).toBe('updated clean SQL')
    expect(merged.snapshot.libraryNodes).toEqual(next.snapshot.libraryNodes)
    expect(merged.snapshot.workspaceWindows).toEqual(next.snapshot.workspaceWindows)
    expect(merged.snapshot.ui).toEqual(next.snapshot.ui)
    expect(next.snapshot.tabs[0].queryText).toBe('MCP saved SQL')
  })
  it('records persistence warnings without opening Messages', () => {
    const dispatch = vi.fn()
    const payload = createBlankBootstrapPayload()
    payload.persistenceWarning = {
      code: 'workspace-save-blocked',
      message: 'The tab closed, but the workspace file is temporarily in use.',
    }

    dispatchBootstrapPayload(dispatch, payload)

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'COMMAND_SUCCESS', payload })
    expect(dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'WORKBENCH_MESSAGE_ADDED',
      openMessages: false,
      message: expect.objectContaining({
        severity: 'warning',
        message: payload.persistenceWarning.message,
        details: payload.persistenceWarning.code,
      }),
    }))
  })

  it('does not create a warning for ordinary payloads', () => {
    const dispatch = vi.fn()
    const payload = createBlankBootstrapPayload()

    dispatchBootstrapPayload(dispatch, payload)

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith({ type: 'COMMAND_SUCCESS', payload })
  })
})
