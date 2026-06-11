import { describe, expect, it } from 'vitest'
import {
  DATASTORE_ENGINES,
  DATASTORE_FEATURE_BACKLOG,
  type ConnectionProfile,
  type DatastoreEngine,
  type DatastoreFamily,
  type WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import {
  createExplorerNodes,
  inspectExplorerNodeLocally,
} from '../../../../src/services/runtime/browser-explorer'
import {
  buildOperationManifestsForConnection,
  planOperationLocally,
} from '../../../../src/services/runtime/browser-operations'
import {
  runtimeSliceForEngine,
  runtimeSlices,
} from '../../../../src/services/runtime/datastores/registry'

describe('datastore runtime slice registry', () => {
  it('registers exactly one runtime slice for every declared datastore engine', () => {
    const registeredEngines = runtimeSlices.map((slice) => slice.engine)

    expect(new Set(registeredEngines).size).toBe(registeredEngines.length)
    expect([...registeredEngines].sort()).toEqual([...DATASTORE_ENGINES].sort())

    for (const engine of DATASTORE_ENGINES) {
      expect(runtimeSliceForEngine(engine)?.engine).toBe(engine)
    }
  })

  it('keeps every runtime slice wired to at least one runtime hook', () => {
    for (const slice of runtimeSlices) {
      const hookKeys = Object.keys(slice).filter((key) => key !== 'engine')

      expect(hookKeys, `${slice.engine} runtime slice should expose a runtime hook`).not.toEqual([])
    }
  })

  it('keeps every registered engine safe through common runtime entrypoints', () => {
    for (const entry of DATASTORE_FEATURE_BACKLOG) {
      const connection = connectionFor(entry.engine, entry.family, entry.defaultPort)
      const operations = buildOperationManifestsForConnection(connection)

      expect(operations.length, `${entry.engine} should expose operation manifests`).toBeGreaterThan(0)
      expect(() => createExplorerNodes(connection)).not.toThrow()
      expect(() => inspectExplorerNodeLocally(snapshotWith(connection), {
        connectionId: connection.id,
        environmentId: 'env-local',
        nodeId: `${entry.engine}:smoke`,
      })).not.toThrow()

      const [operation] = operations
      expect(() => planOperationLocally(snapshotWith(connection), {
        connectionId: connection.id,
        environmentId: 'env-local',
        operationId: operation.id,
        objectName: 'smoke_object',
        parameters: {},
      })).not.toThrow()
    }
  })
})

function connectionFor(
  engine: DatastoreEngine,
  family: DatastoreFamily,
  defaultPort?: number,
): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: `${engine} smoke connection`,
    engine,
    family,
    host: 'localhost',
    port: defaultPort,
    database: family === 'keyvalue' ? '0' : 'catalog',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function snapshotWith(connection: ConnectionProfile): WorkspaceSnapshot {
  return {
    connections: [connection],
    environments: [
      {
        id: 'env-local',
        name: 'Local',
        label: 'Local',
        risk: 'low',
        variables: {},
        sensitiveKeys: [],
        requiresConfirmation: false,
        safeMode: false,
        exportable: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    activeEnvironmentId: 'env-local',
    preferences: {
      theme: 'dark',
      telemetry: 'opt-in',
      lockAfterMinutes: 15,
      safeModeEnabled: false,
    },
  } as unknown as WorkspaceSnapshot
}
