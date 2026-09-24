import { afterEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_WORKSPACE_SCHEMA_VERSION } from '@datapadplusplus/shared-types'
import type { QueryTabState } from '@datapadplusplus/shared-types'
import { createBlankSnapshot } from '../../../src/app/data/workspace-factory'
import { clientWorkspace } from '../../../src/services/runtime/client-workspace'
import { initialState, reducer } from '../../../src/app/state/app-state-reducer'
import {
  createBrowserWorkspace,
  findConnection,
  findEnvironment,
  findTab,
  getBrowserWorkspaceSwitcherStatus,
  importBrowserWorkspace,
  loadBrowserSnapshot,
  normalizeUiStatePatch,
  renameBrowserWorkspace,
  saveBrowserSnapshot,
  setBrowserWorkspaceSwitcherEnabled,
  switchBrowserWorkspace,
  updateUiStateLocally,
} from '../../../src/services/runtime/browser-store'

describe('browser workspace storage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects a delayed dialog-open response after a newer close response', async () => {
    window.localStorage.clear()
    saveBrowserSnapshot(createBlankSnapshot())
    const opened = await clientWorkspace.updateUiState({ rightDrawer: 'connection' })
    const closed = await clientWorkspace.updateUiState({ rightDrawer: 'none' })
    expect(closed.snapshot.workspaceRevision).toBeGreaterThan(opened.snapshot.workspaceRevision ?? 0)
    const state = reducer(initialState, { type: 'COMMAND_SUCCESS', payload: closed })
    const stale = reducer(state, { type: 'COMMAND_SUCCESS', payload: opened })
    expect(stale.payload?.snapshot.ui.rightDrawer).toBe('none')
    expect(loadBrowserSnapshot().workspaceRevision).toBe(closed.snapshot.workspaceRevision)
  })

  it('upgrades schema 12, preserves a recovery copy, and updates registry summaries', () => {
    window.localStorage.clear()
    const original = createBlankSnapshot()
    original.schemaVersion = 12
    original.tabs.push({
      id: 'schema-draft', connectionId: '', environmentId: '', title: 'Draft',
      family: 'sql', language: 'sql', editorLabel: 'SQL', queryText: 'select 42;',
      status: 'idle', dirty: true, history: [],
    })
    const serialized = JSON.stringify(original)
    window.localStorage.setItem('datapadplusplus.workspace.v2', serialized)
    const loaded = loadBrowserSnapshot()
    expect(loaded.schemaVersion).toBe(CURRENT_WORKSPACE_SCHEMA_VERSION)
    expect(loaded.tabs.find(tab => tab.id === 'schema-draft')?.queryText).toBe('select 42;')
    const recoveryKey = 'datapadplusplus.workspace.snapshot.v1.default.schema-12-to-13.recovery'
    expect(JSON.parse(window.localStorage.getItem(recoveryKey)!)).toMatchObject({ schemaVersion: 12 })
    const recovery = window.localStorage.getItem(recoveryKey)
    saveBrowserSnapshot(loaded)
    loadBrowserSnapshot()
    expect(window.localStorage.getItem(recoveryKey)).toBe(recovery)
    expect(getBrowserWorkspaceSwitcherStatus().workspaces[0]?.schemaVersion).toBe(CURRENT_WORKSPACE_SCHEMA_VERSION)
  })

  it('does not replace a future workspace with a blank one during registry initialization', () => {
    window.localStorage.clear()
    const snapshot = createBlankSnapshot()
    snapshot.schemaVersion = CURRENT_WORKSPACE_SCHEMA_VERSION + 1
    const original = JSON.stringify(snapshot)
    window.localStorage.setItem('datapadplusplus.workspace.v2', original)
    expect(() => loadBrowserSnapshot()).toThrow('newer DataPad++ version')
    expect(window.localStorage.getItem('datapadplusplus.workspace.v2')).toBe(original)
    expect(window.localStorage.length).toBe(1)
  })

  it('leaves the original intact when migration recovery cannot be stored', () => {
    window.localStorage.clear()
    const snapshot = createBlankSnapshot()
    snapshot.schemaVersion = 12
    const original = JSON.stringify(snapshot)
    window.localStorage.setItem('datapadplusplus.workspace.v2', original)
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key.endsWith('.recovery')) throw new DOMException('Storage full', 'QuotaExceededError')
      setItem.call(this, key, value)
    })
    expect(() => loadBrowserSnapshot()).toThrow()
    expect(window.localStorage.getItem('datapadplusplus.workspace.v2')).toBe(original)
    expect(window.localStorage.getItem('datapadplusplus.workspaces.registry.v1')).toBeNull()
  })

  it('does not expose corrupt workspace contents through parse errors', () => {
    window.localStorage.clear()
    const privateText = 'mongodb://user:do-not-report@localhost'
    const corrupt = '{"connectionString":"' + privateText
    window.localStorage.setItem('datapadplusplus.workspace.v2', corrupt)
    expect(() => loadBrowserSnapshot()).toThrow('not valid JSON')
    try { loadBrowserSnapshot() } catch (error) {
      expect(String(error)).not.toContain(privateText)
      expect((error as Error).cause).toBeUndefined()
    }
    expect(window.localStorage.getItem('datapadplusplus.workspace.v2')).toBe(corrupt)
  })

  it('does not activate a future workspace during switching', () => {
    window.localStorage.clear()
    loadBrowserSnapshot()
    const second = createBrowserWorkspace({ name: 'Other workspace' })
    const secondId = getBrowserWorkspaceSwitcherStatus().activeWorkspaceId
    switchBrowserWorkspace({ workspaceId: 'default' })
    second.schemaVersion = CURRENT_WORKSPACE_SCHEMA_VERSION + 1
    const key = 'datapadplusplus.workspace.snapshot.v1.' + secondId
    const original = JSON.stringify(second)
    window.localStorage.setItem(key, original)
    expect(() => switchBrowserWorkspace({ workspaceId: secondId })).toThrow('newer DataPad++ version')
    expect(getBrowserWorkspaceSwitcherStatus().activeWorkspaceId).toBe('default')
    expect(window.localStorage.getItem(key)).toBe(original)
  })

  it('keeps active results in memory without writing them to browser storage', () => {
    const snapshot = createBlankSnapshot()
    const tab: QueryTabState = {
      id: 'tab-transient-result',
      title: 'MongoDB result',
      connectionId: 'conn-mongodb',
      environmentId: '',
      family: 'document',
      language: 'mongodb',
      editorLabel: 'MongoDB editor',
      queryText: '{}',
      status: 'success' as const,
      dirty: false,
      history: [],
    }
    snapshot.tabs.push(tab)
    tab.result = {
      id: 'result-transient',
      engine: 'mongodb',
      summary: '1 document',
      defaultRenderer: 'document',
      rendererModes: ['document'],
      payloads: [{
        renderer: 'document',
        documents: [{ _id: 'large-document', value: 'kept in memory' }],
      }],
      notices: [],
      executedAt: '2026-07-23T10:00:00.000Z',
      durationMs: 5,
    }

    saveBrowserSnapshot(snapshot)

    const stored = window.localStorage.getItem('datapadplusplus.workspace.v2') ?? ''
    expect(stored).not.toContain('result-transient')
    expect(stored).not.toContain('kept in memory')
    expect(
      loadBrowserSnapshot().tabs.find((item) => item.id === tab.id)?.result,
    ).toBe(tab.result)
  })

  it('keeps complete connection strings in memory without writing them to browser storage', () => {
    const snapshot = createBlankSnapshot()
    snapshot.connections = [
      {
        id: 'conn-secret',
        name: 'Secret connection',
        engine: 'mongodb',
        family: 'document',
        host: 'localhost',
        port: 27017,
        database: 'catalog',
        connectionString: 'mongodb://user:plain-secret@localhost:27017/catalog',
        connectionMode: 'connection-string',
        environmentIds: [],
        tags: [],
        favorite: false,
        readOnly: false,
        icon: 'mongodb',
        auth: {},
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
      {
        id: 'conn-placeholder',
        name: 'Placeholder connection',
        engine: 'sqlserver',
        family: 'sql',
        host: 'localhost',
        port: 1433,
        database: 'app',
        connectionString: 'Server=localhost;Password=${DB_PASSWORD};',
        environmentIds: [],
        tags: [],
        favorite: false,
        readOnly: false,
        icon: 'sqlserver',
        auth: {},
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
    ]

    saveBrowserSnapshot(snapshot)

    const stored = window.localStorage.getItem('datapadplusplus.workspace.v2') ?? ''
    expect(stored).not.toContain('plain-secret')
    expect(stored).not.toContain('Server=localhost;Password=')
    const storedSnapshot = JSON.parse(stored) as typeof snapshot
    expect(storedSnapshot.connections.find((connection) => connection.id === 'conn-secret')?.connectionMode)
      .toBe('connection-string')

    const loaded = loadBrowserSnapshot()
    expect(loaded.connections.find((connection) => connection.id === 'conn-secret')?.connectionString)
      .toBe('mongodb://user:plain-secret@localhost:27017/catalog')
    expect(loaded.connections.find((connection) => connection.id === 'conn-secret')?.connectionMode)
      .toBe('connection-string')
    expect(loaded.connections.find((connection) => connection.id === 'conn-placeholder')?.connectionString)
      .toBe('Server=localhost;Password=${DB_PASSWORD};')
    expect(loaded.connections.find((connection) => connection.id === 'conn-placeholder')?.connectionMode)
      .toBe('connection-string')
  })

  it('removes plaintext connection strings from old browser snapshots after loading them', () => {
    const snapshot = createBlankSnapshot()
    snapshot.schemaVersion = 12
    snapshot.connections = [
      {
        id: 'conn-old-secret',
        name: 'Old secret connection',
        engine: 'mongodb',
        family: 'document',
        host: 'localhost',
        port: 27017,
        database: 'catalog',
        connectionString: 'mongodb://user:old-secret@localhost:27017/catalog',
        connectionMode: 'connection-string',
        environmentIds: [],
        tags: [],
        favorite: false,
        readOnly: false,
        icon: 'mongodb',
        auth: {},
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
    ]
    window.localStorage.setItem('datapadplusplus.workspace.v2', JSON.stringify(snapshot))

    const loaded = loadBrowserSnapshot()

    expect(loaded.connections[0]?.connectionString)
      .toBe('mongodb://user:old-secret@localhost:27017/catalog')
    expect(loaded.connections[0]?.connectionMode).toBe('connection-string')
    expect(window.localStorage.getItem('datapadplusplus.workspace.v2') ?? '')
      .not.toContain('mongodb://user:old-secret')
    for (let index = 0; index < window.localStorage.length; index += 1) {
      expect(window.localStorage.getItem(window.localStorage.key(index)!) ?? '')
        .not.toContain('mongodb://user:old-secret')
    }
  })

  it('does not persist plaintext environment secret variables in browser storage', () => {
    const snapshot = createBlankSnapshot()
    snapshot.environments = [
      {
        id: 'env-qa',
        label: 'QA',
        color: '#78a6ff',
        risk: 'medium',
        variables: {
          API_TOKEN: 'plaintext-token',
          DB_HOST: 'localhost',
        },
        sensitiveKeys: ['API_TOKEN'],
        variableDefinitions: [
          {
            key: 'LEGACY_SECRET',
            kind: 'secret',
            value: 'legacy-plaintext-secret',
          },
        ],
        requiresConfirmation: false,
        safeMode: false,
        exportable: true,
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
    ]

    saveBrowserSnapshot(snapshot)

    const stored = window.localStorage.getItem('datapadplusplus.workspace.v2') ?? ''
    expect(stored).not.toContain('plaintext-token')
    expect(stored).not.toContain('legacy-plaintext-secret')

    const loaded = loadBrowserSnapshot()
    expect(loaded.environments[0]?.variables).toEqual({ DB_HOST: 'localhost' })
    expect(loaded.environments[0]?.sensitiveKeys).toEqual([
      'API_TOKEN',
      'LEGACY_SECRET',
    ])
    expect(loaded.environments[0]?.variableDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'API_TOKEN',
          kind: 'secret',
          value: undefined,
          secretRef: expect.objectContaining({
            account: 'environment:env-qa:API_TOKEN',
          }),
        }),
        expect.objectContaining({
          key: 'LEGACY_SECRET',
          kind: 'secret',
          value: undefined,
          secretRef: expect.objectContaining({
            account: 'environment:env-qa:LEGACY_SECRET',
          }),
        }),
      ]),
    )
  })

  it('does not silently fall back when ids are stale', () => {
    const snapshot = createBlankSnapshot()

    expect(findConnection(snapshot, 'missing-connection')).toBeUndefined()
    expect(findEnvironment(snapshot, 'missing-environment')).toBeUndefined()
    expect(findTab(snapshot, 'missing-tab')).toBeUndefined()
  })

  it('rounds fractional UI layout sizes before saving browser state', () => {
    const normalized = normalizeUiStatePatch({
      bottomPanelHeight: 806.4000244140625,
      sidebarWidth: 279.5,
      resultsSideWidth: 420.1,
      rightDrawerWidth: Number.NaN,
    })

    expect(normalized).toMatchObject({
      bottomPanelHeight: 806,
      sidebarWidth: 280,
      resultsSideWidth: 420,
    })
    expect(normalized).not.toHaveProperty('rightDrawerWidth')

    const snapshot = updateUiStateLocally(createBlankSnapshot(), {
      bottomPanelHeight: 806.4000244140625,
      sidebarWidth: 279.5,
    })

    expect(snapshot.ui.bottomPanelHeight).toBe(806)
    expect(snapshot.ui.sidebarWidth).toBe(280)
  })

  it('does not clear existing layout sizes when a UI patch omits them', () => {
    const snapshot = createBlankSnapshot()
    snapshot.ui.bottomPanelHeight = 320
    snapshot.ui.sidebarWidth = 300

    const next = updateUiStateLocally(snapshot, { explorerFilter: 'orders' })

    expect(next.ui.explorerFilter).toBe('orders')
    expect(next.ui.bottomPanelHeight).toBe(320)
    expect(next.ui.sidebarWidth).toBe(300)
  })

  it('migrates the legacy browser snapshot into a default workspace registry', () => {
    const snapshot = createBlankSnapshot()
    snapshot.libraryNodes.push(libraryFolder('folder-default', 'Default folder'))
    window.localStorage.setItem('datapadplusplus.workspace.v2', JSON.stringify(snapshot))

    const status = getBrowserWorkspaceSwitcherStatus()

    expect(status.enabled).toBe(false)
    expect(status.activeWorkspaceId).toBe('default')
    expect(status.workspaces).toHaveLength(1)
    expect(status.workspaces[0]).toMatchObject({
      id: 'default',
      name: 'Default Workspace',
      counts: {
        libraryItems: 1,
      },
    })
    expect(
      window.localStorage.getItem('datapadplusplus.workspace.snapshot.v1.default'),
    ).toContain('Default folder')
    expect(loadBrowserSnapshot().libraryNodes[0]?.name).toBe('Default folder')
  })

  it('saves, renames, and switches browser workspace snapshots', () => {
    const first = createBlankSnapshot()
    first.libraryNodes.push(libraryFolder('folder-first', 'First workspace'))
    saveBrowserSnapshot(first)
    setBrowserWorkspaceSwitcherEnabled({ enabled: true })

    createBrowserWorkspace({ name: 'Second workspace' })
    let status = getBrowserWorkspaceSwitcherStatus()
    const secondWorkspaceId = status.activeWorkspaceId
    expect(secondWorkspaceId).not.toBe('default')
    expect(loadBrowserSnapshot().libraryNodes).toHaveLength(0)

    const second = loadBrowserSnapshot()
    second.libraryNodes.push(libraryFolder('folder-second', 'Second workspace'))
    saveBrowserSnapshot(second)
    renameBrowserWorkspace({
      workspaceId: secondWorkspaceId,
      name: 'QA workspace',
    })

    switchBrowserWorkspace({ workspaceId: 'default' })
    expect(loadBrowserSnapshot().libraryNodes[0]?.name).toBe('First workspace')

    switchBrowserWorkspace({ workspaceId: secondWorkspaceId })
    expect(loadBrowserSnapshot().libraryNodes[0]?.name).toBe('Second workspace')
    status = getBrowserWorkspaceSwitcherStatus()
    expect(status.enabled).toBe(true)
    expect(
      status.workspaces.find((workspace) => workspace.id === secondWorkspaceId)?.name,
    ).toBe('QA workspace')
  })

  it('imports a named browser workspace and refreshes its active registry summary', () => {
    setBrowserWorkspaceSwitcherEnabled({ enabled: true })
    const imported = createBlankSnapshot()
    imported.connections.push({
      id: 'conn-imported',
      name: 'Imported database',
      engine: 'postgresql',
      family: 'sql',
      host: 'localhost',
      port: 5432,
      database: 'imported',
      environmentIds: [],
      tags: [],
      favorite: false,
      readOnly: false,
      icon: 'postgresql',
      auth: {},
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    })

    const result = importBrowserWorkspace(imported, 'Imported QA', true)

    expect(result.status.workspaces).toHaveLength(2)
    expect(result.status.activeWorkspaceId).not.toBe('default')
    expect(
      result.status.workspaces.find(
        (workspace) => workspace.id === result.status.activeWorkspaceId,
      ),
    ).toMatchObject({
      name: 'Imported QA',
      counts: { connections: 1 },
      schemaVersion: imported.schemaVersion,
    })
    expect(loadBrowserSnapshot().connections[0]?.name).toBe('Imported database')
  })
})

function libraryFolder(id: string, name: string) {
  return {
    id,
    kind: 'folder' as const,
    name,
    tags: [],
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  }
}
