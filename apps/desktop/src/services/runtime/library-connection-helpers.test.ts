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
  effectiveConnectionEnvironmentIds,
  ensureConnectionLibraryNodes,
} from './library-connection-helpers'

describe('Library connection helpers', () => {
  it('does not invent a default folder for fresh or root-level connections', () => {
    const snapshot = createBlankBootstrapPayload().snapshot
    const connection = createConnectionProfile('')

    expect(snapshot.libraryNodes).toEqual([])

    snapshot.connections.push(connection)
    ensureConnectionLibraryNodes(snapshot)

    expect(defaultLibraryFolderForConnection(snapshot, undefined)).toBeUndefined()
    expect(defaultLibraryFolderForConnection(snapshot, connection.id)).toBeUndefined()
  })

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

  it('resolves every Library row environment for a connection', () => {
    const snapshot = createBlankBootstrapPayload().snapshot
    const qa = createEnvironmentProfile()
    const prod = { ...createEnvironmentProfile(), id: 'env-prod', label: 'Prod' }
    const connection = createConnectionProfile('')

    snapshot.environments.push(qa, prod)
    snapshot.ui.activeEnvironmentId = snapshot.environments[0]?.id ?? ''
    snapshot.connections.push(connection)
    snapshot.libraryNodes.push(
      {
        id: 'folder-qa',
        kind: 'folder',
        name: 'QA',
        tags: [],
        environmentId: qa.id,
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
      {
        id: 'folder-prod',
        kind: 'folder',
        name: 'Prod',
        tags: [],
        environmentId: prod.id,
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
      {
        id: 'library-connection-qa',
        kind: 'connection',
        parentId: 'folder-qa',
        name: connection.name,
        tags: [],
        connectionId: connection.id,
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
      {
        id: 'library-connection-prod',
        kind: 'connection',
        parentId: 'folder-prod',
        name: connection.name,
        tags: [],
        connectionId: connection.id,
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
    )

    expect(effectiveConnectionEnvironmentIds(snapshot, connection)).toEqual([
      qa.id,
      prod.id,
    ])
  })
})
