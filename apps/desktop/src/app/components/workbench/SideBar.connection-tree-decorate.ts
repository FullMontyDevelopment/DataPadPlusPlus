import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { managementActionsForNode } from './SideBar.datastore-tree-registry'
import type { ConnectionTreeNode } from './SideBar.connection-tree-types'

export function decorateTreeNodes(
  connection: ConnectionProfile,
  nodes: ConnectionTreeNode[],
  inheritedRefreshScope: string | undefined,
) {
  for (const node of nodes) {
    node.refreshScope ??= node.scope ?? inheritedRefreshScope
    node.actions = managementActionsForNode(connection, node)

    if (node.children?.length) {
      decorateTreeNodes(connection, node.children, node.scope ?? node.refreshScope)
    }
  }
}
