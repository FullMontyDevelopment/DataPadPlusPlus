import type {
  ConnectionProfile,
  QueryTabState,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  duplicateLibraryNode,
  moveLibraryNode,
  openLibraryItem,
  saveQueryTabToLibrary,
  saveQueryTabToLocalFile,
  setLibraryNodeEnvironment,
} from '../../../src/services/runtime/browser-library'
import { connectionLibraryNodeId } from '../../../src/services/runtime/library-connection-helpers'

describe('browser Library runtime', () => {
  it('duplicates queries beside the source with collision-safe names', () => {
    const snapshot = workspaceSnapshot()
    snapshot.libraryNodes[0] = {
      ...snapshot.libraryNodes[0]!,
      parentId: 'folder-queries',
      name: 'Orders',
    }
    snapshot.libraryNodes.push(
      {
        ...snapshot.libraryNodes[0]!,
        id: 'library-copy-1',
        name: 'Copy of Orders',
      },
      {
        ...snapshot.libraryNodes[0]!,
        id: 'library-copy-2',
        name: 'Copy of Orders (2)',
      },
    )

    const next = duplicateLibraryNode(snapshot, { nodeId: 'library-query-1' })
    const duplicate = next.libraryNodes.at(-1)

    expect(duplicate).toMatchObject({
      kind: 'query',
      name: 'Copy of Orders (3)',
      parentId: 'folder-queries',
      queryText: snapshot.libraryNodes[0]?.queryText,
    })
    expect(duplicate?.id).not.toBe('library-query-1')
    expect(next.tabs).toEqual(snapshot.tabs)
  })

  it('rejects duplication for connections and folders', () => {
    const snapshot = workspaceSnapshot()
    snapshot.libraryNodes.push({
      id: 'folder-queries',
      kind: 'folder',
      name: 'Queries',
      tags: [],
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    })

    expect(() => duplicateLibraryNode(snapshot, { nodeId: 'folder-queries' })).toThrow(
      /queries and scripts/i,
    )
  })

  it('selects an already-open library item instead of opening a duplicate tab', () => {
    const snapshot = workspaceSnapshot()

    const next = openLibraryItem(snapshot, 'library-query-1')

    expect(next.tabs).toHaveLength(1)
    expect(next.ui.activeTabId).toBe('tab-existing')
    expect(next.ui.activeConnectionId).toBe('connection-1')
    expect(next.ui.activeEnvironmentId).toBe('environment-1')
  })

  it('sets and clears direct library environments', () => {
    const snapshot = workspaceSnapshot()
    snapshot.environments.push({
      id: 'environment-2',
      label: 'Prod',
      color: '#e06c75',
      risk: 'high',
      variables: {},
      sensitiveKeys: [],
      requiresConfirmation: true,
      safeMode: true,
      exportable: false,
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    })

    const assigned = setLibraryNodeEnvironment(snapshot, {
      nodeId: 'library-query-1',
      environmentId: 'environment-2',
    })

    expect(assigned.libraryNodes[0]?.environmentId).toBe('environment-2')

    const cleared = setLibraryNodeEnvironment(assigned, {
      nodeId: 'library-query-1',
      environmentId: undefined,
    })

    expect(cleared.libraryNodes[0]?.environmentId).toBeUndefined()
  })

  it('opens library items with the nearest parent environment', () => {
    const snapshot = workspaceSnapshot()
    snapshot.tabs = []
    snapshot.environments.push(
      {
        id: 'environment-1',
        label: 'Dev',
        color: '#2dbf9b',
        risk: 'low',
        variables: {},
        sensitiveKeys: [],
        requiresConfirmation: false,
        safeMode: false,
        exportable: true,
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
      {
        id: 'environment-2',
        label: 'Prod',
        color: '#e06c75',
        risk: 'high',
        variables: {},
        sensitiveKeys: [],
        requiresConfirmation: true,
        safeMode: true,
        exportable: false,
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    )
    snapshot.libraryNodes = [
      {
        id: 'folder-top',
        kind: 'folder',
        name: 'Top',
        tags: [],
        environmentId: 'environment-1',
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
      {
        id: 'folder-child',
        kind: 'folder',
        parentId: 'folder-top',
        name: 'Child',
        tags: [],
        environmentId: 'environment-2',
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
      {
        id: 'library-query-1',
        kind: 'query',
        parentId: 'folder-child',
        name: 'Orders',
        tags: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
        connectionId: 'connection-1',
        language: 'sql',
        queryText: 'select 1;',
      },
    ]

    const next = openLibraryItem(snapshot, 'library-query-1')

    expect(next.tabs[0]?.environmentId).toBe('environment-2')
  })

  it('does not open an explicit library query against the wrong connection when its connection is missing', () => {
    const snapshot = workspaceSnapshot()
    snapshot.tabs = []
    snapshot.connections = [
      {
        ...snapshot.connections[0]!,
        id: 'connection-other',
        name: 'Other datastore',
      },
    ]
    snapshot.ui.activeConnectionId = 'connection-other'

    const next = openLibraryItem(snapshot, 'library-query-1')

    expect(next.tabs).toHaveLength(0)
    expect(next.ui.activeConnectionId).toBe('connection-other')
  })

  it('saves and reopens query builder filters with Library queries', () => {
    const snapshot = workspaceSnapshot()
    const builderState = {
      kind: 'mongo-find' as const,
      database: 'catalog',
      collection: 'products',
      filters: [
        {
          id: 'filter-status',
          field: 'status',
          operator: 'eq' as const,
          value: 'active',
          valueType: 'string' as const,
        },
      ],
      projectionMode: 'all' as const,
      projectionFields: [],
      sort: [],
      limit: 20,
      lastAppliedQueryText:
        '{\n  "database": "catalog",\n  "collection": "products",\n  "filter": {\n    "status": "active"\n  },\n  "limit": 20\n}',
    }

    snapshot.connections[0] = {
      ...snapshot.connections[0]!,
      engine: 'mongodb',
      family: 'document',
    }
    snapshot.tabs[0] = {
      ...snapshot.tabs[0]!,
      family: 'document',
      language: 'mongodb',
      queryText: builderState.lastAppliedQueryText,
      builderState,
      scopedTarget: {
        kind: 'collection',
        label: 'products',
        path: ['Catalog Mongo', 'catalog', 'Collections'],
        scope: 'collection:catalog:products',
        preferredBuilder: 'mongo-find',
      },
      dirty: true,
    }

    const saved = saveQueryTabToLibrary(snapshot, {
      tabId: 'tab-existing',
      itemId: 'library-query-1',
      name: 'Products active',
      kind: 'query',
      tags: [],
    })

    expect(saved.libraryNodes[0]).toMatchObject({
      builderState: expect.objectContaining({
        kind: 'mongo-find',
        database: 'catalog',
        collection: 'products',
        filters: [expect.objectContaining({ field: 'status', value: 'active' })],
      }),
      scopedTarget: expect.objectContaining({
        scope: 'collection:catalog:products',
      }),
    })

    saved.tabs = []
    const reopened = openLibraryItem(saved, 'library-query-1')

    expect(reopened.tabs[0]?.builderState).toMatchObject({
      kind: 'mongo-find',
      database: 'catalog',
      collection: 'products',
      filters: [expect.objectContaining({ field: 'status', value: 'active' })],
    })
    expect(reopened.tabs[0]?.scopedTarget).toMatchObject({
      scope: 'collection:catalog:products',
    })
    expect(reopened.tabs[0]?.queryText).toContain('"database": "catalog"')
  })

  it('saves and reopens document efficiency mode with Library queries', () => {
    const snapshot = workspaceSnapshot()
    snapshot.connections[0] = {
      ...snapshot.connections[0]!,
      engine: 'mongodb',
      family: 'document',
    }
    snapshot.tabs[0] = {
      ...snapshot.tabs[0]!,
      family: 'document',
      language: 'mongodb',
      documentEfficiencyMode: true,
      dirty: true,
    }

    const saved = saveQueryTabToLibrary(snapshot, {
      tabId: 'tab-existing',
      itemId: 'library-query-1',
      name: 'Orders',
      kind: 'query',
      tags: [],
    })

    expect(saved.libraryNodes[0]?.documentEfficiencyMode).toBe(true)

    saved.tabs = []
    const reopened = openLibraryItem(saved, 'library-query-1')

    expect(reopened.tabs[0]?.documentEfficiencyMode).toBe(true)
  })

  it('keeps the open tab results when saving to the Library', () => {
    const snapshot = workspaceSnapshot()
    snapshot.tabs[0] = {
      ...snapshot.tabs[0]!,
      dirty: true,
      status: 'success',
      lastRunAt: '2026-05-14T12:00:00.000Z',
      result: {
        id: 'result-1',
        engine: 'postgresql',
        summary: '1 row',
        defaultRenderer: 'table',
        rendererModes: ['table'],
        payloads: [
          {
            renderer: 'table',
            columns: ['ok'],
            rows: [['1']],
          },
        ],
        notices: [],
        executedAt: '2026-05-14T12:00:00.000Z',
        durationMs: 6,
        truncated: false,
        rowLimit: 100,
      },
    }

    const saved = saveQueryTabToLibrary(snapshot, {
      tabId: 'tab-existing',
      itemId: 'library-query-1',
      name: 'Orders',
      kind: 'query',
      tags: [],
    })

    expect(saved.tabs[0]?.dirty).toBe(false)
    expect(saved.tabs[0]?.status).toBe('success')
    expect(saved.tabs[0]?.result?.summary).toBe('1 row')
    expect(saved.tabs[0]?.result?.payloads[0]).toMatchObject({
      renderer: 'table',
      rows: [['1']],
    })
    expect(saved.libraryNodes[0]).not.toHaveProperty('result')
  })

  it('preserves PROD/Mongo/Queries placement when resaving an existing query', () => {
    const snapshot = workspaceSnapshot()
    const timestamp = '2026-05-14T00:00:00.000Z'
    snapshot.libraryNodes = [
      {
        id: 'folder-prod',
        kind: 'folder',
        name: 'PROD',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'connection-mongo',
        kind: 'connection',
        parentId: 'folder-prod',
        name: 'Mongo',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        connectionId: 'connection-1',
      },
      {
        id: 'folder-queries',
        kind: 'folder',
        parentId: 'connection-mongo',
        name: 'Queries',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        ...snapshot.libraryNodes[0]!,
        parentId: 'folder-queries',
      },
    ]

    const firstSave = saveQueryTabToLibrary(snapshot, {
      tabId: 'tab-existing',
      itemId: 'library-query-1',
      folderId: 'folder-queries',
      name: 'Orders',
      kind: 'query',
    })
    firstSave.tabs[0]!.queryText = 'select 2;'
    firstSave.tabs[0]!.dirty = true

    const secondSave = saveQueryTabToLibrary(firstSave, {
      tabId: 'tab-existing',
      itemId: 'library-query-1',
      name: 'Orders',
      kind: 'query',
    })
    const savedItem = secondSave.libraryNodes.find((node) => node.id === 'library-query-1')

    expect(savedItem?.parentId).toBe('folder-queries')
    expect(savedItem?.queryText).toBe('select 2;')
    expect(secondSave.tabs[0]?.dirty).toBe(false)
  })

  it('honors explicit moves while defaulting new or stale item ids', () => {
    const snapshot = workspaceSnapshot()
    const timestamp = '2026-05-14T00:00:00.000Z'
    snapshot.libraryNodes.push(
      {
        id: 'folder-prod',
        kind: 'folder',
        name: 'PROD',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'folder-mongo',
        kind: 'folder',
        parentId: 'folder-prod',
        name: 'Mongo',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'folder-archive',
        kind: 'folder',
        parentId: 'folder-mongo',
        name: 'Archive',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: connectionLibraryNodeId('connection-1'),
        kind: 'connection',
        parentId: 'folder-mongo',
        name: 'Mongo',
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        connectionId: 'connection-1',
      },
    )

    const moved = saveQueryTabToLibrary(snapshot, {
      tabId: 'tab-existing',
      itemId: 'library-query-1',
      folderId: 'folder-archive',
      name: 'Orders',
      kind: 'query',
    })
    expect(moved.libraryNodes.find((node) => node.id === 'library-query-1')?.parentId).toBe(
      'folder-archive',
    )

    moved.tabs[0]!.saveTarget = undefined
    moved.tabs[0]!.savedQueryId = undefined
    const createdFromStaleId = saveQueryTabToLibrary(moved, {
      tabId: 'tab-existing',
      itemId: 'library-query-stale',
      name: 'New query',
      kind: 'query',
    })
    expect(
      createdFromStaleId.libraryNodes.find((node) => node.id === 'library-query-stale')?.parentId,
    ).toBe('folder-mongo')
  })

  it('keeps the open tab results when saving to a local file', () => {
    const snapshot = workspaceSnapshot()
    snapshot.tabs[0] = {
      ...snapshot.tabs[0]!,
      dirty: true,
      status: 'success',
      result: {
        id: 'result-1',
        engine: 'postgresql',
        summary: '1 row',
        defaultRenderer: 'table',
        rendererModes: ['table'],
        payloads: [
          {
            renderer: 'table',
            columns: ['ok'],
            rows: [['1']],
          },
        ],
        notices: [],
        executedAt: '2026-05-14T12:00:00.000Z',
        durationMs: 6,
        truncated: false,
        rowLimit: 100,
      },
    }

    const saved = saveQueryTabToLocalFile(snapshot, {
      tabId: 'tab-existing',
      path: 'C:\\temp\\orders.sql',
    })

    expect(saved.tabs[0]?.dirty).toBe(false)
    expect(saved.tabs[0]?.title).toBe('orders.sql')
    expect(saved.tabs[0]?.status).toBe('success')
    expect(saved.tabs[0]?.result?.summary).toBe('1 row')
  })

  it('repairs connection library nodes before moving a newly saved connection into a folder', () => {
    const snapshot = workspaceSnapshot()
    snapshot.libraryNodes = [
      {
        id: 'folder-data-team',
        kind: 'folder',
        name: 'Data Team',
        tags: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    ]

    const next = moveLibraryNode(snapshot, {
      nodeId: connectionLibraryNodeId('connection-1'),
      parentId: 'folder-data-team',
    })

    expect(
      next.libraryNodes.find(
        (node) => node.kind === 'connection' && node.connectionId === 'connection-1',
      ),
    ).toMatchObject({
      id: connectionLibraryNodeId('connection-1'),
      parentId: 'folder-data-team',
      name: 'Fixture PostgreSQL',
    })
  })
})

function workspaceSnapshot(): WorkspaceSnapshot {
  const connection: ConnectionProfile = {
    id: 'connection-1',
    name: 'Fixture PostgreSQL',
    engine: 'postgresql',
    family: 'sql',
    host: 'localhost',
    port: 5432,
    database: 'catalog',
    environmentIds: ['environment-1'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'postgresql',
    auth: {},
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  }
  const existingTab: QueryTabState = {
    id: 'tab-existing',
    title: 'Orders',
    connectionId: connection.id,
    environmentId: 'environment-1',
    family: connection.family,
    language: 'sql',
    editorLabel: 'SQL',
    queryText: 'select 1;',
    status: 'idle',
    dirty: false,
    history: [],
    saveTarget: { kind: 'library', libraryItemId: 'library-query-1' },
    savedQueryId: 'library-query-1',
  }

  return {
    schemaVersion: 3,
    connections: [connection],
    environments: [],
    tabs: [existingTab],
    closedTabs: [],
    libraryNodes: [
      {
        id: 'library-query-1',
        kind: 'query',
        parentId: 'library-root-queries',
        name: 'Orders',
        tags: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
        connectionId: connection.id,
        environmentId: 'environment-1',
        language: 'sql',
        queryText: 'select 1;',
      },
    ],
    savedWork: [],
    explorerNodes: [],
    adapterManifests: [],
    preferences: {
      theme: 'dark',
      telemetry: 'disabled',
      lockAfterMinutes: 0,
      safeModeEnabled: true,
    },
    guardrails: [],
    lockState: { isLocked: false },
    ui: {
      activeConnectionId: '',
      activeEnvironmentId: '',
      activeTabId: '',
      explorerFilter: '',
      explorerView: 'tree',
      connectionGroupMode: 'none',
      sidebarSectionStates: {},
      activeActivity: 'library',
      sidebarCollapsed: false,
      activeSidebarPane: 'library',
      sidebarWidth: 320,
      bottomPanelVisible: true,
      activeBottomPanelTab: 'results',
      bottomPanelHeight: 260,
      resultsDock: 'bottom',
      resultsSideWidth: 420,
      rightDrawer: 'none',
      rightDrawerWidth: 360,
    },
    updatedAt: '2026-05-14T00:00:00.000Z',
  }
}
