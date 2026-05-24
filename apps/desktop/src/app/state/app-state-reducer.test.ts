import type { ExplorerResponse } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './app-state-reducer'

describe('app-state reducer explorer metadata cache', () => {
  it('keeps concurrent connection metadata isolated while scoped refreshes complete', () => {
    const mongoRoot = explorerResponse('connection-mongo', 'env-dev', [
      explorerNode('database:catalog', 'catalog', 'database', 'database:catalog'),
    ])
    const redisRoot = explorerResponse('connection-redis', 'env-dev', [
      explorerNode('prefix:orders:', 'orders:', 'prefix', 'prefix:orders:'),
    ])
    const mongoCollections = explorerResponse(
      'connection-mongo',
      'env-dev',
      [
        explorerNode(
          'collection:catalog.products',
          'products',
          'collection',
          'collection:catalog:products',
          ['catalog', 'Collections'],
        ),
      ],
      'database:catalog',
    )

    let state = reducer(initialState, {
      type: 'EXPLORER_LOADING',
      request: {
        connectionId: 'connection-mongo',
        environmentId: 'env-dev',
      },
      requestId: 'mongo-root-1',
    })

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: mongoRoot,
      requestId: 'mongo-root-1',
    })

    state = reducer(state, {
      type: 'EXPLORER_LOADING',
      request: {
        connectionId: 'connection-redis',
        environmentId: 'env-dev',
      },
      requestId: 'redis-root-1',
    })

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: redisRoot,
      requestId: 'redis-root-1',
    })

    state = reducer(state, {
      type: 'EXPLORER_LOADING',
      request: {
        connectionId: 'connection-mongo',
        environmentId: 'env-dev',
        scope: 'database:catalog',
      },
      requestId: 'mongo-scope-1',
    })

    expect(state.explorerCache?.['connection-redis::env-dev']?.response.nodes).toEqual(
      redisRoot.nodes,
    )
    expect(state.explorerLoadingRequests['connection-mongo::env-dev::database:catalog']).toBe(
      'mongo-scope-1',
    )

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: mongoCollections,
      requestId: 'mongo-scope-1',
    })

    expect(
      state.explorerCache?.['connection-mongo::env-dev']?.response.nodes.map((node) => node.id),
    ).toEqual(['database:catalog', 'collection:catalog.products'])
    expect(
      state.explorerCache?.['connection-redis::env-dev']?.response.nodes.map((node) => node.id),
    ).toEqual(['prefix:orders:'])
    expect(state.explorerLoadingRequests).toEqual({})
  })

  it('ignores stale explorer metadata responses for the same branch', () => {
    const oldRoot = explorerResponse('connection-mongo', 'env-dev', [
      explorerNode('database:old', 'old', 'database', 'database:old'),
    ])
    const freshRoot = explorerResponse('connection-mongo', 'env-dev', [
      explorerNode('database:fresh', 'fresh', 'database', 'database:fresh'),
    ])

    let state = reducer(initialState, {
      type: 'EXPLORER_LOADING',
      request: {
        connectionId: 'connection-mongo',
        environmentId: 'env-dev',
      },
      requestId: 'old-request',
    })

    state = reducer(state, {
      type: 'EXPLORER_LOADING',
      request: {
        connectionId: 'connection-mongo',
        environmentId: 'env-dev',
      },
      requestId: 'fresh-request',
    })

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: oldRoot,
      requestId: 'old-request',
    })

    expect(state.explorerCache).toBeUndefined()
    expect(state.explorerLoadingRequests['connection-mongo::env-dev::__root__']).toBe(
      'fresh-request',
    )

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: freshRoot,
      requestId: 'fresh-request',
    })

    expect(state.explorerCache?.['connection-mongo::env-dev']?.response.nodes[0]?.id).toBe(
      'database:fresh',
    )
    expect(state.explorerLoadingRequests).toEqual({})
  })

  it('records non-loading explorer errors such as failed object inspection', () => {
    const state = reducer(initialState, {
      type: 'EXPLORER_ERROR',
      request: {
        connectionId: 'connection-mongo',
        environmentId: 'env-dev',
      },
      message: 'Unable to inspect explorer object.',
    })

    expect(state.explorerError).toBe('Unable to inspect explorer object.')
    expect(state.explorerLoadingRequests).toEqual({})
  })
})

function explorerResponse(
  connectionId: string,
  environmentId: string,
  nodes: ExplorerResponse['nodes'],
  scope?: string,
): ExplorerResponse {
  return {
    connectionId,
    environmentId,
    scope,
    summary: `${connectionId} metadata`,
    capabilities: {
      canCancel: true,
      canExplain: false,
      supportsLiveMetadata: true,
      editorLanguage: 'sql',
      defaultRowLimit: 100,
    },
    nodes,
  }
}

function explorerNode(
  id: string,
  label: string,
  kind: string,
  scope: string,
  path?: string[],
): ExplorerResponse['nodes'][number] {
  return {
    id,
    label,
    kind,
    scope,
    path,
    family: 'document',
    detail: '',
  }
}
