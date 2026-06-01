import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { isScopedQueryable } from './SideBar.helpers'
import type { ConnectionTreeAction, ConnectionTreeNode } from './SideBar.helpers'
import {
  isObjectViewNode,
  scopedQueryMenuLabel,
} from './SideBar.connection-object-tree-descriptors'

export function hasAvailableObjectMenuItems(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  options: {
    canInspectNode: boolean
    canOpenObjectView: boolean
    canRefreshNode: boolean
  },
) {
  const objectViewable = isObjectViewNode(connection, node)

  return Boolean(
    isScopedQueryable(node) ||
      (objectViewable && options.canOpenObjectView) ||
      (options.canInspectNode && isInspectableTreeNode(node)) ||
      (options.canRefreshNode && canRefreshTreeNode(node)) ||
      availableManagementActions(node.actions).length,
  )
}

export function availableManagementActions(actions: ConnectionTreeAction[] | undefined) {
  return (actions ?? []).filter((action) => {
    if (action.command === 'open-template') {
      return Boolean(action.queryTemplate?.trim())
    }

    if (action.command === 'open-object-view') {
      return Boolean(action.objectViewNodeId && action.objectViewKind && action.objectViewLabel)
    }

    if (action.command === 'copy-qualified-name') {
      return true
    }

    return false
  })
}

export function isDuplicatePrimaryMongoAction(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  queryable: boolean,
  action: ConnectionTreeAction,
) {
  if (connection.engine !== 'mongodb' || !queryable) {
    return false
  }

  if (['open-documents', 'preview-view-results', 'open-aggregation'].includes(action.id)) {
    return true
  }

  return action.label === scopedQueryMenuLabel(connection, node.kind)
}

export function canRefreshTreeNode(node: ConnectionTreeNode) {
  return Boolean(node)
}

export function isInspectableTreeNode(node: ConnectionTreeNode) {
  return Boolean(node.scope || node.queryTemplate || node.refreshScope)
}
