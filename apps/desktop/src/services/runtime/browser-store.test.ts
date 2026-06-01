import { describe, expect, it } from 'vitest'
import { createBlankSnapshot } from '../../app/data/workspace-factory'
import {
  findConnection,
  findEnvironment,
  findTab,
  loadBrowserSnapshot,
  saveBrowserSnapshot,
} from './browser-store'

describe('browser workspace storage', () => {
  it('does not persist plaintext secrets embedded in connection strings', () => {
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
    const storedSnapshot = JSON.parse(stored) as typeof snapshot
    expect(storedSnapshot.connections.find((connection) => connection.id === 'conn-secret')?.connectionMode)
      .toBe('native')

    const loaded = loadBrowserSnapshot()
    expect(loaded.connections.find((connection) => connection.id === 'conn-secret')?.connectionString)
      .toBeUndefined()
    expect(loaded.connections.find((connection) => connection.id === 'conn-secret')?.connectionMode)
      .toBe('native')
    expect(loaded.connections.find((connection) => connection.id === 'conn-placeholder')?.connectionString)
      .toBe('Server=localhost;Password={{DB_PASSWORD}};')
    expect(loaded.connections.find((connection) => connection.id === 'conn-placeholder')?.connectionMode)
      .toBe('connection-string')
  })

  it('removes plaintext secrets from old browser snapshots when loaded', () => {
    const snapshot = createBlankSnapshot()
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

    expect(loaded.connections[0]?.connectionString).toBeUndefined()
    expect(loaded.connections[0]?.connectionMode).toBe('native')
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
})
