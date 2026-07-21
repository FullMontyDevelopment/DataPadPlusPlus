import type { BootstrapPayload, QueryTabState, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({
  closeQueryTab: vi.fn(),
  saveQueryTabToLibrary: vi.fn(),
  saveQueryTabToLocalFile: vi.fn(),
}))

vi.mock('../../../src/services/runtime/client', () => ({ desktopClient: client }))

import { saveQueryTabToCurrentTarget } from '../../../src/app/state/app-actions-tabs-save'

describe('current Library query saves', () => {
  beforeEach(() => {
    client.closeQueryTab.mockReset()
    client.saveQueryTabToLibrary.mockReset()
    client.saveQueryTabToLocalFile.mockReset()
  })

  it('keeps the existing immediate parent during a current-target save', async () => {
    const payload = libraryPayload()
    client.saveQueryTabToLibrary.mockResolvedValue(payload)
    const applyPayload = vi.fn()

    await saveQueryTabToCurrentTarget({ payload, tabId: 'tab-query', applyPayload })

    expect(client.saveQueryTabToLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 'tab-query',
        itemId: 'library-query',
        folderId: 'folder-queries',
      }),
    )
    expect(applyPayload).toHaveBeenCalledWith(payload)
    expect(client.closeQueryTab).not.toHaveBeenCalled()
  })

  it('keeps the existing immediate parent when saving and closing', async () => {
    const payload = libraryPayload()
    client.saveQueryTabToLibrary.mockResolvedValue(payload)
    client.closeQueryTab.mockResolvedValue(payload)
    const applyPayload = vi.fn()

    await saveQueryTabToCurrentTarget({
      payload,
      tabId: 'tab-query',
      applyPayload,
      closeAfterSave: true,
    })

    expect(client.saveQueryTabToLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-queries' }),
    )
    expect(client.closeQueryTab).toHaveBeenCalledWith('tab-query')
    expect(client.saveQueryTabToLibrary.mock.invocationCallOrder[0]).toBeLessThan(
      client.closeQueryTab.mock.invocationCallOrder[0]!,
    )
    expect(applyPayload).toHaveBeenCalledWith(payload)
  })
})

function libraryPayload(): BootstrapPayload {
  const tab: QueryTabState = {
    id: 'tab-query',
    title: 'Customer lookup',
    connectionId: 'connection-mongo',
    environmentId: 'environment-prod',
    family: 'document',
    language: 'mongodb',
    editorLabel: 'MongoDB',
    queryText: '{ "collection": "customers" }',
    status: 'idle',
    dirty: true,
    history: [],
    saveTarget: { kind: 'library', libraryItemId: 'library-query' },
    savedQueryId: 'library-query',
  }
  const snapshot = {
    tabs: [tab],
    libraryNodes: [
      { id: 'folder-prod', kind: 'folder', name: 'PROD' },
      { id: 'connection-mongo-node', kind: 'connection', parentId: 'folder-prod', name: 'Mongo' },
      { id: 'folder-queries', kind: 'folder', parentId: 'connection-mongo-node', name: 'Queries' },
      {
        id: 'library-query',
        kind: 'query',
        parentId: 'folder-queries',
        name: 'Customer lookup',
      },
    ],
    lockState: { isLocked: false },
  } as WorkspaceSnapshot

  return { snapshot } as BootstrapPayload
}
