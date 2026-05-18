import { describe, expect, it } from 'vitest'
import { createBlankBootstrapPayload } from '../../app/data/workspace-factory'
import {
  createConnectionProfile,
  createEnvironmentProfile,
} from '../../app/state/app-state-factories'
import {
  connectionLibraryNodeId,
  defaultLibraryFolderForConnection,
  effectiveConnectionEnvironmentId,
  ensureConnectionLibraryNodes,
} from './library-connection-helpers'

describe('Library connection helpers', () => {
  it('creates stable Library connection nodes and resolves inherited environments', () => {
    const snapshot = createBlankBootstrapPayload().snapshot
    const environment = createEnvironmentProfile()
    const connection = createConnectionProfile(environment.id)
    const folderId = 'folder-data-team'

    snapshot.environments.push(environment)
    snapshot.connections.push(connection)
    snapshot.libraryNodes.push({
      id: folderId,
      kind: 'folder',
      name: 'Data Team',
      tags: [],
      environmentId: environment.id,
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
    })

    ensureConnectionLibraryNodes(snapshot)
    const node = snapshot.libraryNodes.find(
      (candidate) => candidate.id === connectionLibraryNodeId(connection.id),
    )

    expect(node).toMatchObject({
      kind: 'connection',
      connectionId: connection.id,
      name: connection.name,
    })

    node!.parentId = folderId

    expect(defaultLibraryFolderForConnection(snapshot, connection.id)).toBe(folderId)
    expect(effectiveConnectionEnvironmentId(snapshot, connection)).toBe(environment.id)
  })
})
