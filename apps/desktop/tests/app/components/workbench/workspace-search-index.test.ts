import { describe, expect, it } from 'vitest'
import type { WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createSeedSnapshot } from '../../../fixtures/seed-workspace'
import {
  buildWorkspaceSearchIndex,
  searchWorkspaceIndex,
} from '../../../../src/app/components/workbench/workspace-search-index'

function search(snapshot: WorkspaceSnapshot, query: string, options = {}) {
  return searchWorkspaceIndex(buildWorkspaceSearchIndex(snapshot), query, {
    matchCase: false,
    wholeWord: false,
    ...options,
  })
}

describe('workspace-search-index', () => {
  it('searches case-insensitively by default across connections, library nodes, and tabs', () => {
    const base = createSeedSnapshot()
    const snapshot = {
      ...base,
      libraryNodes: [
        {
          id: 'item-catalog',
          kind: 'query' as const,
          name: 'Catalog reconciliation',
          tags: [],
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          queryText: 'select * from catalog_items;',
        },
      ],
      tabs: [
        {
          ...base.tabs[0]!,
          id: 'tab-catalog',
          title: 'Catalog scratch',
          queryText: 'db.catalog.find({})',
        },
      ],
    }
    const result = search(snapshot, 'catalog')

    expect(result.totalMatches).toBeGreaterThan(0)
    expect(result.groups.some((group) => group.document.title === 'Catalog Mongo')).toBe(true)
    expect(result.groups.some((group) => group.document.sourceKind === 'library')).toBe(true)
    expect(result.groups.some((group) => group.document.sourceKind === 'tab')).toBe(true)
  })

  it('supports case-sensitive matching', () => {
    const snapshot = createSeedSnapshot()

    expect(search(snapshot, 'Catalog', { matchCase: true }).totalMatches).toBeGreaterThan(0)
    expect(search(snapshot, 'catalog mongo', { matchCase: true }).totalMatches).toBe(0)
  })

  it('supports whole-word matching', () => {
    const snapshot = {
      ...createSeedSnapshot(),
      connections: [],
      libraryNodes: [
        {
          id: 'item-word',
          kind: 'query' as const,
          name: 'Word query',
          tags: [],
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          queryText: 'select order_id from orders;\nselect preorders from queue;',
        },
      ],
      tabs: [],
      closedTabs: [],
    }

    const result = search(snapshot, 'order', { wholeWord: true })

    expect(result.totalMatches).toBe(0)
    expect(search(snapshot, 'orders', { wholeWord: true }).totalMatches).toBe(1)
  })

  it('filters matches by result type', () => {
    const base = createSeedSnapshot()
    const snapshot = {
      ...base,
      connections: [
        {
          ...base.connections[0]!,
          id: 'conn-filtered',
          name: 'Needle connection',
          database: 'needle',
        },
      ],
      libraryNodes: [
        {
          id: 'folder-filtered',
          kind: 'folder' as const,
          name: 'Needle folder',
          tags: [],
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'query-filtered',
          kind: 'query' as const,
          name: 'Needle query',
          tags: [],
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          queryText: 'select needle;',
        },
      ],
      tabs: [],
      closedTabs: [],
    }
    const result = searchWorkspaceIndex(buildWorkspaceSearchIndex(snapshot), 'needle', {
      matchCase: false,
      wholeWord: false,
      includedTypes: ['query'],
    })

    expect(result.groups.map((group) => group.document.resultType)).toEqual(['query'])
    expect(result.groups[0]?.document.title).toBe('Needle query')
  })

  it('returns line-level snippets with adjusted highlight offsets', () => {
    const snapshot = {
      ...createSeedSnapshot(),
      libraryNodes: [
        {
          id: 'item-snippet',
          kind: 'query' as const,
          name: 'Long query',
          tags: [],
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          queryText: `${'select customer_id, '.repeat(10)}from important_orders;`,
        },
      ],
      tabs: [],
      closedTabs: [],
      connections: [],
    }

    const [match] = search(snapshot, 'important_orders').groups[0]?.matches ?? []

    expect(match?.lineText).toContain('important_orders')
    expect(match?.lineText.slice(match.matchStart, match.matchEnd)).toBe('important_orders')
    expect(match?.lineText.length).toBeLessThan(match?.fullLineText.length ?? 0)
  })

  it('caps displayed matches while retaining the total match count', () => {
    const snapshot = {
      ...createSeedSnapshot(),
      libraryNodes: [
        {
          id: 'item-many',
          kind: 'query' as const,
          name: 'Many matches',
          tags: [],
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          queryText: Array.from({ length: 20 }, () => 'needle').join('\n'),
        },
      ],
      tabs: [],
      closedTabs: [],
      connections: [],
    }
    const result = searchWorkspaceIndex(buildWorkspaceSearchIndex(snapshot), 'needle', {
      matchCase: false,
      wholeWord: false,
      maxMatches: 5,
    })

    expect(result.totalMatches).toBe(20)
    expect(result.displayedMatches).toBe(5)
    expect(result.truncated).toBe(true)
    expect(result.groups.flatMap((group) => group.matches)).toHaveLength(5)
  })

  it('excludes auth, secrets, result payloads, and workspace-search tabs', () => {
    const snapshot = createSeedSnapshot()
    const tab = snapshot.tabs[0]!
    const next: WorkspaceSnapshot = {
      ...snapshot,
      tabs: [
        {
          ...tab,
          id: 'tab-result-secret',
          title: 'Visible query',
          result: {
            id: 'result-secret',
            engine: 'postgresql',
            summary: 'Hidden result',
            defaultRenderer: 'json',
            rendererModes: ['json'],
            payloads: [
              {
                renderer: 'json',
                value: { hidden: 'result-secret-value' },
              },
            ],
            notices: [],
            executedAt: '2026-06-01T00:00:00.000Z',
            durationMs: 1,
          },
        },
        {
          ...tab,
          id: 'tab-search',
          tabKind: 'workspace-search',
          title: 'Workspace Search',
          queryText: 'workspace-search-private-text',
        },
      ],
    }

    expect(search(next, 'secret-postgres-prod').totalMatches).toBe(0)
    expect(search(next, 'analytics-prod').totalMatches).toBe(0)
    expect(search(next, 'result-secret-value').totalMatches).toBe(0)
    expect(search(next, 'workspace-search-private-text').totalMatches).toBe(0)
  })
})
