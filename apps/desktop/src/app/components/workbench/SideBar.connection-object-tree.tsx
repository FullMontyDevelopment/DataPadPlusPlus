import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MouseEvent } from 'react'
import type {
  AdapterManifest,
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  MoreIcon,
  ObjectSearchIcon,
  PlayIcon,
  RefreshIcon,
} from './icons'
import {
  mongoObjectViewMenuLabel,
  mongoScopedQueryMenuLabel,
} from './MongoObjectViewDescriptors'
import {
  isOracleObjectViewKind,
  oracleObjectViewMenuLabel,
} from './OracleObjectViewDescriptors'
import {
  isRedisObjectViewKind,
  redisObjectViewMenuLabel,
} from './RedisObjectViewDescriptors'
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
  adapterManifest,
  environment,
  explorerNodes,
  explorerStatus = 'idle',
  isExplorerScopeLoading = () => false,
  nodes: nodesOverride,
  visualDepthOffset = 0,
  onLoadExplorerScope,
  onInspectNode,
  onOpenObjectView,
  onOpenScopedQuery,
}: {
  connection: ConnectionProfile
  adapterManifest?: AdapterManifest
  environment?: EnvironmentProfile
  explorerNodes?: ExplorerNode[]
  explorerStatus?: 'idle' | 'loading' | 'ready'
  isExplorerScopeLoading?(connectionId: string, scope?: string): boolean
  nodes?: ConnectionTreeNode[]
  visualDepthOffset?: number
  onLoadExplorerScope?(connectionId: string, scope?: string): void
  onInspectNode?(node: ExplorerNode): void
  onOpenObjectView?(connectionId: string, node: ExplorerNode): void
  onOpenScopedQuery(connectionId: string, target: ScopedQueryTarget): void
}) {
  const structuralNodes = useMemo(
    () => nodesOverride ?? buildConnectionObjectTree(connection, adapterManifest),
    [adapterManifest, connection, nodesOverride],
  )
  const liveNodes = useMemo(
    () =>
      explorerNodes
        ? buildConnectionObjectTreeFromExplorerNodes(connection, explorerNodes)
        : undefined,
    [connection, explorerNodes],
  )
  const usingLiveExplorer = explorerNodes !== undefined
  const nodes = useMemo(() => {
    if (!usingLiveExplorer) {
      return structuralNodes
    }

    if (shouldOverlayLiveExplorer(connection)) {
      return mergeConnectionTrees(structuralNodes, liveNodes ?? [])
    }

    return liveNodes ?? []
  }, [connection, liveNodes, structuralNodes, usingLiveExplorer])
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

    if (
      !hasAvailableObjectMenuItems(connection, node, {
        canInspectNode: Boolean(onInspectNode),
        canOpenObjectView: Boolean(onOpenObjectView),
        canRefreshNode: Boolean(onLoadExplorerScope),
      })
    ) {
      return
    }

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
  const inspectNode = (node: ConnectionTreeNode) => {
    onInspectNode?.(connectionTreeNodeToExplorerNode(connection, node))
  }
  const openObjectView = (node: ConnectionTreeNode) => {
    onOpenObjectView?.(connection.id, connectionTreeNodeToExplorerNode(connection, node))
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
          <div
            className="connection-object-empty"
            role="treeitem"
            aria-level={1}
            style={{ '--tree-depth': 1 + visualDepthOffset } as CSSProperties}
          >
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
            visualDepth={1 + visualDepthOffset}
            expandedNodes={expandedNodes}
            environment={environment}
            node={node}
            nodeKey={node.id}
            explorerStatus={explorerStatus}
            isExplorerScopeLoading={isExplorerScopeLoading}
            visibleChildCounts={visibleChildCounts}
            canInspectNode={Boolean(onInspectNode)}
            onContextMenu={openObjectContextMenu}
            onLoadExplorerScope={onLoadExplorerScope}
            onLoadMoreChildren={loadMoreChildren}
            onOpenObjectView={openObjectView}
            onOpenQuery={openNodeQuery}
            onToggleNode={toggleNode}
          />
        ))}
      </div>

      {contextMenu ? (
        <ConnectionObjectContextMenu
          canRefreshNodes={Boolean(onLoadExplorerScope)}
          connection={connection}
          expanded={Boolean(expandedNodes[contextMenu.nodeKey])}
          menu={contextMenu}
          onClose={() => setContextMenu(undefined)}
          onCopyName={copyNodeName}
          onInspectNode={onInspectNode ? inspectNode : undefined}
          onOpenObjectView={onOpenObjectView ? openObjectView : undefined}
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

function shouldOverlayLiveExplorer(connection: ConnectionProfile) {
  return connection.engine === 'redis' || connection.engine === 'valkey'
}

function mergeConnectionTrees(
  structuralNodes: ConnectionTreeNode[],
  liveNodes: ConnectionTreeNode[],
): ConnectionTreeNode[] {
  const merged = structuralNodes.map(cloneConnectionTreeNode)

  for (const liveNode of liveNodes) {
    const key = connectionTreeMergeKey(liveNode)
    const existingIndex = merged.findIndex(
      (node) => connectionTreeMergeKey(node) === key,
    )

    const existingNode = merged[existingIndex]
    if (existingIndex >= 0 && existingNode) {
      merged[existingIndex] = mergeConnectionTreeNode(
        existingNode,
        liveNode,
      )
    } else {
      merged.push(cloneConnectionTreeNode(liveNode))
    }
  }

  return merged
}

function mergeConnectionTreeNode(
  structuralNode: ConnectionTreeNode,
  liveNode: ConnectionTreeNode,
): ConnectionTreeNode {
  const children = mergeConnectionTrees(
    structuralNode.children ?? [],
    liveNode.children ?? [],
  )

  return {
    ...structuralNode,
    ...liveNode,
    children: children.length ? children : undefined,
  }
}

function cloneConnectionTreeNode(node: ConnectionTreeNode): ConnectionTreeNode {
  return {
    ...node,
    children: node.children?.map(cloneConnectionTreeNode),
  }
}

function connectionTreeMergeKey(node: ConnectionTreeNode) {
  return node.label.trim().toLowerCase()
}

function ConnectionObjectTreeNode({
  canInspectNode,
  connection,
  depth,
  visualDepth,
  expandedNodes,
  environment,
  node,
  nodeKey,
  explorerStatus,
  isExplorerScopeLoading,
  visibleChildCounts,
  onContextMenu,
  onLoadExplorerScope,
  onLoadMoreChildren,
  onOpenQuery,
  onOpenObjectView,
  onToggleNode,
}: {
  canInspectNode: boolean
  connection: ConnectionProfile
  depth: number
  visualDepth: number
  expandedNodes: Record<string, boolean>
  environment?: EnvironmentProfile
  explorerStatus: 'idle' | 'loading' | 'ready'
  isExplorerScopeLoading(connectionId: string, scope?: string): boolean
  node: ConnectionTreeNode
  nodeKey: string
  visibleChildCounts: Record<string, number>
  onContextMenu(event: MouseEvent<HTMLElement>, node: ConnectionTreeNode, nodeKey: string): void
  onLoadExplorerScope?(connectionId: string, scope?: string): void
  onLoadMoreChildren(nodeKey: string): void
  onOpenQuery(node: ConnectionTreeNode): void
  onOpenObjectView?(node: ConnectionTreeNode): void
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
  const loadingScope = node.scope ?? node.refreshScope
  const branchLoading = Boolean(
    loadingScope && isExplorerScopeLoading(connection.id, loadingScope),
  )
  const queryable = isScopedQueryable(node)
  const objectViewable = isObjectViewNode(connection, node)
  const hasObjectMenu = hasAvailableObjectMenuItems(connection, node, {
    canInspectNode,
    canOpenObjectView: Boolean(onOpenObjectView),
    canRefreshNode: Boolean(onLoadExplorerScope),
  })
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
    } else if (!canExpand && objectViewable) {
      onOpenObjectView?.(node)
    }
  }

  return (
    <>
      <div
        role="treeitem"
        tabIndex={canExpand || queryable || objectViewable ? 0 : undefined}
        aria-expanded={canExpand ? expanded : undefined}
        aria-level={depth}
        className={`tree-item connection-object-item${canExpand ? ' is-branch' : ''}${queryable || objectViewable ? ' is-queryable' : ''}${environment ? ' has-environment-accent' : ''}`}
        style={{ '--tree-depth': visualDepth, ...environmentStyle } as CSSProperties}
        title={objectNodeTitle(connection, node, queryable, objectViewable, canExpand)}
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
          } else if (objectViewable) {
            event.preventDefault()
            event.stopPropagation()
            onOpenObjectView?.(node)
          }
        }}
        onContextMenu={(event) => {
          if (hasObjectMenu) {
            onContextMenu(event, node, nodeKey)
          }
        }}
        onKeyDown={(event) => {
          if (canExpand && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            toggleNode()
          } else if (queryable && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            onOpenQuery(node)
          } else if (objectViewable && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            onOpenObjectView?.(node)
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
          <ExplorerNodeIcon
            connection={connection}
            expanded={expanded}
            kind={node.kind}
          />
        </span>
        <span className="tree-item-content">
          <strong>{node.label}</strong>
        </span>
        {branchLoading ? (
          <span
            className="connection-metadata-spinner"
            role="status"
            aria-label={`Loading metadata for ${node.label}`}
            title="Loading metadata"
          />
        ) : null}
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
        {hasObjectMenu ? (
          <button
            type="button"
            className="tree-item-action-menu"
            aria-label={`Object actions for ${node.label}`}
            title={`Object actions for ${node.label}`}
            onClick={(event) => openObjectMenuFromButton(event, node, nodeKey, onContextMenu)}
          >
            <MoreIcon className="tree-icon" />
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
                visualDepth={visualDepth + 1}
                expandedNodes={expandedNodes}
                environment={environment}
                explorerStatus={explorerStatus}
                isExplorerScopeLoading={isExplorerScopeLoading}
                node={child}
                nodeKey={childKey}
                visibleChildCounts={visibleChildCounts}
                canInspectNode={canInspectNode}
                onContextMenu={onContextMenu}
                onLoadExplorerScope={onLoadExplorerScope}
                onLoadMoreChildren={onLoadMoreChildren}
                onOpenObjectView={onOpenObjectView}
                onOpenQuery={onOpenQuery}
                onToggleNode={onToggleNode}
              />
            )
          })
        : null}
      {expanded && canLoadChildren && children.length === 0 && branchLoading ? (
        <div
          className="connection-object-empty"
          role="treeitem"
          aria-level={depth + 1}
          style={{ '--tree-depth': visualDepth + 1, ...environmentStyle } as CSSProperties}
        >
          Loading live metadata...
        </div>
      ) : null}
      {expanded && canLoadChildren && children.length === 0 && !branchLoading && explorerStatus === 'ready' ? (
        <div
          className="connection-object-empty"
          role="treeitem"
          aria-level={depth + 1}
          style={{ '--tree-depth': visualDepth + 1, ...environmentStyle } as CSSProperties}
        >
          No objects found.
        </div>
      ) : null}
      {expanded && remainingChildren > 0 ? (
        <button
          type="button"
          className="connection-object-load-more"
          style={{ '--tree-depth': visualDepth + 1, ...environmentStyle } as CSSProperties}
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

function openObjectMenuFromButton(
  event: MouseEvent<HTMLElement>,
  node: ConnectionTreeNode,
  nodeKey: string,
  onContextMenu: (event: MouseEvent<HTMLElement>, node: ConnectionTreeNode, nodeKey: string) => void,
) {
  event.preventDefault()
  event.stopPropagation()
  onContextMenu(event, node, nodeKey)
}

function isObjectViewNode(connection: ConnectionProfile, node: ConnectionTreeNode) {
  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return isRedisObjectViewNode(node)
  }

  if (connection.engine === 'oracle') {
    return isOracleObjectViewKind(node.kind)
  }

  return isMongoObjectViewNode(connection, node)
}

function isMongoObjectViewNode(connection: ConnectionProfile, node: ConnectionTreeNode) {
  if (connection.engine !== 'mongodb') {
    return false
  }

  return [
    'database',
    'collection',
    'view',
    'schema-preview',
    'indexes',
    'validation-rules',
    'collection-statistics',
    'database-statistics',
    'permissions',
    'scripts',
    'pipeline',
    'gridfs',
    'gridfs-buckets',
    'gridfs-bucket',
    'users',
    'roles',
    'search-indexes',
    'vector-indexes',
  ].includes(node.kind)
}

function isRedisObjectViewNode(node: ConnectionTreeNode) {
  return isRedisObjectViewKind(node.kind)
}

function ConnectionObjectContextMenu({
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
  const queryLabel = scopedQueryMenuLabel(connection, node.kind)
  const objectViewLabel = objectViewMenuLabel(connection, node.kind)
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
          <span>{queryLabel}</span>
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
          <span>{objectViewLabel}</span>
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

function hasAvailableObjectMenuItems(
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

function availableManagementActions(actions: ConnectionTreeAction[] | undefined) {
  return (actions ?? []).filter((action) => {
    if (action.command === 'open-template') {
      return Boolean(action.queryTemplate?.trim())
    }

    if (action.command === 'copy-qualified-name') {
      return true
    }

    return false
  })
}

function isDuplicatePrimaryMongoAction(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  queryable: boolean,
  action: ConnectionTreeAction,
) {
  if (connection.engine !== 'mongodb' || !queryable) {
    return false
  }

  if (['open-documents', 'sample-view', 'open-aggregation'].includes(action.id)) {
    return true
  }

  return action.label === mongoScopedQueryMenuLabel(node.kind)
}

function objectViewMenuLabel(connection: ConnectionProfile, kind: string | undefined) {
  if (connection.engine === 'mongodb') {
    return mongoObjectViewMenuLabel(kind)
  }

  if (connection.engine === 'oracle') {
    return oracleObjectViewMenuLabel(kind)
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return redisObjectViewMenuLabel(kind)
  }

  return 'Open View'
}

function scopedQueryMenuLabel(connection: ConnectionProfile, kind: string | undefined) {
  if (connection.engine === 'mongodb') {
    return mongoScopedQueryMenuLabel(kind)
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return 'Open Key Browser'
  }

  return 'Open Query'
}

function canRefreshTreeNode(node: ConnectionTreeNode) {
  return Boolean(node.scope || node.refreshScope)
}

function isInspectableTreeNode(node: ConnectionTreeNode) {
  return Boolean(node.scope || node.queryTemplate || node.refreshScope)
}

function connectionTreeNodeToExplorerNode(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
): ExplorerNode {
  return {
    id: node.id,
    family: connection.family,
    label: node.label,
    kind: node.kind,
    detail: node.detail ?? '',
    scope: node.scope,
    path: node.path,
    queryTemplate: node.queryTemplate,
    expandable: node.expandable,
  }
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

function objectNodeTitle(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  queryable: boolean,
  objectViewable: boolean,
  hasChildren: boolean,
) {
  const base = node.detail ? `${node.label}: ${node.detail}` : node.label

  if (objectViewable && !hasChildren) {
    return `${base}. Click to ${objectViewMenuLabel(connection, node.kind).toLowerCase()}.`
  }

  if (!queryable) {
    return base
  }

  if (hasChildren) {
    return `${base}. Right-click to open a scoped query.`
  }

  return `${base}. Click to open a scoped query.`
}
