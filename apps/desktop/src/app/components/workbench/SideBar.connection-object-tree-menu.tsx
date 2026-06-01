import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ObjectSearchIcon,
  PlayIcon,
  RefreshIcon,
} from './icons'
import {
  isObjectViewNode,
  objectViewMenuLabel,
  scopedQueryMenuLabel,
} from './SideBar.connection-object-tree-descriptors'
import { isScopedQueryable } from './SideBar.helpers'
import type { ConnectionTreeAction, ConnectionTreeNode } from './SideBar.helpers'
import {
  availableManagementActions,
  canRefreshTreeNode,
  isDuplicatePrimaryMongoAction,
  isInspectableTreeNode,
} from './SideBar.connection-object-tree-menu-helpers'

export interface ConnectionObjectContextMenuState {
  node: ConnectionTreeNode
  nodeKey: string
  x: number
  y: number
}

export function ConnectionObjectContextMenu({
  canRefreshNodes,
  connection,
  expanded,
  menu,
  onClose,
  onCopyName,
  onInspectNode,
  onOpenObjectView,
  onOpenQuery,
  onRefresh,
  onRunAction,
  onToggleNode,
}: {
  canRefreshNodes: boolean
  connection: ConnectionProfile
  expanded: boolean
  menu: ConnectionObjectContextMenuState
  onClose(): void
  onCopyName(node: ConnectionTreeNode): void
  onInspectNode?(node: ConnectionTreeNode): void
  onOpenObjectView?(node: ConnectionTreeNode): void
  onOpenQuery(node: ConnectionTreeNode): void
  onRefresh(node: ConnectionTreeNode): void
  onRunAction(node: ConnectionTreeNode, action: ConnectionTreeAction): void
  onToggleNode(nodeKey: string): void
}) {
  const { node } = menu
  const hasChildren = Boolean(node.children?.length || (node.expandable && node.scope))
  const queryable = isScopedQueryable(node)
  const objectViewable = isObjectViewNode(connection, node)
  const canOpenObjectView = objectViewable && Boolean(onOpenObjectView)
  const canInspect =
    Boolean(onInspectNode) &&
    (!objectViewable || !onOpenObjectView) &&
    isInspectableTreeNode(node)
  const canRefresh = canRefreshNodes && canRefreshTreeNode(node)
  const managementActions = availableManagementActions(node.actions)
    .filter((action) => !isDuplicatePrimaryMongoAction(connection, node, queryable, action))

  return (
    <div
      className="connection-context-menu"
      role="menu"
      aria-label={`Object options for ${node.label}`}
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {queryable ? (
        <button
          type="button"
          role="menuitem"
          className="connection-context-menu-item"
          onClick={() => {
            onOpenQuery(node)
            onClose()
          }}
        >
          <PlayIcon className="connection-context-menu-icon" />
          <span>{scopedQueryMenuLabel(connection, node.kind)}</span>
        </button>
      ) : null}

      {canOpenObjectView ? (
        <button
          type="button"
          role="menuitem"
          className="connection-context-menu-item"
          onClick={() => {
            onOpenObjectView?.(node)
            onClose()
          }}
        >
          <ObjectSearchIcon className="connection-context-menu-icon" />
          <span>{objectViewMenuLabel(connection, node.kind)}</span>
        </button>
      ) : null}

      {canInspect ? (
        <button
          type="button"
          role="menuitem"
          className="connection-context-menu-item"
          onClick={() => {
            onInspectNode?.(node)
            onClose()
          }}
        >
          <ObjectSearchIcon className="connection-context-menu-icon" />
          <span>Inspect</span>
        </button>
      ) : null}

      {hasChildren ? (
        <button
          type="button"
          role="menuitem"
          className="connection-context-menu-item"
          onClick={() => {
            onToggleNode(menu.nodeKey)
            onClose()
          }}
        >
          {expanded ? (
            <ChevronDownIcon className="connection-context-menu-icon" />
          ) : (
            <ChevronRightIcon className="connection-context-menu-icon" />
          )}
          <span>{expanded ? 'Collapse' : 'Expand'}</span>
        </button>
      ) : null}

      {queryable || canOpenObjectView || canInspect || hasChildren ? (
        <div className="connection-context-menu-separator" role="separator" />
      ) : null}

      {canRefresh ? (
        <button
          type="button"
          role="menuitem"
          className="connection-context-menu-item"
          onClick={() => {
            onRefresh(node)
            onClose()
          }}
        >
          <RefreshIcon className="connection-context-menu-icon" />
          <span>{refreshLabel(node)}</span>
        </button>
      ) : null}

      {managementActions.map((action) => (
        <MenuActionButton
          key={action.id}
          action={action}
          node={node}
          onClose={onClose}
          onRunAction={onRunAction}
        />
      ))}

      {managementActions.length ? (
        <div className="connection-context-menu-separator" role="separator" />
      ) : null}

      <button
        type="button"
        role="menuitem"
        className="connection-context-menu-item"
        onClick={() => {
          onCopyName(node)
          onClose()
        }}
      >
        <CopyIcon className="connection-context-menu-icon" />
        <span>Copy Name</span>
      </button>
    </div>
  )
}

function MenuActionButton({
  action,
  node,
  onClose,
  onRunAction,
}: {
  action: ConnectionTreeAction
  node: ConnectionTreeNode
  onClose(): void
  onRunAction(node: ConnectionTreeNode, action: ConnectionTreeAction): void
}) {
  return (
    <>
      {action.separatorBefore ? (
        <div className="connection-context-menu-separator" role="separator" />
      ) : null}
      <button
        type="button"
        role="menuitem"
        className="connection-context-menu-item"
        onClick={() => {
          onRunAction(node, action)
          onClose()
        }}
      >
        <span className="connection-context-menu-icon" aria-hidden="true" />
        <span>{action.label}</span>
      </button>
    </>
  )
}

function refreshLabel(node: ConnectionTreeNode) {
  if (node.category) {
    return `Refresh ${node.label}`
  }

  return `Refresh ${node.kind}`
}
