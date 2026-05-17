import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MouseEvent } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  PlayIcon,
  RefreshIcon,
} from './icons'
import {
  buildConnectionObjectTree,
  buildConnectionObjectTreeFromExplorerNodes,
  connectionTreeNodeTarget,
  environmentAccentVariables,
  isScopedQueryable,
} from './SideBar.helpers'
import { ExplorerNodeIcon } from './SideBar.node-icons'
import type { ConnectionTreeAction, ConnectionTreeNode } from './SideBar.helpers'

export const CONNECTION_OBJECT_CHILD_BATCH_SIZE = 100

export function ConnectionObjectTree({
  connection,
  environment,
  explorerNodes,
  explorerStatus = 'idle',
  nodes: nodesOverride,
  onLoadExplorerScope,
  onOpenScopedQuery,
}: {
  connection: ConnectionProfile
  environment?: EnvironmentProfile
  explorerNodes?: ExplorerNode[]
  explorerStatus?: 'idle' | 'loading' | 'ready'
  nodes?: ConnectionTreeNode[]
  onLoadExplorerScope?(connectionId: string, scope?: string): void
  onOpenScopedQuery(connectionId: string, target: ScopedQueryTarget): void
}) {
  const nodes = useMemo(
    () =>
      explorerNodes
        ? buildConnectionObjectTreeFromExplorerNodes(connection, explorerNodes)
        : nodesOverride ?? buildConnectionObjectTree(connection),
    [connection, explorerNodes, nodesOverride],
  )
  const usingLiveExplorer = Boolean(explorerNodes)
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({})
  const [visibleChildCounts, setVisibleChildCounts] = useState<Record<string, number>>({})
  const [contextMenu, setContextMenu] = useState<ConnectionObjectContextMenuState>()
  const toggleNode = (nodeKey: string) =>
    setExpandedNodes((current) => ({
      ...current,
      [nodeKey]: !current[nodeKey],
    }))
  const loadMoreChildren = (nodeKey: string) =>
    setVisibleChildCounts((current) => ({
      ...current,
      [nodeKey]:
        (current[nodeKey] ?? CONNECTION_OBJECT_CHILD_BATCH_SIZE) +
        CONNECTION_OBJECT_CHILD_BATCH_SIZE,
    }))
  const openNodeQuery = (node: ConnectionTreeNode) => {
    if (!isScopedQueryable(node)) {
      return
    }

    onOpenScopedQuery(connection.id, connectionTreeNodeTarget(node))
  }
  const openObjectContextMenu = (
    event: MouseEvent<HTMLElement>,
    node: ConnectionTreeNode,
    nodeKey: string,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      node,
      nodeKey,
      x: event.clientX,
      y: event.clientY,
    })
  }
  const copyNodeName = (node: ConnectionTreeNode) => {
    void navigator.clipboard?.writeText(node.label)
  }
  const refreshNode = (node: ConnectionTreeNode) => {
    onLoadExplorerScope?.(connection.id, node.scope ?? node.refreshScope)
  }
  const runNodeAction = (node: ConnectionTreeNode, action: ConnectionTreeAction) => {
    if (action.command === 'copy-qualified-name') {
      void navigator.clipboard?.writeText((node.path ?? []).concat(node.label).join('.'))
      return
    }

    if (action.command === 'open-template' && action.queryTemplate) {
      onOpenScopedQuery(connection.id, {
        ...connectionTreeNodeTarget(node),
        queryTemplate: action.queryTemplate,
      })
    }
  }

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const closeContextMenu = () => setContextMenu(undefined)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu()
      }
    }

    window.addEventListener('pointerdown', closeContextMenu)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', closeContextMenu)
    return () => {
      window.removeEventListener('pointerdown', closeContextMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', closeContextMenu)
    }
  }, [contextMenu])

  return (
    <>
      <div className="connection-object-tree" role="tree" aria-label={`${connection.name} objects`}>
        {usingLiveExplorer && nodes.length === 0 ? (
          <div className="connection-object-empty" role="treeitem" aria-level={1}>
            {explorerStatus === 'ready'
              ? 'No live metadata objects found.'
              : 'Loading live metadata...'}
          </div>
        ) : null}
        {nodes.map((node) => (
          <ConnectionObjectTreeNode
            key={node.id}
            connection={connection}
            depth={1}
            expandedNodes={expandedNodes}
            environment={environment}
            node={node}
            nodeKey={node.id}
            explorerStatus={explorerStatus}
            visibleChildCounts={visibleChildCounts}
            onContextMenu={openObjectContextMenu}
            onLoadExplorerScope={onLoadExplorerScope}
            onLoadMoreChildren={loadMoreChildren}
            onOpenQuery={openNodeQuery}
            onToggleNode={toggleNode}
          />
        ))}
      </div>

      {contextMenu ? (
        <ConnectionObjectContextMenu
          expanded={Boolean(expandedNodes[contextMenu.nodeKey])}
          menu={contextMenu}
          onClose={() => setContextMenu(undefined)}
          onCopyName={copyNodeName}
          onOpenQuery={openNodeQuery}
          onRefresh={refreshNode}
          onRunAction={runNodeAction}
          onToggleNode={toggleNode}
        />
      ) : null}
    </>
  )
}

interface ConnectionObjectContextMenuState {
  node: ConnectionTreeNode
  nodeKey: string
  x: number
  y: number
}

function ConnectionObjectTreeNode({
  connection,
  depth,
  expandedNodes,
  environment,
  node,
  nodeKey,
  explorerStatus,
  visibleChildCounts,
  onContextMenu,
  onLoadExplorerScope,
  onLoadMoreChildren,
  onOpenQuery,
  onToggleNode,
}: {
  connection: ConnectionProfile
  depth: number
  expandedNodes: Record<string, boolean>
  environment?: EnvironmentProfile
  explorerStatus: 'idle' | 'loading' | 'ready'
  node: ConnectionTreeNode
  nodeKey: string
  visibleChildCounts: Record<string, number>
  onContextMenu(event: MouseEvent<HTMLElement>, node: ConnectionTreeNode, nodeKey: string): void
  onLoadExplorerScope?(connectionId: string, scope?: string): void
  onLoadMoreChildren(nodeKey: string): void
  onOpenQuery(node: ConnectionTreeNode): void
  onToggleNode(nodeKey: string): void
}) {
  const children = node.children ?? []
  const visibleChildCount =
    visibleChildCounts[nodeKey] ?? CONNECTION_OBJECT_CHILD_BATCH_SIZE
  const visibleChildren = children.slice(0, visibleChildCount)
  const remainingChildren = Math.max(children.length - visibleChildren.length, 0)
  const environmentStyle = environmentAccentVariables(environment)
  const hasChildren = children.length > 0
  const canLoadChildren = Boolean(node.expandable && node.scope && onLoadExplorerScope)
  const canExpand = hasChildren || canLoadChildren
  const expanded = Boolean(expandedNodes[nodeKey])
  const queryable = isScopedQueryable(node)
  const toggleNode = () => {
    if (!canExpand) {
      return
    }

    const nextExpanded = !expanded
    onToggleNode(nodeKey)

    if (nextExpanded && canLoadChildren && children.length === 0) {
      onLoadExplorerScope?.(connection.id, node.scope)
    }
  }
  const openLeafQuery = () => {
    if (!canExpand && queryable) {
      onOpenQuery(node)
    }
  }

  return (
    <>
      <div
        role="treeitem"
        tabIndex={canExpand || queryable ? 0 : undefined}
        aria-expanded={canExpand ? expanded : undefined}
        aria-level={depth}
        className={`tree-item connection-object-item${canExpand ? ' is-branch' : ''}${queryable ? ' is-queryable' : ''}${environment ? ' has-environment-accent' : ''}`}
        style={{ '--tree-depth': depth, ...environmentStyle } as CSSProperties}
        title={objectNodeTitle(node, queryable, canExpand)}
        onClick={() => {
          if (canExpand) {
            toggleNode()
          } else {
            openLeafQuery()
          }
        }}
        onDoubleClick={(event) => {
          if (queryable) {
            event.preventDefault()
            event.stopPropagation()
            onOpenQuery(node)
          }
        }}
        onContextMenu={(event) => onContextMenu(event, node, nodeKey)}
        onKeyDown={(event) => {
          if (canExpand && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            toggleNode()
          } else if (queryable && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            onOpenQuery(node)
          }
        }}
      >
        {canExpand ? (
          <button
            type="button"
            className="tree-item-chevron tree-item-chevron-button"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`}
            title={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`}
            onClick={(event) => {
              event.stopPropagation()
              toggleNode()
            }}
          >
            {expanded ? (
              <ChevronDownIcon className="tree-icon" />
            ) : (
              <ChevronRightIcon className="tree-icon" />
            )}
          </button>
        ) : (
          <span className="tree-item-chevron">
            <span className="tree-icon tree-icon--spacer" />
          </span>
        )}
        <span className="tree-item-badge tree-item-badge--ghost">
          <ExplorerNodeIcon connection={connection} kind={node.kind} />
        </span>
        <span className="tree-item-content">
          <strong>{node.label}</strong>
          <span>
            {node.kind}
            {node.detail ? ` / ${node.detail}` : ''}
          </span>
        </span>
        {queryable ? (
          <button
            type="button"
            className="tree-item-action-hint"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onOpenQuery(node)
            }}
          >
            Query
          </button>
        ) : null}
      </div>

      {expanded
        ? visibleChildren.map((child) => {
            const childKey = `${nodeKey}/${child.id}`

            return (
              <ConnectionObjectTreeNode
                key={childKey}
                connection={connection}
                depth={depth + 1}
                expandedNodes={expandedNodes}
                environment={environment}
                explorerStatus={explorerStatus}
                node={child}
                nodeKey={childKey}
                visibleChildCounts={visibleChildCounts}
                onContextMenu={onContextMenu}
                onLoadExplorerScope={onLoadExplorerScope}
                onLoadMoreChildren={onLoadMoreChildren}
                onOpenQuery={onOpenQuery}
                onToggleNode={onToggleNode}
              />
            )
          })
        : null}
      {expanded && canLoadChildren && children.length === 0 && explorerStatus === 'loading' ? (
        <div
          className="connection-object-empty"
          role="treeitem"
          aria-level={depth + 1}
          style={{ '--tree-depth': depth + 1, ...environmentStyle } as CSSProperties}
        >
          Loading live metadata...
        </div>
      ) : null}
      {expanded && canLoadChildren && children.length === 0 && explorerStatus === 'ready' ? (
        <div
          className="connection-object-empty"
          role="treeitem"
          aria-level={depth + 1}
          style={{ '--tree-depth': depth + 1, ...environmentStyle } as CSSProperties}
        >
          No objects found.
        </div>
      ) : null}
      {expanded && remainingChildren > 0 ? (
        <button
          type="button"
          className="connection-object-load-more"
          style={{ '--tree-depth': depth + 1, ...environmentStyle } as CSSProperties}
          aria-label={`Load more ${node.label} items`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onLoadMoreChildren(nodeKey)
          }}
        >
          Load more
          <span>{Math.min(CONNECTION_OBJECT_CHILD_BATCH_SIZE, remainingChildren)} of {remainingChildren}</span>
        </button>
      ) : null}
    </>
  )
}

function ConnectionObjectContextMenu({
  expanded,
  menu,
  onClose,
  onCopyName,
  onOpenQuery,
  onRefresh,
  onRunAction,
  onToggleNode,
}: {
  expanded: boolean
  menu: ConnectionObjectContextMenuState
  onClose(): void
  onCopyName(node: ConnectionTreeNode): void
  onOpenQuery(node: ConnectionTreeNode): void
  onRefresh(node: ConnectionTreeNode): void
  onRunAction(node: ConnectionTreeNode, action: ConnectionTreeAction): void
  onToggleNode(nodeKey: string): void
}) {
  const { node } = menu
  const hasChildren = Boolean(node.children?.length || (node.expandable && node.scope))
  const queryable = isScopedQueryable(node)
  const managementActions = node.actions ?? []

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
          <span>Open Query</span>
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

      {queryable || hasChildren ? (
        <div className="connection-context-menu-separator" role="separator" />
      ) : null}

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

function objectNodeTitle(node: ConnectionTreeNode, queryable: boolean, hasChildren: boolean) {
  const base = node.detail ? `${node.label}: ${node.detail}` : node.label

  if (!queryable) {
    return base
  }

  if (hasChildren) {
    return `${base}. Right-click to open a scoped query.`
  }

  return `${base}. Click to open a scoped query.`
}
