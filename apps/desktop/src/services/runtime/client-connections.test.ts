import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionProfile, EnvironmentProfile } from '@datapadplusplus/shared-types'
import { createBlankSnapshot } from '../../app/data/workspace-factory'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

describe('client connection command validation', () => {
  afterEach(() => {
    invoke.mockReset()
    window.localStorage.clear()
    delete window.__TAURI_INTERNALS__
    vi.resetModules()
  })

  it('allows connection strings with plaintext credentials through desktop commands', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValueOnce({ ok: true })
    const { clientConnections } = await import('./client-connections')

    await expect(clientConnections.upsertConnection({
      ...connectionProfile(),
      connectionString: 'mongodb://user:secret@localhost/catalog',
    })).resolves.toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledWith(
      'upsert_connection_profile',
      expect.objectContaining({
        profile: expect.objectContaining({
          connectionString: 'mongodb://user:secret@localhost/catalog',
        }),
      }),
    )
  })

  it('allows MongoDB Atlas native options with boolean TLS through desktop commands', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValueOnce({ ok: true })
    const { clientConnections } = await import('./client-connections')

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
    )
  })

  it('rejects plaintext secret environment variables before invoking desktop commands', async () => {
    window.__TAURI_INTERNALS__ = {}
    const { clientConnections } = await import('./client-connections')

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
  })

  it('does not resolve secret environment variables in browser preview connection tests', async () => {
    const { clientConnections } = await import('./client-connections')
    const { saveBrowserSnapshot } = await import('./browser-store')
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
  })
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
