import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionProfile, EnvironmentProfile } from '@datapadplusplus/shared-types'
import { createBlankSnapshot } from '../../../src/app/data/workspace-factory'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

describe('client connection command validation', () => {
  it('sends credential changes through the transactional connection editor command', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValueOnce({})
    const { clientConnections } = await import('../../../src/services/runtime/client-connections')
    const request = {
      profile: connectionProfile(), workspaceRevision: 7,
      secrets: [{ slot: 'auth.secretRef', action: 'replace' as const, value: ' exact fixture value ' }],
    }
    await clientConnections.saveConnectionEditor(request)
    expect(invoke).toHaveBeenCalledWith('save_connection_editor', { request })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('reveals only a selected saved slot rather than accepting vault coordinates', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValueOnce({ value: 'fixture' })
    const { clientConnections } = await import('../../../src/services/runtime/client-connections')
    const request = { connectionId: 'fixture', expectedUpdatedAt: 'version', workspaceRevision: 9, slot: 'auth.secretRef', confirmed: true }
    await clientConnections.revealConnectionSecret(request)
    expect(invoke).toHaveBeenCalledWith('reveal_connection_secret', { request })
  })

  it('never reports browser preview file creation as successful', async () => {
    const { clientExecution } = await import('../../../src/services/runtime/client-execution')
    await expect(clientExecution.pickLocalDatabaseFile({ engine: 'sqlite', purpose: 'create' })).resolves.toEqual({ canceled: true })
    await expect(clientExecution.createLocalDatabase({ engine: 'sqlite', path: 'fixture.sqlite', mode: 'empty' })).rejects.toThrow('requires the desktop application')
    expect(invoke).not.toHaveBeenCalled()
  })

  afterEach(() => {
    invoke.mockReset()
    window.localStorage.clear()
    delete window.__TAURI_INTERNALS__
    vi.resetModules()
  })

  it('allows connection strings with plaintext credentials through desktop commands', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValueOnce({ ok: true })
    const { clientConnections } = await import('../../../src/services/runtime/client-connections')

    await expect(clientConnections.upsertConnection({
      ...connectionProfile(),
      connectionString: 'mongodb://user:secret@localhost/catalog',
    })).resolves.toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledWith(
      'upsert_connection_profile',
      expect.objectContaining({
        request: expect.objectContaining({
          connectionString: 'mongodb://user:secret@localhost/catalog',
          profile: expect.objectContaining({ connectionString: undefined }),
        }),
      }),
    )
  }, 15000)

  it('allows MongoDB Atlas native options with boolean TLS through desktop commands', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValueOnce({ ok: true })
    const { clientConnections } = await import('../../../src/services/runtime/client-connections')

    await expect(clientConnections.upsertConnection({
      ...connectionProfile(),
      host: ' datapadplusplus.kkravqn.mongodb.net ',
      connectionMode: 'native',
      mongodbOptions: {
        connectionScheme: ' mongodb+srv ' as never,
        authSource: ' admin ',
        appName: ' DataPadPlusPlus ',
        tls: true,
      },
    })).resolves.toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledWith(
      'upsert_connection_profile',
      expect.objectContaining({
        request: expect.objectContaining({
          profile: expect.objectContaining({
            host: 'datapadplusplus.kkravqn.mongodb.net',
            mongodbOptions: expect.objectContaining({
              connectionScheme: 'mongodb+srv',
              authSource: 'admin',
              appName: 'DataPadPlusPlus',
              tls: true,
            }),
          }),
        }),
      }),
    )
  }, 15000)

  it('sends an exact multiline connection string outside the test profile', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValueOnce({ ok: true })
    const { clientConnections } = await import('../../../src/services/runtime/client-connections')
    const connectionString = 'Data Source=(DESCRIPTION=\n  (ADDRESS=(HOST=数据库))\n);Password=" p@ss ";'

    await clientConnections.testConnection({
      profile: { ...connectionProfile(), connectionString },
      environmentId: 'env-qa',
    })

    expect(invoke).toHaveBeenCalledWith('test_connection', {
      request: expect.objectContaining({
        connectionString,
        profile: expect.objectContaining({ connectionString: undefined }),
      }),
    })
  }, 15000)

  it('rejects plaintext secret environment variables before invoking desktop commands', async () => {
    window.__TAURI_INTERNALS__ = {}
    const { clientConnections } = await import('../../../src/services/runtime/client-connections')

    await expect(
      clientConnections.upsertEnvironment({
        ...environmentProfile(),
        variableDefinitions: [
          {
            key: 'API_TOKEN',
            kind: 'secret',
            value: 'plain-secret',
          },
        ],
      }),
    ).rejects.toThrow(/cannot store plaintext/)
    expect(invoke).not.toHaveBeenCalled()
  }, 15000)

  it('does not resolve secret environment variables in browser preview connection tests', async () => {
    const { clientConnections } = await import('../../../src/services/runtime/client-connections')
    const { saveBrowserSnapshot } = await import('../../../src/services/runtime/browser-store')
    const snapshot = createBlankSnapshot()
    snapshot.environments = [{
      ...environmentProfile(),
      variableDefinitions: [{
        key: 'DB_PASSWORD',
        kind: 'secret',
        secretRef: {
          id: 'secret-env-qa-db-password',
          provider: 'os-keyring',
          service: 'DataPad++',
          account: 'environment:env-qa:DB_PASSWORD',
          label: 'DB password',
        },
      }],
      sensitiveKeys: ['DB_PASSWORD'],
    }]
    saveBrowserSnapshot(snapshot)

    const result = await clientConnections.testConnection({
      environmentId: 'env-qa',
      profile: {
        ...connectionProfile(),
        host: '{{DB_PASSWORD}}',
      },
    })

    expect(result.ok).toBe(false)
    expect(result.message).toBe(
      'Preview connection test cannot resolve secret environment variables.',
    )
    expect(result.warnings).toEqual([
      'Secret variable DB_PASSWORD is resolved only by the desktop secret store.',
    ])
    expect(JSON.stringify(result)).not.toContain('plain-secret')
  }, 15000)
})

function connectionProfile(): ConnectionProfile {
  return {
    id: 'conn-1',
    name: 'MongoDB',
    engine: 'mongodb',
    family: 'document',
    host: 'localhost',
    environmentIds: ['env-qa'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'database',
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function environmentProfile(): EnvironmentProfile {
  return {
    id: 'env-qa',
    label: 'QA',
    color: '#8ab4f8',
    risk: 'medium',
    variables: {},
    sensitiveKeys: [],
    variableDefinitions: [],
    requiresConfirmation: false,
    safeMode: false,
    exportable: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
