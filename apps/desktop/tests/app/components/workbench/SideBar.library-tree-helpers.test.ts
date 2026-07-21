import type { LibraryNode, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  libraryAncestorNodeIds,
  resolveActiveLibraryNodeId,
} from '../../../../src/app/components/workbench/SideBar.library-tree-helpers'

const nodes: LibraryNode[] = [
  libraryNode('folder-prod', 'folder', 'PROD'),
  libraryNode('connection-mongo-node', 'connection', 'MongoDB', 'folder-prod', {
    connectionId: 'connection-mongo',
  }),
  libraryNode('folder-mongo', 'folder', 'Mongo', 'connection-mongo-node'),
  libraryNode('folder-queries', 'folder', 'Queries', 'folder-mongo'),
  libraryNode('query-products', 'query', 'Products', 'folder-queries'),
  libraryNode('connection-mongo-copy', 'connection', 'MongoDB copy', undefined, {
    connectionId: 'connection-mongo',
  }),
]

describe('active Library node resolution', () => {
  it('prefers a saved query over its owning connection', () => {
    expect(
      resolveActiveLibraryNodeId(
        nodes,
        queryTab({
          saveTarget: { kind: 'library', libraryItemId: 'query-products' },
        }),
        'connection-mongo',
      ),
    ).toBe('query-products')
  })

  it('supports legacy savedQueryId tabs', () => {
    expect(
      resolveActiveLibraryNodeId(
        nodes,
        queryTab({ savedQueryId: 'query-products' }),
        'connection-mongo',
      ),
    ).toBe('query-products')
  })

  it('falls back to the first matching connection for unsaved or deleted queries', () => {
    expect(
      resolveActiveLibraryNodeId(
        nodes,
        queryTab({
          saveTarget: { kind: 'library', libraryItemId: 'deleted-query' },
        }),
        'connection-mongo',
      ),
    ).toBe('connection-mongo-node')

    expect(resolveActiveLibraryNodeId(nodes, undefined, 'connection-mongo')).toBe(
      'connection-mongo-node',
    )
  })

  it.each([
    'environment',
    'settings',
    'api-server',
    'mcp-server',
    'workspace-search',
    'security-checks',
  ] as const)('clears the highlight for the %s workspace', (tabKind) => {
    expect(
      resolveActiveLibraryNodeId(
        nodes,
        queryTab({ tabKind, savedQueryId: 'query-products' }),
        'connection-mongo',
      ),
    ).toBeUndefined()
  })

  it('does not use a connection fallback for an unsaved test suite', () => {
    expect(
      resolveActiveLibraryNodeId(
        nodes,
        queryTab({ tabKind: 'test-suite' }),
        'connection-mongo',
      ),
    ).toBeUndefined()
  })
})

describe('Library ancestors', () => {
  it('returns every ancestor without including the active node', () => {
    expect([...libraryAncestorNodeIds(nodes, 'query-products')]).toEqual([
      'folder-queries',
      'folder-mongo',
      'connection-mongo-node',
      'folder-prod',
    ])
  })

  it('stops safely when a parent cycle exists', () => {
    const cyclicNodes = [
      libraryNode('folder-a', 'folder', 'A', 'folder-b'),
      libraryNode('folder-b', 'folder', 'B', 'folder-a'),
      libraryNode('query-cycle', 'query', 'Cycle query', 'folder-a'),
    ]

    expect([...libraryAncestorNodeIds(cyclicNodes, 'query-cycle')]).toEqual([
      'folder-a',
      'folder-b',
    ])
  })
})

function queryTab(overrides: Partial<QueryTabState> = {}): QueryTabState {
  return {
    id: 'tab-query',
    title: 'Products',
    tabKind: 'query',
    connectionId: 'connection-mongo',
    environmentId: 'environment-local',
    family: 'document',
    language: 'mongodb',
    editorLabel: 'MongoDB',
    queryText: '{}',
    status: 'idle',
    dirty: false,
    history: [],
    ...overrides,
  }
}

function libraryNode(
  id: string,
  kind: LibraryNode['kind'],
  name: string,
  parentId?: string,
  overrides: Partial<LibraryNode> = {},
): LibraryNode {
  return {
    id,
    kind,
    name,
    parentId,
    tags: [],
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}
