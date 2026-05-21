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
      type: 'EXPLORER_READY',
      explorer: mongoRoot,
    })

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: redisRoot,
    })

    state = reducer(state, {
      type: 'EXPLORER_LOADING',
      request: {
        connectionId: 'connection-mongo',
        environmentId: 'env-dev',
        scope: 'database:catalog',
      },
    })

    expect(state.explorerCache?.['connection-redis::env-dev']?.response.nodes).toEqual(
      redisRoot.nodes,
    )
    expect(state.explorerLoadingRequests['connection-mongo::env-dev::database:catalog']).toBe(
      true,
    )

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: mongoCollections,
    })

    expect(
      state.explorerCache?.['connection-mongo::env-dev']?.response.nodes.map((node) => node.id),
    ).toEqual(['database:catalog', 'collection:catalog.products'])
    expect(
      state.explorerCache?.['connection-redis::env-dev']?.response.nodes.map((node) => node.id),
    ).toEqual(['prefix:orders:'])
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
