import { describe, expect, it } from 'vitest'
import {
  DATASTORE_FEATURE_BACKLOG,
  type ConnectionProfile,
  type DatastoreFeatureBacklogEntry,
  type ExplorerNode,
} from '@datapadplusplus/shared-types'
import { createExplorerNodes } from '../../../../../src/services/runtime/browser-explorer'
import {
  buildConnectionObjectTreeFromExplorerNodes,
  type ConnectionTreeNode,
} from '../../../../../src/app/components/workbench/SideBar.helpers'
import {
  isObjectViewNode,
  objectViewMenuLabel,
} from '../../../../../src/app/components/workbench/SideBar.connection-object-tree-descriptors'

describe('datastore workbench object-view routing', () => {
  it('recognizes object-view nodes produced by every runtime datastore slice', () => {
    for (const entry of DATASTORE_FEATURE_BACKLOG) {
      const connection = connectionFor(entry)
      const explorerNodes = collectPreviewExplorerNodes(connection)
      const treeNodes = flattenTreeNodes(
        buildConnectionObjectTreeFromExplorerNodes(connection, explorerNodes),
      )
      const routedNodes = treeNodes.filter((node) => isObjectViewNode(connection, node))

      expect(
        routedNodes.length,
        `${entry.engine} should expose at least one object-viewable preview node`,
      ).toBeGreaterThan(0)

      for (const node of routedNodes) {
        const menuLabel = objectViewMenuLabel(connection, node.kind)

        expect(
          menuLabel.trim().length,
          `${entry.engine}:${node.kind} should expose a non-empty object-view menu label`,
        ).toBeGreaterThan(0)
        expect(menuLabel, `${entry.engine}:${node.kind} should not use the generic fallback`).not.toBe(
          'Inspect Object',
        )
      }
    }
  })
})

function collectPreviewExplorerNodes(connection: ConnectionProfile): ExplorerNode[] {
  const collected: ExplorerNode[] = []
  const pendingScopes: Array<string | undefined> = [undefined]
  const visitedScopes = new Set<string>()

  while (pendingScopes.length > 0) {
    const scope = pendingScopes.shift()

    if (scope) {
      if (visitedScopes.has(scope)) continue
      visitedScopes.add(scope)
    }

    const nodes = createExplorerNodes(connection, scope)
    collected.push(...nodes)

    for (const node of nodes) {
      if (node.expandable && node.scope && !visitedScopes.has(node.scope)) {
        pendingScopes.push(node.scope)
      }
    }
  }

  return collected
}

function flattenTreeNodes(nodes: ConnectionTreeNode[]): ConnectionTreeNode[] {
  return nodes.flatMap((node) => [
    node,
    ...flattenTreeNodes(node.children ?? []),
  ])
}

function connectionFor(entry: DatastoreFeatureBacklogEntry): ConnectionProfile {
  return {
    id: `conn-${entry.engine}`,
    name: `${entry.displayName} preview connection`,
    engine: entry.engine,
    family: entry.family,
    host: 'localhost',
    port: entry.defaultPort,
    database: entry.family === 'keyvalue' ? '0' : 'catalog',
    connectionString: undefined,
    connectionMode: entry.connectionModes[0] ?? 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: entry.engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
