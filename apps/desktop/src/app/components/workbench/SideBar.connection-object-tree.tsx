import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DragEvent, MouseEvent } from 'react'
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
  MoreIcon,
} from './icons'
import {
  buildConnectionObjectTree,
  buildConnectionObjectTreeFromExplorerNodes,
  connectionTreeNodeTarget,
  environmentAccentVariables,
  isScopedQueryable,
} from './SideBar.helpers'
import { connectionTreeNodeForAction } from './SideBar.connection-object-actions'
import {
  ConnectionObjectContextMenu,
  type ConnectionObjectContextMenuState,
} from './SideBar.connection-object-tree-menu'
import { hasAvailableObjectMenuItems } from './SideBar.connection-object-tree-menu-helpers'
import {
  isObjectViewNode,
  objectNodeTitle,
} from './SideBar.connection-object-tree-descriptors'
import { ExplorerNodeIcon } from './SideBar.node-icons'
import type { ConnectionTreeAction, ConnectionTreeNode } from './SideBar.helpers'

export const CONNECTION_OBJECT_CHILD_BATCH_SIZE = 100
const CONNECTION_OBJECT_ROOT_PARENT_KEY = '__root__'

interface ConnectionObjectFolderDragState {
  parentNodeKey: string
  nodeKey: string
}

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
  onCreateApiServer,
  onAddToApiServer,
  onOpenObjectView,
  onOpenScopedQuery,
  explorerFolderOrders,
  onSetExplorerFolderOrder,
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
  onCreateApiServer?(connectionId: string, node: ExplorerNode): void
  onAddToApiServer?(connectionId: string, node: ExplorerNode): void
  onOpenObjectView?(connectionId: string, node: ExplorerNode): void
  onOpenScopedQuery(connectionId: string, target: ScopedQueryTarget): void
  explorerFolderOrders?: Record<string, string[]>
  onSetExplorerFolderOrder?(orderKey: string, orderedNodeKeys: string[]): void
}) {
  const environmentId = environment?.id ?? ''
  const structuralNodes = useMemo(
    () => nodesOverride ?? buildConnectionObjectTree(connection, adapterManifest),
    [adapterManifest, connection, nodesOverride],
  )
  const hasStructuralManifest = Boolean(nodesOverride || adapterManifest?.tree)
  const liveNodes = useMemo(
    () =>
      explorerNodes
        ? buildConnectionObjectTreeFromExplorerNodes(connection, explorerNodes)
        : undefined,
    [connection, explorerNodes],
  )
  const usingLiveExplorer = explorerNodes !== undefined
  const rawNodes = useMemo(() => {
    if (!usingLiveExplorer) {
      return structuralNodes
    }

    if (shouldOverlayLiveExplorer(connection, hasStructuralManifest)) {
      if ((liveNodes ?? []).length === 0) {
        return []
      }

      return mergeConnectionTrees(connection, structuralNodes, liveNodes ?? [])
    }

    return liveNodes ?? []
  }, [connection, hasStructuralManifest, liveNodes, structuralNodes, usingLiveExplorer])
  const nodes = useMemo(
    () =>
      orderConnectionTreeNodes(
        connection,
        environmentId,
        rawNodes,
        explorerFolderOrders,
      ),
    [connection, environmentId, explorerFolderOrders, rawNodes],
  )
  const environmentStyle = environmentAccentVariables(environment)
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({})
  const [visibleChildCounts, setVisibleChildCounts] = useState<Record<string, number>>({})
  const [contextMenu, setContextMenu] = useState<ConnectionObjectContextMenuState>()
  const [draggedFolder, setDraggedFolder] = useState<ConnectionObjectFolderDragState>()
  const [folderDropTarget, setFolderDropTarget] = useState<string>()
  const autoLoadedScopesRef = useRef(new Set<string>())
  const rootOrderableNodeKeys = useMemo(
    () => folderOrderableNodeKeys(connection, nodes, CONNECTION_OBJECT_ROOT_PARENT_KEY),
    [connection, nodes],
  )
  const toggleNode = (nodeKey: string) =>
    setExpandedNodes((current) => ({
      ...current,
      [nodeKey]: !current[nodeKey],
    }))
  const requestAutoLoadScope = useCallback(
    (scope: string | undefined) => {
      if (!scope || !onLoadExplorerScope) {
        return
      }

      const key = `${connection.id}::${environmentId}::${scope}`
      if (autoLoadedScopesRef.current.has(key)) {
        return
      }

      autoLoadedScopesRef.current.add(key)
      onLoadExplorerScope(connection.id, scope)
    },
    [connection.id, environmentId, onLoadExplorerScope],
  )
  const loadMoreChildren = (nodeKey: string) =>
    setVisibleChildCounts((current) => ({
      ...current,
      [nodeKey]:
        (current[nodeKey] ?? CONNECTION_OBJECT_CHILD_BATCH_SIZE) +
        CONNECTION_OBJECT_CHILD_BATCH_SIZE,
    }))
  const setFolderOrder = useCallback(
    (parentNodeKey: string, orderedNodeKeys: string[]) => {
      onSetExplorerFolderOrder?.(
        explorerFolderOrderKey(connection.id, environmentId, parentNodeKey),
        orderedNodeKeys,
      )
    },
    [connection.id, environmentId, onSetExplorerFolderOrder],
  )
  const beginFolderDrag = useCallback((parentNodeKey: string, nodeKey: string) => {
    setDraggedFolder({ parentNodeKey, nodeKey })
    setFolderDropTarget(undefined)
  }, [])
  const clearFolderDrag = useCallback(() => {
    setDraggedFolder(undefined)
    setFolderDropTarget(undefined)
  }, [])
  const dragFolderOver = useCallback(
    (parentNodeKey: string, nodeKey: string) => {
      if (draggedFolder?.parentNodeKey !== parentNodeKey || draggedFolder.nodeKey === nodeKey) {
        return
      }

      setFolderDropTarget(nodeKey)
    },
    [draggedFolder],
  )
  const dropFolderNode = useCallback(
    (
      parentNodeKey: string,
      sourceNodeKey: string,
      targetNodeKey: string,
      siblingOrderKeys: string[],
      placement: 'before' | 'after',
    ) => {
      if (
        draggedFolder?.parentNodeKey !== parentNodeKey ||
        !siblingOrderKeys.includes(sourceNodeKey) ||
        !siblingOrderKeys.includes(targetNodeKey)
      ) {
        clearFolderDrag()
        return
      }

      const nextOrder = moveNodeKey(
        siblingOrderKeys,
        sourceNodeKey,
        targetNodeKey,
        placement,
      )
      clearFolderDrag()

      if (nextOrder.join('\u001f') !== siblingOrderKeys.join('\u001f')) {
        setFolderOrder(parentNodeKey, nextOrder)
      }
    },
    [clearFolderDrag, draggedFolder, setFolderOrder],
  )
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
        canCreateApiServer: Boolean(onCreateApiServer),
        canAddToApiServer: Boolean(onAddToApiServer),
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

    if (action.command === 'open-object-view') {
      openObjectView(connectionTreeNodeForAction(node, action))
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
  const createApiServer = (node: ConnectionTreeNode) => {
    onCreateApiServer?.(connection.id, connectionTreeNodeToExplorerNode(connection, node))
  }
  const addToApiServer = (node: ConnectionTreeNode) => {
    onAddToApiServer?.(connection.id, connectionTreeNodeToExplorerNode(connection, node))
  }

  useEffect(() => {
    autoLoadedScopesRef.current.clear()
  }, [connection.id, environmentId])

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
        {usingLiveExplorer && nodes.length === 0 && explorerStatus === 'ready' ? (
          <div
            className={`connection-object-empty${environment ? ' has-environment-accent' : ''}`}
            role="treeitem"
            aria-level={1}
            style={{ '--tree-depth': 1 + visualDepthOffset, ...environmentStyle } as CSSProperties}
          >
            No live metadata objects found.
          </div>
        ) : null}
        {nodes.map((node) => {
          const nodeKey = connectionTreeNodeKey(connection, node)

          return (
            <ConnectionObjectTreeNode
              key={nodeKey}
              connection={connection}
              depth={1}
              visualDepth={1 + visualDepthOffset}
              expandedNodes={expandedNodes}
              environment={environment}
              node={node}
              nodeKey={nodeKey}
              parentNodeKey={CONNECTION_OBJECT_ROOT_PARENT_KEY}
              siblingOrderKeys={rootOrderableNodeKeys}
              draggedFolder={draggedFolder}
              folderDropTarget={folderDropTarget}
              canAddToApiServer={Boolean(onAddToApiServer)}
              canCreateApiServer={Boolean(onCreateApiServer)}
              explorerStatus={explorerStatus}
              isExplorerScopeLoading={isExplorerScopeLoading}
              visibleChildCounts={visibleChildCounts}
              canInspectNode={Boolean(onInspectNode)}
              onContextMenu={openObjectContextMenu}
              onLoadExplorerScope={onLoadExplorerScope}
              onLoadMoreChildren={loadMoreChildren}
              onOpenObjectView={openObjectView}
              onOpenQuery={openNodeQuery}
              onRequestAutoLoadScope={requestAutoLoadScope}
              onToggleNode={toggleNode}
              onBeginFolderDrag={beginFolderDrag}
              onClearFolderDrag={clearFolderDrag}
              onFolderDragOver={dragFolderOver}
              onFolderDrop={dropFolderNode}
            />
          )
        })}
      </div>

      {contextMenu ? (
        <ConnectionObjectContextMenu
          canRefreshNodes={Boolean(onLoadExplorerScope)}
          connection={connection}
          expanded={Boolean(expandedNodes[contextMenu.nodeKey])}
          menu={contextMenu}
          onClose={() => setContextMenu(undefined)}
          onCreateApiServer={onCreateApiServer ? createApiServer : undefined}
          onAddToApiServer={onAddToApiServer ? addToApiServer : undefined}
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

function shouldOverlayLiveExplorer(
  connection: ConnectionProfile,
  hasStructuralManifest: boolean,
) {
  if (connection.engine === 'mongodb') {
    return hasStructuralManifest
  }

  return (
    connection.engine === 'redis' ||
    connection.engine === 'valkey' ||
    connection.engine === 'postgresql' ||
    connection.engine === 'cockroachdb' ||
    connection.engine === 'timescaledb' ||
    connection.engine === 'sqlserver' ||
    connection.engine === 'sqlite' ||
    connection.engine === 'duckdb' ||
    connection.engine === 'cassandra' ||
    connection.engine === 'litedb' ||
    connection.family === 'graph' ||
    connection.family === 'warehouse' ||
    connection.engine === 'prometheus' ||
    connection.engine === 'influxdb' ||
    connection.engine === 'opentsdb' ||
    connection.engine === 'memcached'
  )
}

function mergeConnectionTrees(
  connection: ConnectionProfile,
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
        connection,
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
  connection: ConnectionProfile,
  structuralNode: ConnectionTreeNode,
  liveNode: ConnectionTreeNode,
): ConnectionTreeNode {
  const children = shouldPreferLiveChildren(connection, structuralNode, liveNode)
    ? (liveNode.children ?? []).map(cloneConnectionTreeNode)
    : mergeConnectionTrees(
        connection,
        structuralNode.children ?? [],
        liveNode.children ?? [],
      )

  return {
    ...structuralNode,
    ...liveNode,
    children: children.length ? children : undefined,
  }
}

function shouldPreferLiveChildren(
  connection: ConnectionProfile,
  structuralNode: ConnectionTreeNode,
  liveNode: ConnectionTreeNode,
) {
  if (connection.engine === 'sqlserver' && liveNode.label === 'Tables') {
    const hasLiveTables = Boolean(
      liveNode.children?.some((child) => child.kind === 'table'),
    )
    const hasStructuralTableTypeGroups = Boolean(
      structuralNode.children?.some((child) =>
        ['system-tables', 'filetables', 'external-tables', 'graph-tables'].includes(child.kind) ||
        ['System Tables', 'FileTables', 'External Tables', 'Graph Tables', 'Node Tables', 'Edge Tables'].includes(child.label),
      ),
    )

    return hasLiveTables && hasStructuralTableTypeGroups
  }

  if (!['User Schemas', 'System Schemas', 'Schemas'].includes(liveNode.label)) {
    return false
  }

  const hasLiveSchemaChildren = Boolean(
    liveNode.children?.some((child) => child.kind === 'schema'),
  )
  const hasStructuralCategoryChildren = Boolean(
    structuralNode.children?.some((child) => child.category || child.kind.endsWith('s')),
  )

  return hasLiveSchemaChildren && hasStructuralCategoryChildren
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

function connectionTreeNodeKey(connection: ConnectionProfile, node: ConnectionTreeNode) {
  const path =
    node.path?.[0] === connection.name
      ? node.path.slice(1)
      : (node.path ?? [])
  const pathAlreadyIncludesNode =
    path.at(-1)?.trim().toLowerCase() === node.label.trim().toLowerCase()
  const keyParts = path.length
    ? pathAlreadyIncludesNode
      ? path
      : [...path, node.label]
    : [node.label]
  const normalized = keyParts
    .map((part) => part.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .filter(Boolean)
    .join('/')

  return normalized || node.id
}

function connectionTreeRenderNodeKey(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  parentNodeKey: string,
) {
  const nodeKey = connectionTreeNodeKey(connection, node)
  return parentNodeKey === CONNECTION_OBJECT_ROOT_PARENT_KEY
    ? nodeKey
    : `${parentNodeKey}/${nodeKey}`
}

export function explorerFolderOrderKey(
  connectionId: string,
  environmentId: string | undefined,
  parentNodeKey: string,
) {
  return [
    'connection-object-tree',
    connectionId.trim(),
    environmentId?.trim() || 'default',
    parentNodeKey.trim() || CONNECTION_OBJECT_ROOT_PARENT_KEY,
  ].join('\u001f')
}

function orderConnectionTreeNodes(
  connection: ConnectionProfile,
  environmentId: string,
  nodes: ConnectionTreeNode[],
  explorerFolderOrders: Record<string, string[]> | undefined,
  parentNodeKey = CONNECTION_OBJECT_ROOT_PARENT_KEY,
): ConnectionTreeNode[] {
  const orderKey = explorerFolderOrderKey(connection.id, environmentId, parentNodeKey)
  const folderOrder = new Map(
    (explorerFolderOrders?.[orderKey] ?? []).map((nodeKey, index) => [nodeKey, index]),
  )

  return nodes
    .map((node) => {
      const nodeKey = connectionTreeRenderNodeKey(connection, node, parentNodeKey)
      const children = node.children?.length
        ? orderConnectionTreeNodes(
            connection,
            environmentId,
            node.children,
            explorerFolderOrders,
            nodeKey,
          )
        : node.children

      return children === node.children ? node : { ...node, children }
    })
    .sort((left, right) =>
      compareConnectionTreeNodes(connection, parentNodeKey, folderOrder, left, right),
    )
}

function compareConnectionTreeNodes(
  connection: ConnectionProfile,
  parentNodeKey: string,
  folderOrder: Map<string, number>,
  left: ConnectionTreeNode,
  right: ConnectionTreeNode,
) {
  const leftKey = connectionTreeRenderNodeKey(connection, left, parentNodeKey)
  const rightKey = connectionTreeRenderNodeKey(connection, right, parentNodeKey)
  const leftFolder = isConnectionFolderOrderableNode(left)
  const rightFolder = isConnectionFolderOrderableNode(right)

  if (leftFolder && rightFolder) {
    const leftOrder = folderOrder.get(leftKey)
    const rightOrder = folderOrder.get(rightKey)

    if (leftOrder !== undefined || rightOrder !== undefined) {
      if (leftOrder === undefined) return 1
      if (rightOrder === undefined) return -1
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
    }
  }

  return (
    left.label.localeCompare(right.label, undefined, {
      sensitivity: 'base',
      numeric: true,
    }) ||
    left.kind.localeCompare(right.kind, undefined, { sensitivity: 'base' }) ||
    leftKey.localeCompare(rightKey)
  )
}

function folderOrderableNodeKeys(
  connection: ConnectionProfile,
  nodes: ConnectionTreeNode[],
  parentNodeKey: string,
) {
  return nodes
    .filter(isConnectionFolderOrderableNode)
    .map((node) => connectionTreeRenderNodeKey(connection, node, parentNodeKey))
}

function isConnectionFolderOrderableNode(node: ConnectionTreeNode) {
  return (
    !isScopedQueryable(node) &&
    (Boolean(node.category) ||
      Boolean(node.children?.length) ||
      Boolean(node.expandable))
  )
}

function moveNodeKey(
  orderedNodeKeys: string[],
  sourceNodeKey: string,
  targetNodeKey: string,
  placement: 'before' | 'after',
) {
  if (sourceNodeKey === targetNodeKey) {
    return orderedNodeKeys
  }

  const withoutSource = orderedNodeKeys.filter((nodeKey) => nodeKey !== sourceNodeKey)
  const targetIndex = withoutSource.indexOf(targetNodeKey)

  if (targetIndex < 0) {
    return orderedNodeKeys
  }

  return [
    ...withoutSource.slice(0, placement === 'after' ? targetIndex + 1 : targetIndex),
    sourceNodeKey,
    ...withoutSource.slice(placement === 'after' ? targetIndex + 1 : targetIndex),
  ]
}

function folderDropPlacement(event: DragEvent<HTMLElement>): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
}

function ConnectionObjectTreeNode({
  canInspectNode,
  canCreateApiServer,
  canAddToApiServer,
  connection,
  depth,
  visualDepth,
  expandedNodes,
  environment,
  node,
  nodeKey,
  parentNodeKey,
  siblingOrderKeys,
  draggedFolder,
  folderDropTarget,
  explorerStatus,
  isExplorerScopeLoading,
  visibleChildCounts,
  onContextMenu,
  onLoadExplorerScope,
  onLoadMoreChildren,
  onOpenQuery,
  onOpenObjectView,
  onRequestAutoLoadScope,
  onToggleNode,
  onBeginFolderDrag,
  onClearFolderDrag,
  onFolderDragOver,
  onFolderDrop,
}: {
  canInspectNode: boolean
  canCreateApiServer: boolean
  canAddToApiServer: boolean
  connection: ConnectionProfile
  depth: number
  visualDepth: number
  expandedNodes: Record<string, boolean>
  environment?: EnvironmentProfile
  explorerStatus: 'idle' | 'loading' | 'ready'
  isExplorerScopeLoading(connectionId: string, scope?: string): boolean
  node: ConnectionTreeNode
  nodeKey: string
  parentNodeKey: string
  siblingOrderKeys: string[]
  draggedFolder?: ConnectionObjectFolderDragState
  folderDropTarget?: string
  visibleChildCounts: Record<string, number>
  onContextMenu(event: MouseEvent<HTMLElement>, node: ConnectionTreeNode, nodeKey: string): void
  onLoadExplorerScope?(connectionId: string, scope?: string): void
  onLoadMoreChildren(nodeKey: string): void
  onOpenQuery(node: ConnectionTreeNode): void
  onOpenObjectView?(node: ConnectionTreeNode): void
  onRequestAutoLoadScope(scope: string | undefined): void
  onToggleNode(nodeKey: string): void
  onBeginFolderDrag(parentNodeKey: string, nodeKey: string): void
  onClearFolderDrag(): void
  onFolderDragOver(parentNodeKey: string, nodeKey: string): void
  onFolderDrop(
    parentNodeKey: string,
    sourceNodeKey: string,
    targetNodeKey: string,
    siblingOrderKeys: string[],
    placement: 'before' | 'after',
  ): void
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
  const orderableChildKeys = useMemo(
    () => folderOrderableNodeKeys(connection, children, nodeKey),
    [children, connection, nodeKey],
  )
  const canDragFolder = isConnectionFolderOrderableNode(node) && siblingOrderKeys.length > 1
  const isDraggingFolder = draggedFolder?.nodeKey === nodeKey
  const isFolderDropTarget =
    folderDropTarget === nodeKey && draggedFolder?.parentNodeKey === parentNodeKey
  const hasObjectMenu = hasAvailableObjectMenuItems(connection, node, {
    canInspectNode,
    canOpenObjectView: Boolean(onOpenObjectView),
    canRefreshNode: Boolean(onLoadExplorerScope),
    canCreateApiServer,
    canAddToApiServer,
  })
  const shouldAutoLoadChildren =
    expanded && shouldLoadScopedChildren(connection, node, children, branchLoading)
  const toggleNode = () => {
    if (!canExpand) {
      return
    }

    const nextExpanded = !expanded
    onToggleNode(nodeKey)

    if (nextExpanded && shouldLoadScopedChildren(connection, node, children, branchLoading)) {
      onRequestAutoLoadScope(node.scope)
    }
  }
  const openLeafQuery = () => {
    if (!canExpand && queryable) {
      onOpenQuery(node)
    } else if (!canExpand && objectViewable) {
      onOpenObjectView?.(node)
    }
  }

  useEffect(() => {
    if (shouldAutoLoadChildren) {
      onRequestAutoLoadScope(node.scope)
    }
  }, [node.scope, onRequestAutoLoadScope, shouldAutoLoadChildren])

  return (
    <>
      <div
        role="treeitem"
        tabIndex={canExpand || queryable || objectViewable ? 0 : undefined}
        aria-expanded={canExpand ? expanded : undefined}
        aria-level={depth}
        draggable={canDragFolder}
        className={`tree-item connection-object-item${canExpand ? ' is-branch' : ''}${queryable || objectViewable ? ' is-queryable' : ''}${environment ? ' has-environment-accent' : ''}${canDragFolder ? ' is-folder-orderable' : ''}${isDraggingFolder ? ' is-folder-dragging' : ''}${isFolderDropTarget ? ' is-folder-drop-target' : ''}`}
        style={{ '--tree-depth': visualDepth, ...environmentStyle } as CSSProperties}
        title={objectNodeTitle(connection, node, queryable, objectViewable, canExpand)}
        onDragStart={(event: DragEvent<HTMLElement>) => {
          if (!canDragFolder) {
            return
          }

          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', nodeKey)
          onBeginFolderDrag(parentNodeKey, nodeKey)
        }}
        onDragOver={(event: DragEvent<HTMLElement>) => {
          if (
            !canDragFolder ||
            draggedFolder?.parentNodeKey !== parentNodeKey ||
            draggedFolder.nodeKey === nodeKey
          ) {
            return
          }

          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'move'
          onFolderDragOver(parentNodeKey, nodeKey)
        }}
        onDrop={(event: DragEvent<HTMLElement>) => {
          if (!canDragFolder || draggedFolder?.parentNodeKey !== parentNodeKey) {
            return
          }

          event.preventDefault()
          event.stopPropagation()
          const sourceNodeKey = draggedFolder.nodeKey || event.dataTransfer.getData('text/plain')
          if (sourceNodeKey) {
            onFolderDrop(
              parentNodeKey,
              sourceNodeKey,
              nodeKey,
              siblingOrderKeys,
              folderDropPlacement(event),
            )
          }
        }}
        onDragEnd={onClearFolderDrag}
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
            const childKey = connectionTreeRenderNodeKey(connection, child, nodeKey)

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
                parentNodeKey={nodeKey}
                siblingOrderKeys={orderableChildKeys}
                draggedFolder={draggedFolder}
                folderDropTarget={folderDropTarget}
                visibleChildCounts={visibleChildCounts}
                canInspectNode={canInspectNode}
                canCreateApiServer={canCreateApiServer}
                canAddToApiServer={canAddToApiServer}
                onContextMenu={onContextMenu}
                onLoadExplorerScope={onLoadExplorerScope}
                onLoadMoreChildren={onLoadMoreChildren}
                onOpenObjectView={onOpenObjectView}
                onOpenQuery={onOpenQuery}
                onRequestAutoLoadScope={onRequestAutoLoadScope}
                onToggleNode={onToggleNode}
                onBeginFolderDrag={onBeginFolderDrag}
                onClearFolderDrag={onClearFolderDrag}
                onFolderDragOver={onFolderDragOver}
                onFolderDrop={onFolderDrop}
              />
            )
          })
        : null}
      {expanded && canLoadChildren && children.length === 0 && !branchLoading && explorerStatus === 'ready' ? (
        <div
          className={`connection-object-empty${environment ? ' has-environment-accent' : ''}`}
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
          className={`connection-object-load-more${environment ? ' has-environment-accent' : ''}`}
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

function shouldLoadScopedChildren(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  children: ConnectionTreeNode[],
  branchLoading: boolean,
) {
  if (!node.expandable || !node.scope || branchLoading) {
    return false
  }

  if (children.length === 0) {
    return true
  }

  if (isRedisBranchScope(connection, node.scope)) {
    return true
  }

  return children.every((child) => !child.scope || child.scope === node.scope)
}

function isRedisBranchScope(connection: ConnectionProfile, scope: string) {
  return (
    (connection.engine === 'redis' || connection.engine === 'valkey') &&
    (scope === 'databases' || /^db:\d+$/.test(scope))
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
    path: Array.isArray(node.path) ? node.path : [],
    queryTemplate: node.queryTemplate,
    expandable: node.expandable,
  }
}
