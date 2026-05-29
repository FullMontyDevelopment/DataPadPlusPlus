import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  AdapterManifest,
  ClosedQueryTabSnapshot,
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  LibraryNode,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  EnvironmentsIcon,
  ExplorerIcon,
  ArrowLeftIcon,
  MoreIcon,
  PlayIcon,
  PlusIcon,
  QueryIcon,
  RenameIcon,
  RefreshIcon,
  TrashIcon,
} from './icons'
import { TreeFolderIcon, TreeFolderOpenIcon } from './FolderTreeIcons'
import { ConnectionObjectTree } from './SideBar.connection-object-tree'
import { LibraryTextInputDialog } from './LibraryTextInputDialog'
import {
  canMoveLibraryNode,
  findFolderIdByPath,
  libraryNodePath,
} from './SideBar.library-tree-helpers'
import { sidebarSectionId } from './SideBar.helpers'
import { EngineIcon } from './SideBar.node-icons'

interface LibraryPaneProps {
  activeConnectionId?: string
  activeEnvironmentId?: string
  adapterManifests?: AdapterManifest[]
  closedTabs: ClosedQueryTabSnapshot[]
  connections?: ConnectionProfile[]
  environments: EnvironmentProfile[]
  explorerStatus?: 'idle' | 'loading' | 'ready'
  getConnectionExplorerItems?(connectionId: string, environmentId?: string): ExplorerNode[] | undefined
  getConnectionExplorerStatus?(connectionId: string, environmentId?: string): 'idle' | 'loading' | 'ready'
  isExplorerScopeLoading?(connectionId: string, scope?: string, environmentId?: string): boolean
  libraryFilter: string
  libraryNodes: LibraryNode[]
  sectionStates: Record<string, boolean>
  onCloneEnvironment?(environmentId: string): void
  onCollapseSidebar?(): void
  onCreateConnection?(parentId?: string): void
  onCreateEnvironment?(): void
  onCreateFolder(parentId: string | undefined, name: string): void
  onCreateTab?(connectionId?: string): void
  onCreateTestSuite?(connectionId?: string): void
  onDeleteNode(nodeId: string): void
  onDeleteConnection?(connectionId: string): void
  onDeleteEnvironment?(environmentId: string): void
  onDuplicateConnection?(connectionId: string): void
  onEditEnvironment?(environmentId: string): void
  onLibraryFilterChange(value: string): void
  onLoadExplorerScope?(connectionId: string, scope?: string, environmentId?: string): void
  onMoveNode(nodeId: string, parentId?: string): void
  onOpenConnectionDrawer?(connectionId: string): void
  onOpenConnectionExplorer?(connectionId: string): void
  onOpenConnectionMetrics?(connectionId: string): void
  onInspectExplorerNode?(node: ExplorerNode): void
  onOpenObjectView?(connectionId: string, node: ExplorerNode): void
  onOpenScopedQuery?(connectionId: string, target: ScopedQueryTarget): void
  onOpenLibraryItem(nodeId: string): void
  onRenameNode(nodeId: string, name: string): void
  onReopenClosedTab(closedTabId: string): void
  onSelectConnection?(connectionId: string): void
  onSelectEnvironment?(environmentId: string): void
  onSetNodeEnvironment(nodeId: string, environmentId?: string): void
  onSidebarSectionExpandedChange(sectionId: string, expanded: boolean): void
  onTestConnection?(connectionId: string): void
}

interface TreeNode {
  node: LibraryNode
  children: TreeNode[]
}

interface LibraryContextMenuState {
  node: LibraryNode
  x: number
  y: number
}

interface EnvironmentContextMenuState {
  environment: EnvironmentProfile
  x: number
  y: number
}

interface LibraryPointerDragState {
  nodeId: string
  pointerId: number
  startX: number
  startY: number
  active: boolean
}

interface LibraryDropTarget {
  kind: 'folder' | 'root'
  parentId?: string
}

interface CreateFolderDialogState {
  parentId?: string
}

interface MoveNodeDialogState {
  node: LibraryNode
  initialPath: string
}

interface LibraryEnvironmentState {
  environment: EnvironmentProfile
  source: 'direct' | 'inherited'
  sourceNode: LibraryNode
}

const POINTER_DRAG_THRESHOLD = 4
const RECENTS_SECTION_ID = 'library:recents'
const ENVIRONMENTS_SECTION_ID = 'library:environments'
const DEFAULT_RECENTS_HEIGHT = 180
const MIN_RECENTS_HEIGHT = 92
const MAX_RECENTS_HEIGHT = 360

function noop() {
  // Optional Library pane callbacks are supplied by the full app shell.
}

function validateRequiredLibraryInput(value: string) {
  return value.trim() ? undefined : 'Enter a name.'
}

export function LibraryPane({
  activeConnectionId = '',
  activeEnvironmentId = '',
  adapterManifests = [],
  closedTabs,
  connections = [],
  environments,
  explorerStatus = 'idle',
  getConnectionExplorerItems = () => undefined,
  getConnectionExplorerStatus = () => 'idle',
  isExplorerScopeLoading = () => false,
  libraryFilter,
  libraryNodes,
  sectionStates,
  onCloneEnvironment = noop,
  onCollapseSidebar = noop,
  onCreateConnection = noop,
  onCreateEnvironment = noop,
  onCreateFolder,
  onCreateTab = noop,
  onCreateTestSuite = noop,
  onDeleteConnection = noop,
  onDeleteEnvironment = noop,
  onDeleteNode,
  onDuplicateConnection = noop,
  onEditEnvironment = noop,
  onLibraryFilterChange,
  onLoadExplorerScope = noop,
  onMoveNode,
  onOpenConnectionDrawer = noop,
  onOpenConnectionExplorer = noop,
  onOpenConnectionMetrics = noop,
  onInspectExplorerNode = noop,
  onOpenObjectView = noop,
  onOpenScopedQuery = noop,
  onOpenLibraryItem,
  onRenameNode,
  onReopenClosedTab,
  onSelectConnection = noop,
  onSelectEnvironment = noop,
  onSetNodeEnvironment,
  onSidebarSectionExpandedChange,
  onTestConnection = noop,
}: LibraryPaneProps) {
  const [contextMenu, setContextMenu] = useState<LibraryContextMenuState>()
  const [createFolderDialog, setCreateFolderDialog] = useState<CreateFolderDialogState>()
  const [environmentMenu, setEnvironmentMenu] = useState<EnvironmentContextMenuState>()
  const [moveNodeDialog, setMoveNodeDialog] = useState<MoveNodeDialogState>()
  const [renameNodeDialog, setRenameNodeDialog] = useState<LibraryNode>()
  const [draggedNodeId, setDraggedNodeId] = useState<string>()
  const pointerDragRef = useRef<LibraryPointerDragState | undefined>(undefined)
  const suppressOpenClickNodeIdRef = useRef<string | undefined>(undefined)
  const [rootDragActive, setRootDragActive] = useState(false)
  const [folderDropTargetId, setFolderDropTargetId] = useState<string>()
  const [recentsHeight, setRecentsHeight] = useState(readInitialRecentsHeight)
  const [isResizingRecents, setIsResizingRecents] = useState(false)
  const lastRecentsPointerY = useRef(0)
  const filteredNodes = useMemo(
    () => filterLibraryNodes(libraryNodes, libraryFilter),
    [libraryFilter, libraryNodes],
  )
  const tree = useMemo(() => buildLibraryTree(filteredNodes), [filteredNodes])
  const hasLibraryNodes = filteredNodes.length > 0
  const recentLibraryItems = useMemo(() => recentLibraryNodes(libraryNodes), [libraryNodes])
  const recentsCount = recentLibraryItems.length + closedTabs.length
  const recentsExpanded = sectionStates[RECENTS_SECTION_ID] ?? true
  const environmentsExpanded = sectionStates[ENVIRONMENTS_SECTION_ID] ?? true
  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  )

  useEffect(() => {
    if (!contextMenu && !environmentMenu) {
      return undefined
    }

    const close = () => {
      setContextMenu(undefined)
      setEnvironmentMenu(undefined)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('resize', close)
    }
  }, [contextMenu, environmentMenu])

  const requestCreateFolder = (parentId?: string) => {
    setContextMenu(undefined)
    setCreateFolderDialog({ parentId })
  }

  const requestRenameNode = (node: LibraryNode) => {
    setContextMenu(undefined)
    setRenameNodeDialog(node)
  }

  const deleteNode = (node: LibraryNode) => {
    onDeleteNode(node.id)
  }

  const openEnvironmentMenu = (
    environment: EnvironmentProfile,
    event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu(undefined)
    setEnvironmentMenu({ environment, x: event.clientX, y: event.clientY })
  }

  const deleteEnvironment = (environment: EnvironmentProfile) => {
    if (environments.length <= 1) {
      return
    }

    onDeleteEnvironment(environment.id)
  }

  const requestMoveNode = (node: LibraryNode) => {
    setContextMenu(undefined)
    setMoveNodeDialog({
      node,
      initialPath: node.parentId
        ? libraryNodePath(libraryNodes, libraryNodes.find((item) => item.id === node.parentId))
        : '',
    })
  }

  const showDropTarget = (target?: LibraryDropTarget) => {
    setRootDragActive(target?.kind === 'root')
    setFolderDropTargetId(target?.kind === 'folder' ? target.parentId : undefined)
  }

  const clearDrag = () => {
    pointerDragRef.current = undefined
    setDraggedNodeId(undefined)
    setFolderDropTargetId(undefined)
    setRootDragActive(false)
  }

  const beginPointerDrag = (nodeId: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return
    }

    pointerDragRef.current = {
      nodeId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const updatePointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const session = pointerDragRef.current

    if (!session || session.pointerId !== event.pointerId) {
      return
    }

    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY)
    if (!session.active && distance < POINTER_DRAG_THRESHOLD) {
      return
    }

    session.active = true
    setDraggedNodeId(session.nodeId)
    showDropTarget(dropTargetFromPoint(event.clientX, event.clientY, session.nodeId, libraryNodes))
    event.preventDefault()
    event.stopPropagation()
  }

  const finishPointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const session = pointerDragRef.current

    if (!session || session.pointerId !== event.pointerId) {
      return
    }

    if (session.active) {
      const target = dropTargetFromPoint(event.clientX, event.clientY, session.nodeId, libraryNodes)

      if (target) {
        onMoveNode(session.nodeId, target.parentId)
      }
      suppressOpenClickNodeIdRef.current = session.nodeId
      window.setTimeout(() => {
        if (suppressOpenClickNodeIdRef.current === session.nodeId) {
          suppressOpenClickNodeIdRef.current = undefined
        }
      }, 0)
      event.preventDefault()
      event.stopPropagation()
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId)
    clearDrag()
  }

  const shouldSuppressOpenClick = (nodeId: string) => {
    if (suppressOpenClickNodeIdRef.current !== nodeId) {
      return false
    }
    suppressOpenClickNodeIdRef.current = undefined
    return true
  }

  const resizeRecents = (nextHeight: number) => {
    const clamped = clamp(nextHeight, MIN_RECENTS_HEIGHT, MAX_RECENTS_HEIGHT)
    setRecentsHeight(clamped)
    window.localStorage.setItem('datapadplusplus.library.recentsHeight', String(clamped))
  }
  const contextMenuConnection = contextMenu?.node.kind === 'connection' && contextMenu.node.connectionId
    ? connectionById.get(contextMenu.node.connectionId)
    : undefined
  const contextMenuEnvironmentId = contextMenu
    ? effectiveEnvironmentForNode(contextMenu.node, libraryNodes, environments)?.environment.id ?? activeEnvironmentId
    : activeEnvironmentId
  const contextMenuAdapter = contextMenuConnection
    ? adapterManifests.find((manifest) => manifest.engine === contextMenuConnection.engine)
    : undefined
  const contextMenuCapabilities = new Set([
    ...(contextMenuAdapter?.capabilities ?? []),
    ...(contextMenuConnection
      ? datastoreBacklogByEngine(contextMenuConnection.engine)?.capabilities ?? []
      : []),
  ])
  const contextMenuSupportsMetrics = contextMenuCapabilities.has('supports_metrics_collection')

  return (
    <>
      <div className="sidebar-header sidebar-header--toolbar-only">
        <div className="sidebar-actions" role="toolbar" aria-label="Library actions">
          <button
            type="button"
            className="sidebar-icon-button"
            aria-label="Collapse Library"
            title="Collapse Library"
            onClick={onCollapseSidebar}
          >
            <ArrowLeftIcon className="sidebar-icon" />
          </button>
          <button
            type="button"
            className="sidebar-icon-button"
            aria-label="New datastore connection"
            title="New Connection"
            onClick={() => onCreateConnection()}
          >
            <DatabaseIcon className="sidebar-icon" />
          </button>
          <button
            type="button"
            className="sidebar-icon-button"
            aria-label="New library folder"
            title="Create a folder in the Library."
            onClick={() => requestCreateFolder()}
          >
            <ExplorerIcon className="sidebar-icon" />
          </button>
        </div>
      </div>

      <label className="sidebar-search">
        <span className="sr-only">Search</span>
        <input
          type="search"
          placeholder="Search"
          value={libraryFilter}
          onChange={(event) => onLibraryFilterChange(event.target.value)}
        />
      </label>

      <div className="library-workspace">
        <div
          className={`library-main-scroll${draggedNodeId ? ' is-library-dragging' : ''}${
            rootDragActive ? ' is-library-root-drag-over' : ''
          }`}
          data-library-drop-root="true"
        >
          {!hasLibraryNodes && recentsCount === 0 ? (
            <div className="sidebar-empty library-empty-placeholder">
              <DatabaseIcon className="empty-icon" />
              <strong>Start your workspace</strong>
              <p>Add your first datastore connection or create a folder to organize work.</p>
              <div className="sidebar-empty-actions">
                <button type="button" className="sidebar-empty-action" onClick={() => onCreateConnection()}>
                  Add Connection
                </button>
                <button type="button" className="sidebar-empty-action" onClick={() => requestCreateFolder()}>
                  Add Folder
                </button>
              </div>
            </div>
          ) : null}

          <div
            className="library-root-drop-target"
            role="button"
            tabIndex={0}
            aria-label="Move library item to root"
            data-library-drop-root="true"
          >
            <span className="sr-only">Drop here to move to Library root</span>
          </div>

          <div className="library-tree" role="tree" aria-label="Library tree">
            {tree.map((item) => (
              <LibraryTreeItem
                key={item.node.id}
                activeConnectionId={activeConnectionId}
                activeEnvironmentId={activeEnvironmentId}
                adapterManifests={adapterManifests}
                connections={connections}
                item={item}
                environments={environments}
                explorerStatus={explorerStatus}
                getConnectionExplorerItems={getConnectionExplorerItems}
                getConnectionExplorerStatus={getConnectionExplorerStatus}
                isExplorerScopeLoading={isExplorerScopeLoading}
                libraryNodes={libraryNodes}
                draggedNodeId={draggedNodeId}
                folderDropTargetId={folderDropTargetId}
                sectionStates={sectionStates}
                depth={0}
                onContextMenu={setContextMenu}
                onCreateConnection={onCreateConnection}
                onCreateFolder={requestCreateFolder}
                onCreateTab={onCreateTab}
                onCreateTestSuite={onCreateTestSuite}
                onDeleteConnection={onDeleteConnection}
                onDeleteNode={deleteNode}
                onDuplicateConnection={onDuplicateConnection}
                onBeginPointerDrag={beginPointerDrag}
                onClearDrag={clearDrag}
                onFinishPointerDrag={finishPointerDrag}
                onLoadExplorerScope={onLoadExplorerScope}
                onOpenConnectionDrawer={onOpenConnectionDrawer}
                onOpenConnectionExplorer={onOpenConnectionExplorer}
                onOpenConnectionMetrics={onOpenConnectionMetrics}
                onInspectExplorerNode={onInspectExplorerNode}
                onOpenObjectView={onOpenObjectView}
                onOpenScopedQuery={onOpenScopedQuery}
                onOpenLibraryItem={onOpenLibraryItem}
                onPointerDragMove={updatePointerDrag}
                onRenameNode={requestRenameNode}
                onSelectConnection={onSelectConnection}
                onSidebarSectionExpandedChange={onSidebarSectionExpandedChange}
                onTestConnection={onTestConnection}
                shouldSuppressOpenClick={shouldSuppressOpenClick}
              />
            ))}
          </div>
        </div>

        {recentsCount > 0 ? (
          <section
            className={`library-recents-panel sidebar-section${
              recentsExpanded ? ' is-expanded' : ' is-collapsed'
            }${isResizingRecents ? ' is-resizing' : ''}`}
          >
            {recentsExpanded ? (
              <div
                role="separator"
                aria-label="Resize Recents"
                aria-orientation="horizontal"
                aria-valuemin={MIN_RECENTS_HEIGHT}
                aria-valuemax={MAX_RECENTS_HEIGHT}
                aria-valuenow={recentsHeight}
                className="library-recents-resize-handle"
                tabIndex={0}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  lastRecentsPointerY.current = event.clientY
                  setIsResizingRecents(true)
                }}
                onPointerMove={(event) => {
                  if (!isResizingRecents) {
                    return
                  }
                  const delta = lastRecentsPointerY.current - event.clientY
                  lastRecentsPointerY.current = event.clientY
                  resizeRecents(recentsHeight + delta)
                }}
                onPointerUp={(event) => {
                  event.currentTarget.releasePointerCapture?.(event.pointerId)
                  setIsResizingRecents(false)
                }}
                onPointerCancel={() => setIsResizingRecents(false)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    resizeRecents(recentsHeight + 16)
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    resizeRecents(recentsHeight - 16)
                  }
                }}
              />
            ) : null}
            <button
              type="button"
              className="sidebar-section-header sidebar-section-header--button"
              aria-label={`${recentsExpanded ? 'Collapse' : 'Expand'} Recents section (${recentsCount})`}
              aria-expanded={recentsExpanded}
              aria-controls="library-recents-body"
              onClick={() => onSidebarSectionExpandedChange(RECENTS_SECTION_ID, !recentsExpanded)}
            >
              <span className="sidebar-section-title">
                {recentsExpanded ? (
                  <ChevronDownIcon className="sidebar-section-chevron" />
                ) : (
                  <ChevronRightIcon className="sidebar-section-chevron" />
                )}
                <span>Recents</span>
              </span>
              <span>{recentsCount}</span>
            </button>

            {recentsExpanded ? (
              <div
                id="library-recents-body"
                className="library-recents-body"
                style={{ height: recentsHeight }}
              >
                {recentLibraryItems.map((node) => (
                  <div key={`recent-${node.id}`} className="saved-work-row">
                    <div className="saved-work-title-row">
                      <strong>{node.name}</strong>
                      <span>{node.kind}</span>
                    </div>
                    <p>{formatRecentAt(node.lastOpenedAt)}</p>
                    <div className="saved-work-meta-row">
                      <small>{node.language ?? 'text'} / Library</small>
                      <span className="saved-work-actions">
                        <button
                          type="button"
                          className="sidebar-icon-button sidebar-icon-button--inline"
                          aria-label={`Open recent library item ${node.name}`}
                          title={`Open ${node.name}.`}
                          onClick={() => onOpenLibraryItem(node.id)}
                        >
                          <PlayIcon className="sidebar-icon" />
                        </button>
                      </span>
                    </div>
                  </div>
                ))}

                {closedTabs.slice(0, 8).map((tab) => (
                  <div key={`${tab.id}-${tab.closedAt}`} className="saved-work-row">
                    <div className="saved-work-title-row">
                      <strong>{tab.title}</strong>
                      <span>{tab.dirty ? 'edited' : 'closed'}</span>
                    </div>
                    <p>{formatClosedAt(tab.closedAt)}</p>
                    <div className="saved-work-meta-row">
                      <small>{tab.language} / recovery</small>
                      <span className="saved-work-actions">
                        <button
                          type="button"
                          className="sidebar-icon-button sidebar-icon-button--inline"
                          aria-label={`Reopen closed tab ${tab.title}`}
                          title={`Recover recently closed tab ${tab.title}.`}
                          onClick={() => onReopenClosedTab(tab.id)}
                        >
                          <PlayIcon className="sidebar-icon" />
                        </button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <section
          className={`library-environments-panel sidebar-section${
            environmentsExpanded ? ' is-expanded' : ' is-collapsed'
          }`}
        >
          <button
            type="button"
            className="sidebar-section-header sidebar-section-header--button"
            aria-label={`${environmentsExpanded ? 'Collapse' : 'Expand'} Environments section (${environments.length})`}
            aria-expanded={environmentsExpanded}
            aria-controls="library-environments-body"
            onClick={() =>
              onSidebarSectionExpandedChange(ENVIRONMENTS_SECTION_ID, !environmentsExpanded)
            }
          >
            <span className="sidebar-section-title">
              {environmentsExpanded ? (
                <ChevronDownIcon className="sidebar-section-chevron" />
              ) : (
                <ChevronRightIcon className="sidebar-section-chevron" />
              )}
              <span>Environments</span>
            </span>
            <span>{environments.length}</span>
          </button>

          {environmentsExpanded ? (
            <div id="library-environments-body" className="library-environments-body">
              {environments.map((environment) => (
                <div
                  key={environment.id}
                  className={`library-environment-row${
                    environment.id === activeEnvironmentId ? ' is-active' : ''
                  }`}
                  onContextMenu={(event) => openEnvironmentMenu(environment, event)}
                >
                  <button
                    type="button"
                    className="library-environment-main"
                    aria-label={`Open environment ${environment.label}`}
                    onClick={() => onSelectEnvironment(environment.id)}
                    title={`Use ${environment.label} as the active environment.`}
                  >
                    <span
                      className="library-env-swatch"
                      style={libraryEnvironmentStyle(environment)}
                    />
                    <span>
                      <strong>{environment.label}</strong>
                      <small>{environment.risk}</small>
                    </span>
                  </button>
                  <span className="saved-work-actions">
                    <button
                      type="button"
                      className="sidebar-icon-button sidebar-icon-button--inline"
                      aria-label={`Environment actions for ${environment.label}`}
                      title={`Manage ${environment.label}.`}
                      onClick={(event) => openEnvironmentMenu(environment, event)}
                    >
                      <MoreIcon className="sidebar-icon" />
                    </button>
                  </span>
                </div>
              ))}

              <button
                type="button"
                className="sidebar-empty-action library-environment-add"
                onClick={onCreateEnvironment}
              >
                New Environment
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {environmentMenu ? (
        <div
          className="connection-context-menu"
          role="menu"
          aria-label={`Environment options for ${environmentMenu.environment.label}`}
          style={{ left: environmentMenu.x, top: environmentMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="connection-context-menu-item"
            role="menuitem"
            aria-label={`Edit environment ${environmentMenu.environment.label}`}
            onClick={() => {
              onEditEnvironment(environmentMenu.environment.id)
              setEnvironmentMenu(undefined)
            }}
          >
            <RenameIcon className="connection-context-menu-icon" />
            <span>Edit</span>
          </button>
          <button
            type="button"
            className="connection-context-menu-item"
            role="menuitem"
            aria-label={`Clone environment ${environmentMenu.environment.label}`}
            onClick={() => {
              onCloneEnvironment(environmentMenu.environment.id)
              setEnvironmentMenu(undefined)
            }}
          >
            <PlusIcon className="connection-context-menu-icon" />
            <span>Clone</span>
          </button>
          <div className="connection-context-menu-separator" role="separator" />
          <button
            type="button"
            className="connection-context-menu-item connection-context-menu-item--danger"
            role="menuitem"
            aria-label={`Delete environment ${environmentMenu.environment.label}`}
            disabled={environments.length <= 1}
            title={
              environments.length <= 1
                ? 'At least one environment is required.'
                : `Delete ${environmentMenu.environment.label}.`
            }
            onClick={() => {
              deleteEnvironment(environmentMenu.environment)
              setEnvironmentMenu(undefined)
            }}
          >
            <TrashIcon className="connection-context-menu-icon" />
            <span>Delete</span>
          </button>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="connection-context-menu"
          role="menu"
          aria-label={
            contextMenuConnection
              ? `Connection options for ${contextMenuConnection.name}`
              : `Library options for ${contextMenu.node.name}`
          }
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextMenuConnection ? (
            <>
              <button
                type="button"
                className="connection-context-menu-item"
                role="menuitem"
                aria-label={`New Query for ${contextMenuConnection.name}`}
                onClick={() => {
                  onCreateTab(contextMenuConnection.id)
                  setContextMenu(undefined)
                }}
              >
                <PlayIcon className="connection-context-menu-icon" />
                <span>New Query</span>
              </button>
              <button
                type="button"
                className="connection-context-menu-item"
                role="menuitem"
                aria-label={`New Test Suite for ${contextMenuConnection.name}`}
                onClick={() => {
                  onCreateTestSuite(contextMenuConnection.id)
                  setContextMenu(undefined)
                }}
              >
                <PlayIcon className="connection-context-menu-icon" />
                <span>New Test Suite</span>
              </button>
              <button
                type="button"
                className="connection-context-menu-item"
                role="menuitem"
                aria-label={`Open Explorer for ${contextMenuConnection.name}`}
                onClick={() => {
                  onOpenConnectionExplorer(contextMenuConnection.id)
                  setContextMenu(undefined)
                }}
              >
                <ExplorerIcon className="connection-context-menu-icon" />
                <span>Open Explorer</span>
              </button>
              {contextMenuSupportsMetrics ? (
                <button
                  type="button"
                  className="connection-context-menu-item"
                  role="menuitem"
                  aria-label={`Open Metrics for ${contextMenuConnection.name}`}
                  onClick={() => {
                    onOpenConnectionMetrics(contextMenuConnection.id)
                    setContextMenu(undefined)
                  }}
                >
                  <DatabaseIcon className="connection-context-menu-icon" />
                  <span>Metrics</span>
                </button>
              ) : null}
              {onLoadExplorerScope ? (
                <button
                  type="button"
                  className="connection-context-menu-item"
                  role="menuitem"
                  aria-label={`Refresh metadata for ${contextMenuConnection.name}`}
                  onClick={() => {
                    onLoadExplorerScope(
                      contextMenuConnection.id,
                      undefined,
                      contextMenuEnvironmentId,
                    )
                    setContextMenu(undefined)
                  }}
                >
                  <RefreshIcon className="connection-context-menu-icon" />
                  <span>Refresh Metadata</span>
                </button>
              ) : null}
              <button
                type="button"
                className="connection-context-menu-item"
                role="menuitem"
                aria-label={`Test connection ${contextMenuConnection.name}`}
                onClick={() => {
                  onTestConnection(contextMenuConnection.id)
                  setContextMenu(undefined)
                }}
              >
                <DatabaseIcon className="connection-context-menu-icon" />
                <span>Test Connection</span>
              </button>
              <button
                type="button"
                className="connection-context-menu-item"
                role="menuitem"
                aria-label={`Edit connection ${contextMenuConnection.name}`}
                onClick={() => {
                  onOpenConnectionDrawer(contextMenuConnection.id)
                  setContextMenu(undefined)
                }}
              >
                <RenameIcon className="connection-context-menu-icon" />
                <span>Edit Connection</span>
              </button>
              <button
                type="button"
                className="connection-context-menu-item"
                role="menuitem"
                aria-label={`Duplicate connection ${contextMenuConnection.name}`}
                onClick={() => {
                  onDuplicateConnection(contextMenuConnection.id)
                  setContextMenu(undefined)
                }}
              >
                <PlusIcon className="connection-context-menu-icon" />
                <span>Duplicate</span>
              </button>
              <div className="connection-context-menu-separator" role="separator" />
            </>
          ) : null}
          {contextMenu.node.kind === 'folder' ? (
            <>
              <button
                type="button"
                className="connection-context-menu-item"
                role="menuitem"
                onClick={() => {
                  onCreateConnection(contextMenu.node.id)
                  setContextMenu(undefined)
                }}
              >
                <DatabaseIcon className="connection-context-menu-icon" />
                <span>New Connection</span>
              </button>
              <button
                type="button"
                className="connection-context-menu-item"
                role="menuitem"
                onClick={() => {
                  onCreateTab(activeConnectionId)
                  setContextMenu(undefined)
                }}
              >
                <PlayIcon className="connection-context-menu-icon" />
                <span>New Query</span>
              </button>
              <button
                type="button"
                className="connection-context-menu-item"
                role="menuitem"
                onClick={() => {
                  onCreateTestSuite(activeConnectionId)
                  setContextMenu(undefined)
                }}
              >
                <PlayIcon className="connection-context-menu-icon" />
                <span>New Test Suite</span>
              </button>
            </>
          ) : null}
          {contextMenu.node.kind !== 'folder' && !contextMenuConnection ? (
            <button
              type="button"
              className="connection-context-menu-item"
              role="menuitem"
              onClick={() => {
                onOpenLibraryItem(contextMenu.node.id)
                setContextMenu(undefined)
              }}
            >
              <PlayIcon className="connection-context-menu-icon" />
              <span>Open</span>
            </button>
          ) : null}
          <button
            type="button"
            className="connection-context-menu-item"
            role="menuitem"
            onClick={() => {
              requestCreateFolder(
                contextMenu.node.kind === 'folder'
                  ? contextMenu.node.id
                  : contextMenu.node.parentId,
              )
            }}
          >
            <PlusIcon className="connection-context-menu-icon" />
            <span>New Folder</span>
          </button>
          {!contextMenuConnection ? (
            <button
              type="button"
              className="connection-context-menu-item"
              role="menuitem"
              onClick={() => {
                requestRenameNode(contextMenu.node)
              }}
            >
              <RenameIcon className="connection-context-menu-icon" />
              <span>Rename</span>
            </button>
          ) : null}
          <button
            type="button"
            className="connection-context-menu-item"
            role="menuitem"
            onClick={() => {
              requestMoveNode(contextMenu.node)
            }}
          >
            <ExplorerIcon className="connection-context-menu-icon" />
            <span>Move to Folder</span>
          </button>
          <div className="connection-context-menu-separator" role="separator" />
          <div className="connection-context-menu-section-label">Environment</div>
          <button
            type="button"
            className="connection-context-menu-item"
            role="menuitem"
            onClick={() => {
              onSetNodeEnvironment(contextMenu.node.id, undefined)
              setContextMenu(undefined)
            }}
          >
            <EnvironmentsIcon className="connection-context-menu-icon" />
            <span>Inherit from parent</span>
          </button>
          {environments.map((environment) => (
            <button
              key={environment.id}
              type="button"
              className="connection-context-menu-item"
              role="menuitem"
              aria-label={`Assign environment ${environment.label} to ${contextMenu.node.name}`}
              onClick={() => {
                onSetNodeEnvironment(contextMenu.node.id, environment.id)
                setContextMenu(undefined)
              }}
            >
              <span
                className="library-env-swatch"
                style={libraryEnvironmentStyle(environment)}
              />
              <span>{environment.label}</span>
            </button>
          ))}
          <div className="connection-context-menu-separator" role="separator" />
          <button
            type="button"
            className="connection-context-menu-item connection-context-menu-item--danger"
            role="menuitem"
            aria-label={
              contextMenuConnection
                ? `Delete connection ${contextMenuConnection.name}`
                : `Delete ${contextMenu.node.name}`
            }
            onClick={() => {
              if (contextMenuConnection) {
                onDeleteConnection(contextMenuConnection.id)
              } else {
                deleteNode(contextMenu.node)
              }
              setContextMenu(undefined)
            }}
          >
            <TrashIcon className="connection-context-menu-icon" />
            <span>{contextMenuConnection ? 'Delete Connection' : 'Delete'}</span>
          </button>
        </div>
      ) : null}
      {createFolderDialog ? (
        <LibraryTextInputDialog
          title="New folder"
          body="Create a Library folder for connections, queries, scripts, tests, and notes."
          inputLabel="Folder name"
          placeholder="Folder name"
          confirmLabel="Create Folder"
          validate={validateRequiredLibraryInput}
          onCancel={() => setCreateFolderDialog(undefined)}
          onConfirm={(value) => {
            onCreateFolder(createFolderDialog.parentId, value.trim())
            setCreateFolderDialog(undefined)
          }}
        />
      ) : null}
      {renameNodeDialog ? (
        <LibraryTextInputDialog
          title={`Rename ${renameNodeDialog.name}`}
          body="Choose a clear Library name. This does not expose or change any stored secrets."
          inputLabel="Name"
          initialValue={renameNodeDialog.name}
          confirmLabel="Rename"
          validate={validateRequiredLibraryInput}
          onCancel={() => setRenameNodeDialog(undefined)}
          onConfirm={(value) => {
            onRenameNode(renameNodeDialog.id, value.trim())
            setRenameNodeDialog(undefined)
          }}
        />
      ) : null}
      {moveNodeDialog ? (
        <LibraryTextInputDialog
          title={`Move ${moveNodeDialog.node.name}`}
          body="Enter a Library folder path, or leave it blank to move this item to the root."
          inputLabel="Folder path"
          initialValue={moveNodeDialog.initialPath}
          placeholder="QA/MongoDB"
          confirmLabel="Move"
          validate={(value) => {
            const trimmed = value.trim()
            if (!trimmed) {
              return undefined
            }

            const parentId = findFolderIdByPath(libraryNodes, trimmed)
            if (!parentId) {
              return 'No folder exists at that path.'
            }

            if (!canMoveLibraryNode(libraryNodes, moveNodeDialog.node.id, parentId)) {
              return 'This item cannot be moved into that folder.'
            }

            return undefined
          }}
          onCancel={() => setMoveNodeDialog(undefined)}
          onConfirm={(value) => {
            const parentId = value.trim()
              ? findFolderIdByPath(libraryNodes, value.trim())
              : undefined
            onMoveNode(moveNodeDialog.node.id, parentId)
            setMoveNodeDialog(undefined)
          }}
        />
      ) : null}
    </>
  )
}

function LibraryTreeItem({
  activeConnectionId,
  activeEnvironmentId,
  adapterManifests,
  connections,
  item,
  environments,
  explorerStatus,
  getConnectionExplorerItems,
  getConnectionExplorerStatus,
  isExplorerScopeLoading,
  libraryNodes,
  draggedNodeId,
  folderDropTargetId,
  sectionStates,
  depth,
  onContextMenu,
  onCreateConnection,
  onCreateFolder,
  onCreateTab,
  onCreateTestSuite,
  onDeleteConnection,
  onDeleteNode,
  onDuplicateConnection,
  onBeginPointerDrag,
  onClearDrag,
  onFinishPointerDrag,
  onLoadExplorerScope,
  onOpenConnectionDrawer,
  onOpenConnectionExplorer,
  onOpenConnectionMetrics,
  onInspectExplorerNode,
  onOpenObjectView,
  onOpenScopedQuery,
  onOpenLibraryItem,
  onPointerDragMove,
  onRenameNode,
  onSelectConnection,
  onSidebarSectionExpandedChange,
  onTestConnection,
  shouldSuppressOpenClick,
}: {
  activeConnectionId: string
  activeEnvironmentId: string
  adapterManifests: AdapterManifest[]
  connections: ConnectionProfile[]
  item: TreeNode
  environments: EnvironmentProfile[]
  explorerStatus: 'idle' | 'loading' | 'ready'
  getConnectionExplorerItems(connectionId: string, environmentId?: string): ExplorerNode[] | undefined
  getConnectionExplorerStatus(connectionId: string, environmentId?: string): 'idle' | 'loading' | 'ready'
  isExplorerScopeLoading(connectionId: string, scope?: string, environmentId?: string): boolean
  libraryNodes: LibraryNode[]
  draggedNodeId?: string
  folderDropTargetId?: string
  sectionStates: Record<string, boolean>
  depth: number
  onContextMenu(state: LibraryContextMenuState): void
  onCreateConnection(parentId?: string): void
  onCreateFolder(parentId?: string): void
  onCreateTab(connectionId?: string): void
  onCreateTestSuite(connectionId?: string): void
  onDeleteConnection(connectionId: string): void
  onDeleteNode(node: LibraryNode): void
  onDuplicateConnection(connectionId: string): void
  onBeginPointerDrag(nodeId: string, event: ReactPointerEvent<HTMLElement>): void
  onClearDrag(): void
  onFinishPointerDrag(event: ReactPointerEvent<HTMLElement>): void
  onLoadExplorerScope(connectionId: string, scope?: string, environmentId?: string): void
  onOpenConnectionDrawer(connectionId: string): void
  onOpenConnectionExplorer(connectionId: string): void
  onOpenConnectionMetrics(connectionId: string): void
  onInspectExplorerNode(node: ExplorerNode): void
  onOpenObjectView(connectionId: string, node: ExplorerNode): void
  onOpenScopedQuery(connectionId: string, target: ScopedQueryTarget): void
  onOpenLibraryItem(nodeId: string): void
  onPointerDragMove(event: ReactPointerEvent<HTMLElement>): void
  onRenameNode(node: LibraryNode): void
  onSelectConnection(connectionId: string): void
  onSidebarSectionExpandedChange(sectionId: string, expanded: boolean): void
  onTestConnection(connectionId: string): void
  shouldSuppressOpenClick(nodeId: string): boolean
}) {
  const { node, children } = item
  const isFolder = node.kind === 'folder'
  const connection = node.kind === 'connection' && node.connectionId
    ? connections.find((candidate) => candidate.id === node.connectionId)
    : undefined
  const isConnection = Boolean(connection)
  const isContainer = isFolder || isConnection
  const sectionId = sidebarSectionId('library', 'node', node.id)
  const [optimisticExpanded, setOptimisticExpanded] = useState<boolean>()
  const expanded = optimisticExpanded ?? sectionStates[sectionId] ?? (isFolder && depth === 0)
  const environmentState = effectiveEnvironmentForNode(node, libraryNodes, environments)
  const environment = environmentState?.environment
  const connectionEnvironmentId = environment?.id ?? activeEnvironmentId
  const connectionExplorerStatus = connection
    ? getConnectionExplorerStatus(connection.id, connectionEnvironmentId)
    : explorerStatus
  const isLoadingMetadata = Boolean(
    connection &&
      (isExplorerScopeLoading(connection.id, undefined, connectionEnvironmentId) ||
        connectionExplorerStatus === 'loading'),
  )
  const canDropOnFolder =
    isFolder && Boolean(draggedNodeId) && canMoveLibraryNode(libraryNodes, draggedNodeId, node.id)

  return (
    <div
      className={`library-tree-item${draggedNodeId === node.id ? ' is-dragging' : ''}${
        canDropOnFolder && folderDropTargetId === node.id ? ' is-folder-drop-target' : ''
      }`}
      role="treeitem"
      aria-expanded={isContainer ? expanded : undefined}
      onDoubleClick={() => {
        if (connection) {
          onOpenConnectionExplorer(connection.id)
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu({ node, x: event.clientX, y: event.clientY })
      }}
    >
      <div
        className={`library-tree-row${
          environmentState ? ` has-library-env is-library-env-${environmentState.source}` : ''
        }`}
        data-library-folder-id={isFolder ? node.id : undefined}
        data-library-row="true"
        style={{
          paddingLeft: 8 + depth * 14,
          ...libraryEnvironmentStyle(environment),
        }}
      >
        {isContainer ? (
          <button
            type="button"
            className="sidebar-icon-button sidebar-icon-button--inline"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${
              connection ? `connection ${node.name}` : node.name
            }`}
            onClick={() => {
              const nextExpanded = !expanded
              setOptimisticExpanded(nextExpanded)
              onSidebarSectionExpandedChange(sectionId, nextExpanded)
              if (connection && nextExpanded) {
                onLoadExplorerScope(connection.id, undefined, connectionEnvironmentId)
              }
            }}
          >
            {expanded ? (
              <ChevronDownIcon className="sidebar-icon" />
            ) : (
              <ChevronRightIcon className="sidebar-icon" />
            )}
          </button>
        ) : (
          <span className="library-tree-spacer" />
        )}
        <button
          type="button"
          className="library-tree-label"
          onPointerDown={(event) => onBeginPointerDrag(node.id, event)}
          onPointerMove={onPointerDragMove}
          onPointerUp={onFinishPointerDrag}
          onPointerCancel={() => {
            onClearDrag()
          }}
          onDoubleClick={() => {
            if (connection) {
              onOpenConnectionExplorer(connection.id)
              return
            }
            onRenameNode(node)
          }}
          onClick={() => {
            if (shouldSuppressOpenClick(node.id)) {
              return
            }
            if (connection) {
              onSelectConnection(connection.id)
              if (expanded) {
                onLoadExplorerScope(connection.id, undefined, connectionEnvironmentId)
              }
              return
            }
            if (!isFolder) {
              onOpenLibraryItem(node.id)
            }
          }}
        >
          {connection ? (
            <span className="library-node-icon library-node-icon--connection">
              <EngineIcon connection={connection} />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className={`library-node-icon library-node-icon--${node.kind}`}
            >
              {node.kind === 'folder' ? (
                expanded ? (
                  <TreeFolderOpenIcon className="library-node-kind-icon library-node-kind-icon--folder" />
                ) : (
                  <TreeFolderIcon className="library-node-kind-icon library-node-kind-icon--folder" />
                )
              ) : node.kind === 'query' ? (
                <QueryIcon className="library-node-kind-icon" />
              ) : null}
            </span>
          )}
          <span>{node.name}</span>
        </button>
        <span className="library-tree-meta">
          {isLoadingMetadata && connection ? (
            <span
              className="connection-metadata-spinner"
              role="status"
              aria-label={`Loading metadata for ${connection.name}`}
              title="Loading metadata"
            />
          ) : null}
          {environmentState?.source === 'direct' ? (
            <span
              className={`library-env-badge is-${environmentState.source}`}
              title={environmentBadgeTitle(environmentState)}
          >
            {environmentState.environment.label}
          </span>
        ) : null}
          <button
            type="button"
            className="sidebar-icon-button sidebar-icon-button--inline library-row-menu-button"
            aria-label={`Open actions for ${node.name}`}
            title={`Open actions for ${node.name}`}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onContextMenu({ node, x: event.clientX, y: event.clientY })
            }}
          >
            <MoreIcon className="sidebar-icon" />
          </button>
        </span>
      </div>
      {connection && expanded ? (
        <ConnectionObjectTree
          adapterManifest={adapterManifests?.find(
            (manifest) => manifest.engine === connection.engine,
          )}
          connection={connection}
          environment={environment}
          explorerNodes={
            getConnectionExplorerItems(connection.id, connectionEnvironmentId)
          }
          explorerStatus={connectionExplorerStatus}
          isExplorerScopeLoading={(connectionId, scope) =>
            isExplorerScopeLoading(connectionId, scope, connectionEnvironmentId)
          }
          visualDepthOffset={depth}
          onLoadExplorerScope={(connectionId, scope) =>
            onLoadExplorerScope(connectionId, scope, connectionEnvironmentId)
          }
          onInspectNode={onInspectExplorerNode}
          onOpenObjectView={onOpenObjectView}
          onOpenScopedQuery={onOpenScopedQuery}
        />
      ) : null}
      {isFolder && expanded && children.length > 0 ? (
        <div role="group">
          {children.map((child) => (
            <LibraryTreeItem
              key={child.node.id}
              activeConnectionId={activeConnectionId}
              activeEnvironmentId={activeEnvironmentId}
              adapterManifests={adapterManifests}
              connections={connections}
              item={child}
              environments={environments}
              explorerStatus={explorerStatus}
              getConnectionExplorerItems={getConnectionExplorerItems}
              getConnectionExplorerStatus={getConnectionExplorerStatus}
              isExplorerScopeLoading={isExplorerScopeLoading}
              libraryNodes={libraryNodes}
              draggedNodeId={draggedNodeId}
              folderDropTargetId={folderDropTargetId}
              sectionStates={sectionStates}
              depth={depth + 1}
              onContextMenu={onContextMenu}
              onCreateConnection={onCreateConnection}
              onCreateFolder={onCreateFolder}
              onCreateTab={onCreateTab}
              onCreateTestSuite={onCreateTestSuite}
              onDeleteConnection={onDeleteConnection}
              onDeleteNode={onDeleteNode}
              onDuplicateConnection={onDuplicateConnection}
              onBeginPointerDrag={onBeginPointerDrag}
              onClearDrag={onClearDrag}
              onFinishPointerDrag={onFinishPointerDrag}
              onLoadExplorerScope={onLoadExplorerScope}
              onOpenConnectionDrawer={onOpenConnectionDrawer}
              onOpenConnectionExplorer={onOpenConnectionExplorer}
              onOpenConnectionMetrics={onOpenConnectionMetrics}
              onInspectExplorerNode={onInspectExplorerNode}
              onOpenObjectView={onOpenObjectView}
              onOpenScopedQuery={onOpenScopedQuery}
              onOpenLibraryItem={onOpenLibraryItem}
              onPointerDragMove={onPointerDragMove}
              onRenameNode={onRenameNode}
              onSelectConnection={onSelectConnection}
              onSidebarSectionExpandedChange={onSidebarSectionExpandedChange}
              onTestConnection={onTestConnection}
              shouldSuppressOpenClick={shouldSuppressOpenClick}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function filterLibraryNodes(nodes: LibraryNode[], filter: string) {
  const normalizedFilter = filter.trim().toLowerCase()
  if (!normalizedFilter) {
    return nodes
  }

  const matchingIds = new Set<string>()
  nodes.forEach((node) => {
    const haystack = `${node.name} ${node.kind} ${node.summary ?? ''} ${(node.tags ?? []).join(
      ' ',
    )}`.toLowerCase()
    if (haystack.includes(normalizedFilter)) {
      matchingIds.add(node.id)
      let parentId = node.parentId
      while (parentId) {
        matchingIds.add(parentId)
        parentId = nodes.find((candidate) => candidate.id === parentId)?.parentId
      }
    }
  })

  return nodes.filter((node) => matchingIds.has(node.id))
}

function buildLibraryTree(nodes: LibraryNode[]) {
  const byParent = new Map<string, LibraryNode[]>()
  nodes.forEach((node) => {
    byParent.set(node.parentId ?? 'root', [...(byParent.get(node.parentId ?? 'root') ?? []), node])
  })

  const build = (parentId: string): TreeNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort(sortLibraryNodes)
      .map((node) => ({
        node,
        children: build(node.id),
      }))

  return build('root')
}

function sortLibraryNodes(left: LibraryNode, right: LibraryNode) {
  if (left.kind === 'folder' && right.kind !== 'folder') {
    return -1
  }
  if (left.kind !== 'folder' && right.kind === 'folder') {
    return 1
  }
  return left.name.localeCompare(right.name)
}

function recentLibraryNodes(nodes: LibraryNode[]) {
  return nodes
    .filter((node) => node.kind !== 'folder' && Boolean(node.lastOpenedAt))
    .slice()
    .sort((left, right) => timestampValue(right.lastOpenedAt) - timestampValue(left.lastOpenedAt))
    .slice(0, 8)
}

function dropTargetFromPoint(
  clientX: number,
  clientY: number,
  nodeId: string,
  nodes: LibraryNode[],
): LibraryDropTarget | undefined {
  const element = document.elementFromPoint(clientX, clientY)

  if (!(element instanceof Element)) {
    return undefined
  }

  const folderRow = element.closest<HTMLElement>('[data-library-folder-id]')
  const folderId = folderRow?.dataset.libraryFolderId

  if (folderId && canMoveLibraryNode(nodes, nodeId, folderId)) {
    return { kind: 'folder', parentId: folderId }
  }

  const insideLibraryRoot = element.closest('[data-library-drop-root="true"]')
  const insideLibraryRow = element.closest('[data-library-row="true"]')

  if (insideLibraryRoot && !insideLibraryRow && canMoveLibraryNode(nodes, nodeId)) {
    return { kind: 'root' }
  }

  return undefined
}

function effectiveEnvironmentForNode(
  node: LibraryNode,
  nodes: LibraryNode[],
  environments: EnvironmentProfile[],
): LibraryEnvironmentState | undefined {
  let current: LibraryNode | undefined = node
  const visited = new Set<string>()

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.environmentId) {
      const environment = environments.find((item) => item.id === current?.environmentId)

      return environment
        ? {
            environment,
            source: current.id === node.id ? 'direct' : 'inherited',
            sourceNode: current,
          }
        : undefined
    }
    current = current.parentId
      ? nodes.find((candidate) => candidate.id === current?.parentId)
      : undefined
  }

  return undefined
}

function environmentBadgeTitle(state: LibraryEnvironmentState) {
  return state.source === 'direct'
    ? `${state.environment.label} is assigned here.`
    : `${state.environment.label} is inherited from ${state.sourceNode.name}.`
}

function libraryEnvironmentStyle(environment?: EnvironmentProfile): CSSProperties | undefined {
  const color = normalizeHexColor(environment?.color)

  if (!color) {
    return undefined
  }

  return {
    '--library-env-color': color,
    '--library-env-tint': hexToRgba(color, 0.08),
    '--library-env-border': hexToRgba(color, 0.36),
  } as CSSProperties
}

function normalizeHexColor(color?: string) {
  if (!color) {
    return undefined
  }

  const trimmed = color.trim()

  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed
  }

  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, red, green, blue] = trimmed
    return `#${red}${red}${green}${green}${blue}${blue}`
  }

  return undefined
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function readInitialRecentsHeight() {
  const raw = window.localStorage.getItem('datapadplusplus.library.recentsHeight')
  const parsed = raw ? Number(raw) : DEFAULT_RECENTS_HEIGHT
  return clamp(parsed, MIN_RECENTS_HEIGHT, MAX_RECENTS_HEIGHT)
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, value))
}

function formatClosedAt(closedAt: string) {
  const date = new Date(closedAt)

  if (Number.isNaN(date.getTime())) {
    return 'Closed recently'
  }

  return `Closed ${date.toLocaleString()}`
}

function formatRecentAt(openedAt: string | undefined) {
  if (!openedAt) {
    return 'Opened recently'
  }

  const date = new Date(openedAt)

  if (Number.isNaN(date.getTime())) {
    return 'Opened recently'
  }

  return `Opened ${date.toLocaleString()}`
}

function timestampValue(value: string | undefined) {
  if (!value) {
    return 0
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}
