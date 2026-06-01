import type {
  AdapterManifest,
  ConnectionProfile,
  DatastoreTreeManifest,
  DatastoreTreeNodeManifest,
} from '@datapadplusplus/shared-types'
import { normalizeExplorerKind } from './SideBar.datastore-tree-registry'
import { decorateTreeNodes } from './SideBar.connection-tree-decorate'
import { fallbackConnectionTree } from './SideBar.connection-tree-fallbacks'
import {
  manifestTreeNodeId,
  manifestTreeNodeQueryConfig,
  manifestTreeNodeScope,
  resolveManifestTreeLabel,
} from './SideBar.connection-tree-manifest'
import type { ConnectionTreeNode } from './SideBar.connection-tree-types'

export type { ConnectionTreeNode } from './SideBar.connection-tree-types'
export { buildConnectionObjectTreeFromExplorerNodes } from './SideBar.connection-tree-explorer'

export function buildConnectionObjectTree(
  connection: ConnectionProfile,
  adapterManifest?: AdapterManifest,
): ConnectionTreeNode[] {
  const tree = adapterManifest?.tree
    ? buildConnectionObjectTreeFromManifest(connection, adapterManifest.tree)
    : fallbackConnectionTree(connection)

  decorateTreeNodes(connection, tree, undefined)
  return tree
}

function buildConnectionObjectTreeFromManifest(
  connection: ConnectionProfile,
  treeManifest: DatastoreTreeManifest,
): ConnectionTreeNode[] {
  return treeManifest.roots.flatMap((node) =>
    connectionTreeNodeFromManifestNode(connection, node, []),
  )
}

function connectionTreeNodeFromManifestNode(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
  parentPath: string[],
): ConnectionTreeNode[] {
  if (manifestNode.optionalWhenLiveMetadata) {
    return []
  }

  if (manifestNode.hiddenWhenDatabaseSelected && connection.database?.trim()) {
    return []
  }

  const label = resolveManifestTreeLabel(connection, manifestNode)

  if (!label) {
    return []
  }

  const children = (manifestNode.children ?? []).flatMap((child) =>
    connectionTreeNodeFromManifestNode(connection, child, [...parentPath, label]),
  )
  const scope = manifestTreeNodeScope(connection, manifestNode, label, parentPath)
  const queryConfig = manifestTreeNodeQueryConfig(
    connection,
    manifestNode,
    label,
    parentPath,
  )

  return [
    {
      id: manifestTreeNodeId(connection, manifestNode, label, parentPath),
      label,
      kind: normalizeExplorerKind(connection, manifestNode.kind),
      detail: manifestNode.detail,
      scope,
      path: [...parentPath, label],
      category: true,
      expandable: children.length > 0 || Boolean(scope),
      children,
      ...queryConfig,
    },
  ]
}
