import { describe, expect, it } from 'vitest'
import { createBlankBootstrapPayload } from '../../../src/app/data/workspace-factory'
import {
  createConnectionProfile,
  createEnvironmentProfile,
} from '../../../src/app/state/app-state-factories'
import {
  connectionLibraryNodeId,
  defaultLibraryFolderForConnection,
  effectiveConnectionEnvironmentId,
  effectiveConnectionEnvironmentIds,
  ensureConnectionLibraryNodes,
  tabEnvironmentConflict,
} from '../../../src/services/runtime/library-connection-helpers'
import { createQueryTabForConnection } from '../../../src/services/runtime/browser-tabs'

describe('Library connection helpers', () => {
  it('blocks mismatched inherited context but respects saved-query overrides and multi-environment rows', () => {
    const snapshot = createBlankBootstrapPayload().snapshot
    const uat = { ...createEnvironmentProfile(), id: 'uat', label: 'UAT' }
    const prod = { ...uat, id: 'prod', label: 'PROD' }
    snapshot.environments = [prod, uat]
    const connection = createConnectionProfile('prod')
    snapshot.connections = [connection]
    snapshot.ui.activeEnvironmentId = 'prod'
    ensureConnectionLibraryNodes(snapshot)
    const node = snapshot.libraryNodes[0]!
    node.environmentId = 'uat'
    const tab = createQueryTabForConnection(snapshot, connection, false)
    expect(tab.environmentId).toBe('uat')
    tab.environmentId = 'prod'
    expect(tabEnvironmentConflict(snapshot, tab)).toMatchObject({ environmentId: 'uat', label: 'UAT' })
    snapshot.libraryNodes.push({ ...node, id: 'saved-query', kind: 'query', environmentId: 'prod' })
    tab.savedQueryId = 'saved-query'
    expect(tabEnvironmentConflict(snapshot, tab)).toBeUndefined()
    tab.savedQueryId = undefined
    snapshot.libraryNodes.push({ ...node, id: 'second-connection-row', environmentId: 'prod' })
    expect(tabEnvironmentConflict(snapshot, tab)).toBeUndefined()
    snapshot.libraryNodes = []
    expect(tabEnvironmentConflict(snapshot, tab)).toBeUndefined()
    connection.environmentIds = ['uat']
    expect(tabEnvironmentConflict(snapshot, tab)).toMatchObject({ environmentId: 'uat' })
    connection.environmentIds = ['uat', 'prod']
    expect(tabEnvironmentConflict(snapshot, tab)).toBeUndefined()
  })
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
