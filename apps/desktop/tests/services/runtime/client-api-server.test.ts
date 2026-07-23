import { describe, expect, it } from 'vitest'
import type { ExplorerNode } from '@datapadplusplus/shared-types'
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
        name: 'Local API Server 17641',
        host: '127.0.0.1',
        port: 17641,
        autoStart: true,
        protocol: 'rest',
        basePath: '',
        connectionId: 'conn-sqlite',
        environmentId: 'env-local',
        resources: [],
        customEndpoints: [],
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
    expect(status.message).toBe('The API server can only run in the desktop app.')
    expect(status.warnings).toContain('Browser preview cannot open local listener ports.')

    const metrics = await clientApiServer.getDatastoreApiServerMetrics()
    expect(metrics.running).toBe(false)
    expect(metrics.totalRequests).toBe(0)
    expect(metrics.routes).toEqual([])

    const logs = await clientApiServer.getDatastoreApiServerLogs({ limit: 10 })
    expect(logs.running).toBe(false)
    expect(logs.entries).toEqual([])

    const exportCapabilities =
      await clientApiServer.getDatastoreApiServerProjectExportCapabilities({
        serverId: 'api-server-default',
      })
    expect(exportCapabilities.engine).toBe('sqlite')
    expect(exportCapabilities.frameworks).toEqual([
      expect.objectContaining({
        framework: 'rust',
        supported: true,
        client: 'SQLx / SQLite',
      }),
      expect.objectContaining({
        framework: 'dotnet',
        supported: true,
        client: 'Dapper / Microsoft.Data.Sqlite',
      }),
    ])

    await clientApiServer.deleteDatastoreApiServer({ serverId: 'api-server-default' })

    const deletedSnapshot = loadBrowserSnapshot().preferences.datastoreApiServer
    expect(deletedSnapshot?.activeServerId).toBeUndefined()
    expect(deletedSnapshot?.servers).toEqual([])

    const deletedStatus = await clientApiServer.getDatastoreApiServerStatus()
    expect(deletedStatus.activeServerId).toBeUndefined()
    expect(deletedStatus.servers).toEqual([])

    await expect(
      clientApiServer.exportDatastoreApiServerProjectFile({
        serverId: 'api-server-default',
        framework: 'rust',
        projectName: 'LocalApi',
      }),
    ).rejects.toThrow(/desktop app/)
  })

  it('discovers all saved query endpoints for the selected datastore connection', async () => {
    const snapshot = createBlankSnapshot()
    snapshot.connections = [
      {
        id: 'conn-sqlite',
        name: 'Local SQLite',
        engine: 'sqlite',
        family: 'sql',
        host: 'local.db',
        database: 'local.db',
        environmentIds: ['env-local', 'env-prod'],
        tags: [],
        favorite: false,
        readOnly: false,
        icon: 'SQ',
        auth: {},
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      },
    ]
    snapshot.preferences.datastoreApiServer = {
      enabled: true,
      host: '127.0.0.1',
      port: 17640,
      autoStart: false,
      activeServerId: 'api-server-default',
      servers: [{
        id: 'api-server-default',
        name: 'Local API Server',
        host: '127.0.0.1',
        port: 17640,
        autoStart: false,
        protocol: 'rest',
        basePath: '',
        connectionId: 'conn-sqlite',
        environmentId: 'env-local',
        resources: [],
        customEndpoints: [],
      }],
    }
    snapshot.libraryNodes = [
      savedQuery('library-any', 'Any users', 'conn-sqlite'),
      savedQuery('library-local', 'Local users', 'conn-sqlite', 'env-local'),
      savedQuery('library-prod', 'Prod users', 'conn-sqlite', 'env-prod'),
      savedQuery('library-other', 'Other datastore', 'conn-other'),
    ]
    saveBrowserSnapshot(snapshot)

    const response = await clientApiServer.discoverDatastoreApiServerQuerySources({
      serverId: 'api-server-default',
    })

    expect(response.sources.map((source) => source.id)).toEqual([
      'library-any',
      'library-local',
      'library-prod',
    ])
  })

  it('discovers and adds duplicate Mongo collection names from separate databases', async () => {
    const snapshot = createBlankSnapshot()
    snapshot.preferences.datastoreApiServer = {
      enabled: true,
      host: '127.0.0.1',
      port: 17640,
      autoStart: false,
      activeServerId: 'api-server-default',
      servers: [{
        id: 'api-server-default',
        name: 'Local API Server',
        host: '127.0.0.1',
        port: 17640,
        autoStart: false,
        protocol: 'rest',
        basePath: '',
        connectionId: 'conn-mongo',
        environmentId: 'env-local',
        resources: [],
        customEndpoints: [],
      }],
    }
    snapshot.explorerNodes = [
      mongoCollectionNode('db-sales-users', 'sales'),
      mongoCollectionNode('db-support-users', 'support'),
    ]
    saveBrowserSnapshot(snapshot)

    const discovered = await clientApiServer.discoverDatastoreApiServerResources({
      connectionId: 'conn-mongo',
      environmentId: 'env-local',
    })

    expect(discovered.resources).toHaveLength(2)
    expect(discovered.resources.map((resource) => resource.path)).toEqual([
      ['sales', 'Collections'],
      ['support', 'Collections'],
    ])
    expect(new Set(discovered.resources.map((resource) => resource.id)).size).toBe(2)

    await clientApiServer.addDatastoreApiServerResources({
      serverId: 'api-server-default',
      resources: discovered.resources,
    })

    const resources =
      loadBrowserSnapshot().preferences.datastoreApiServer?.servers[0]?.resources ?? []
    expect(resources.map((resource) => resource.endpointSlug)).toEqual(['users', 'users-2'])
    expect(resources.map((resource) => resource.path)).toEqual([
      ['sales', 'Collections'],
      ['support', 'Collections'],
    ])
  })

  it.each([
    ['mongodb', 'MongoDB Rust Driver', 'MongoDB.Driver'],
    ['dynamodb', 'AWS SDK for Rust / DynamoDB', 'AWS SDK for .NET / DynamoDB'],
  ])(
    'reports both framework adapters for %s project export',
    async (engine, rustClient, dotnetClient) => {
      const snapshot = createBlankSnapshot()
      snapshot.connections = [
        {
          id: `conn-${engine}`,
          name: engine,
          engine,
          family: engine === 'mongodb' ? 'document' : 'widecolumn',
          host: 'localhost',
          database: engine === 'mongodb' ? 'catalog' : undefined,
          environmentIds: ['env-local'],
          tags: [],
          favorite: false,
          readOnly: false,
          icon: 'DB',
          auth: {},
          createdAt: '2026-06-14T00:00:00.000Z',
          updatedAt: '2026-06-14T00:00:00.000Z',
        },
      ]
      snapshot.preferences.datastoreApiServer = {
        enabled: true,
        host: '127.0.0.1',
        port: 17641,
        autoStart: false,
        activeServerId: 'api-server-document',
        servers: [
          {
            id: 'api-server-document',
            name: 'Document API',
            host: '127.0.0.1',
            port: 17641,
            autoStart: false,
            protocol: 'rest',
            basePath: '',
            connectionId: `conn-${engine}`,
            environmentId: 'env-local',
            resources: [],
            customEndpoints: [],
          },
        ],
      }
      saveBrowserSnapshot(snapshot)

      const capabilities =
        await clientApiServer.getDatastoreApiServerProjectExportCapabilities({
          serverId: 'api-server-document',
        })

      expect(capabilities.frameworks).toEqual([
        expect.objectContaining({ framework: 'rust', supported: true, client: rustClient }),
        expect.objectContaining({ framework: 'dotnet', supported: true, client: dotnetClient }),
      ])
    },
  )
})

function savedQuery(
  id: string,
  name: string,
  connectionId: string,
  environmentId?: string,
) {
  return {
    id,
    kind: 'query' as const,
    name,
    tags: [],
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    connectionId,
    environmentId,
    language: 'sql' as const,
    queryText: 'select * from users where email = {{api.email}}',
    queryViewMode: 'raw' as const,
  }
}

function mongoCollectionNode(id: string, database: string): ExplorerNode {
  return {
    id,
    label: 'users',
    kind: 'collection',
    detail: 'collection',
    family: 'document',
    path: [database, 'Collections'],
    scope: `collection:${database}:users`,
    expandable: true,
  }
}
