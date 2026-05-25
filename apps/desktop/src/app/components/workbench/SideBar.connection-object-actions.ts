import type { ConnectionTreeAction, ConnectionTreeNode } from './SideBar.helpers'

export function connectionTreeNodeForAction(
  node: ConnectionTreeNode,
  action: ConnectionTreeAction,
): ConnectionTreeNode {
  return {
    ...node,
    id: action.objectViewNodeId ?? node.id,
    label: action.objectViewLabel ?? action.label.replace(/\.\.\.$/, ''),
    kind: action.objectViewKind ?? node.kind,
    detail: undefined,
    path: action.objectViewPath ?? node.path,
    queryTemplate: undefined,
    queryable: false,
    expandable: false,
    children: undefined,
    actions: undefined,
  }
}
