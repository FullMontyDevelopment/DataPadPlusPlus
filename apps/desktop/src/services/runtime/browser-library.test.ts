import type {
  ConnectionProfile,
  QueryTabState,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  moveLibraryNode,
  openLibraryItem,
  saveQueryTabToLibrary,
  saveQueryTabToLocalFile,
  setLibraryNodeEnvironment,
} from './browser-library'
import { connectionLibraryNodeId } from './library-connection-helpers'

describe('browser Library runtime', () => {
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

  it('saves and reopens query builder filters with Library queries', () => {
    const snapshot = workspaceSnapshot()
    const builderState = {
      kind: 'mongo-find' as const,
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
        '{\n  "collection": "products",\n  "filter": {\n    "status": "active"\n  },\n  "limit": 20\n}',
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
        filters: [expect.objectContaining({ field: 'status', value: 'active' })],
      }),
    })

    saved.tabs = []
    const reopened = openLibraryItem(saved, 'library-query-1')

    expect(reopened.tabs[0]?.builderState).toMatchObject({
      kind: 'mongo-find',
      filters: [expect.objectContaining({ field: 'status', value: 'active' })],
    })
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
