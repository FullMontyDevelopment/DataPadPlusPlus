import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientTabs } from '../../../src/services/runtime/client-tabs'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

describe('client tab runtime', () => {
  afterEach(() => {
    invoke.mockReset()
    vi.restoreAllMocks()
    window.localStorage.clear()
    delete window.__TAURI_INTERNALS__
  })

  it('serializes atomic tab-close requests with the additive desktop command', async () => {
    window.__TAURI_INTERNALS__ = {}
    const response = {
      payload: { snapshot: { tabs: [] } },
      closedTabIds: ['tab-a'],
      lockedTabIds: ['tab-b'],
      missingTabIds: ['tab-c'],
    }
    invoke.mockResolvedValue(response)

    await expect(
      clientTabs.closeQueryTabs({ tabIds: ['tab-a', 'tab-b', 'tab-c'] }),
    ).resolves.toBe(response)

    expect(invoke).toHaveBeenCalledWith('close_query_tabs', {
      request: { tabIds: ['tab-a', 'tab-b', 'tab-c'] },
    })
  })

  it('serializes Cosmos query editor state without exposing a transport envelope', async () => {
    window.__TAURI_INTERNALS__ = {}
    const response = { snapshot: { tabs: [] } }
    invoke.mockResolvedValue(response)
    const request = {
      tabId: 'tab-cosmos',
      editorState: {
        kind: 'cosmos-sql' as const,
        sql: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{
          id: 'parameter-id',
          name: '@id',
          valueType: 'string' as const,
          value: 'order-1',
        }],
        source: 'custom' as const,
      },
      queryText: 'SELECT * FROM c WHERE c.id = @id',
      queryViewMode: 'raw' as const,
    }

    await expect(clientTabs.updateDatastoreQueryEditorState(request)).resolves.toBe(response)

    expect(invoke).toHaveBeenCalledWith('update_datastore_query_editor_state', { request })
    expect(JSON.stringify(invoke.mock.calls[0])).not.toContain('QueryDocuments')
  })

})
