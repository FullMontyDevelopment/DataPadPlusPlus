import { describe, expect, it } from 'vitest'
import { createBlankSnapshot } from '../../../src/app/data/workspace-factory'
import { clientApiServer } from '../../../src/services/runtime/client-api-server'
import { loadBrowserSnapshot, saveBrowserSnapshot } from '../../../src/services/runtime/browser-store'

describe('clientApiServer browser preview', () => {
  it('persists settings but reports the listener as unsupported', async () => {
    const snapshot = createBlankSnapshot()
    snapshot.connections = [
      {
        id: 'conn-sqlite',
        name: 'Local SQLite',
        engine: 'sqlite',
        family: 'sql',
        host: 'local.db',
        database: 'local.db',
        environmentIds: ['env-local'],
        tags: [],
        favorite: false,
        readOnly: false,
        icon: 'SQ',
        auth: {},
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      },
    ]
    snapshot.environments = [
      {
        id: 'env-local',
        label: 'Local',
        color: '#3794ff',
        risk: 'low',
        variables: {},
        sensitiveKeys: [],
        variableDefinitions: [],
        requiresConfirmation: false,
        safeMode: false,
        exportable: true,
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      },
    ]
    saveBrowserSnapshot(snapshot)

    await clientApiServer.updateDatastoreApiServerSettings({
      enabled: true,
      host: '127.0.0.1',
      port: 17641,
      autoStart: true,
      connectionId: 'conn-sqlite',
      environmentId: 'env-local',
    })

    expect(loadBrowserSnapshot().preferences.datastoreApiServer).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 17641,
      autoStart: true,
      connectionId: 'conn-sqlite',
      environmentId: 'env-local',
      activeServerId: 'api-server-default',
      servers: [{
        id: 'api-server-default',
        name: 'Local API Server',
        host: '127.0.0.1',
        port: 17641,
        autoStart: true,
        connectionId: 'conn-sqlite',
        environmentId: 'env-local',
      }],
    })

    const status = await clientApiServer.startDatastoreApiServer({
      connectionId: 'conn-sqlite',
      environmentId: 'env-local',
      port: 17641,
    })

    expect(status.running).toBe(false)
    expect(status.baseUrl).toBe('http://127.0.0.1:17641')
    expect(status.servers).toHaveLength(1)
    expect(status.servers[0]).toMatchObject({
      id: 'api-server-default',
      port: 17641,
      connectionId: 'conn-sqlite',
      environmentId: 'env-local',
    })
    expect(status.message).toBe('The experimental API server can only run in the desktop app.')
    expect(status.warnings).toContain('Browser preview cannot open local listener ports.')

    const metrics = await clientApiServer.getDatastoreApiServerMetrics()
    expect(metrics.running).toBe(false)
    expect(metrics.totalRequests).toBe(0)
    expect(metrics.routes).toEqual([])

    const logs = await clientApiServer.getDatastoreApiServerLogs({ limit: 10 })
    expect(logs.running).toBe(false)
    expect(logs.entries).toEqual([])
  })
})
