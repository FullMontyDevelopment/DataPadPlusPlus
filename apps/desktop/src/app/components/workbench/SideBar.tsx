import { useEffect, useRef, useState } from 'react'
import type {
  AdapterManifest,
  ConnectionGroupMode,
  ConnectionProfile,
  DatastoreApiServerInstanceStatus,
  EnvironmentProfile,
  ExplorerNode,
  ExplorerResponse,
  LibraryNode,
  ScopedQueryTarget,
  UiState,
  WorkspaceSwitcherStatus,
} from '@datapadplusplus/shared-types'
import type { ConnectionHealth } from '../../state/connection-health'
import { ExplorerPane } from './SideBar.explorer-pane'
import { LibraryPane } from './SideBar.library-pane'
import { TestsPane } from './SideBar.tests-pane'

interface SideBarProps {
  ui: UiState
  width: number
  connections: ConnectionProfile[]
  adapterManifests: AdapterManifest[]
  environments: EnvironmentProfile[]
  libraryNodes: LibraryNode[]
  explorerItems: ExplorerNode[]
  explorerFolderOrders?: Record<string, string[]>
  getConnectionExplorerItems?(connectionId: string, environmentId?: string): ExplorerNode[] | undefined
  getConnectionExplorerScopes?(connectionId: string, environmentId?: string): Record<string, ExplorerResponse> | undefined
  getConnectionExplorerStatus?(connectionId: string, environmentId?: string): 'idle' | 'loading' | 'ready'
  getConnectionExplorerScopeError?(connectionId: string, environmentId: string, scope?: string): string | undefined
  getConnectionHealth?(connectionId: string, environmentId?: string): ConnectionHealth | undefined
  explorerSummary?: string
  explorerStatus: 'idle' | 'loading' | 'ready'
  apiServerEnabled?: boolean
  activeApiServer?: boolean
  activeApiServerId?: string
  apiServers?: DatastoreApiServerInstanceStatus[]
  workspaceSearchEnabled?: boolean
  datastoreTestsEnabled?: boolean
  activeWorkspaceSearch?: boolean
  workspaceSwitcherStatus?: WorkspaceSwitcherStatus
  createFolderDialogRequestRevision?: number
  closeFolderDialogRequestRevision?: number
  isExplorerScopeLoading?(connectionId: string, scope?: string, environmentId?: string): boolean
  activeConnectionId: string
  activeEnvironmentId: string
  activeLibraryNodeId?: string
  onSelectConnection(connectionId: string): void
  onSelectEnvironment(environmentId: string): void
  onCreateConnection(parentId?: string): void
  onCreateEnvironment(): void
  onCloneEnvironment(environmentId: string): void
  onEditEnvironment(environmentId: string): void
  onDeleteEnvironment(environmentId: string): void
  onConnectionGroupModeChange(value: ConnectionGroupMode): void
  onSidebarSectionExpandedChange(sectionId: string, expanded: boolean): void
  onCollapseExplorerItems(sectionIds: string[]): void
  onDuplicateLibraryNode(nodeId: string): void
  onDeleteConnection(connectionId: string): void
  onOpenConnectionExplorer(connectionId: string): void
  onOpenConnectionMetrics(connectionId: string): void
  onOpenConnectionDrawer(connectionId: string): void
  onTestConnection(connectionId: string, environmentId?: string): void
  onLoadExplorerScope(connectionId: string, scope?: string, environmentId?: string, cursor?: string): void
  onOpenObjectView(connectionId: string, node: ExplorerNode): void
  onCreateApiServerFromNode?(connectionId: string, node: ExplorerNode): void
  onCreateApiServer?(): void
  onAddNodeToApiServer?(connectionId: string, node: ExplorerNode): void
  onOpenScopedQuery(connectionId: string, target: ScopedQueryTarget): void
  onCreateTab(connectionId?: string): void
  onOpenApiServer(serverId?: string): void
  onOpenWorkspaceSearch(): void
  onStartApiServer?(serverId: string): void
  onStopApiServer?(serverId: string): void
  onDeleteApiServer?(serverId: string): void
  onCreateTestSuite(
    connectionId?: string,
    scopedTarget?: ScopedQueryTarget,
  ): void
  onCreateWorkspace(name: string): void
  onOpenTestSuiteTemplate(connectionId: string, templateId: string): void
  onCreateLibraryFolder(parentId: string | undefined, name: string): void
  onDeleteLibraryNode(nodeId: string): void
  onMoveLibraryNode(nodeId: string, parentId?: string): void
  onOpenLibraryItem(nodeId: string): void
  onOpenTestSuiteCase(libraryItemId: string, caseId: string): void
  onRenameLibraryNode(nodeId: string, name: string): void
  onRenameWorkspace(workspaceId: string, name: string): void
  onSetLibraryNodeEnvironment(nodeId: string, environmentId?: string): void
  onSetExplorerFolderOrder(orderKey: string, orderedNodeKeys: string[]): void
  onSwitchWorkspace(workspaceId: string): void
  onExplorerFilterChange(value: string): void
  onRefreshExplorer(): void
  onSelectExplorerNode(node: ExplorerNode): void
  onInspectExplorerNode(node: ExplorerNode): void
  onResize(width: number): void
  onCollapseSidebar(): void
}

export function SideBar({
  ui,
  width,
  connections,
  adapterManifests,
  environments,
  libraryNodes,
  explorerItems,
  explorerFolderOrders,
  getConnectionExplorerItems,
  getConnectionExplorerScopes,
  getConnectionExplorerStatus,
  getConnectionExplorerScopeError,
  getConnectionHealth,
  explorerSummary,
  explorerStatus,
  apiServerEnabled = false,
  activeApiServer = false,
  activeApiServerId,
  apiServers,
  workspaceSearchEnabled = false,
  datastoreTestsEnabled = false,
  activeWorkspaceSearch = false,
  workspaceSwitcherStatus,
  createFolderDialogRequestRevision,
  closeFolderDialogRequestRevision,
  isExplorerScopeLoading,
  activeConnectionId,
  activeEnvironmentId,
  activeLibraryNodeId,
  onSelectConnection,
  onSelectEnvironment,
  onCreateConnection,
  onCreateEnvironment,
  onCloneEnvironment,
  onEditEnvironment,
  onDeleteEnvironment,
  onSidebarSectionExpandedChange,
  onCollapseExplorerItems,
  onDuplicateLibraryNode,
  onDeleteConnection,
  onOpenConnectionExplorer,
  onOpenConnectionMetrics,
  onOpenConnectionDrawer,
  onTestConnection,
  onLoadExplorerScope,
  onOpenObjectView,
  onCreateApiServerFromNode,
  onCreateApiServer,
  onAddNodeToApiServer,
  onOpenScopedQuery,
  onCreateTab,
  onOpenApiServer,
  onOpenWorkspaceSearch,
  onStartApiServer,
  onStopApiServer,
  onDeleteApiServer,
  onCreateTestSuite,
  onOpenTestSuiteTemplate,
  onCreateWorkspace,
  onCreateLibraryFolder,
  onDeleteLibraryNode,
  onMoveLibraryNode,
  onOpenLibraryItem,
  onOpenTestSuiteCase,
  onRenameLibraryNode,
  onRenameWorkspace,
  onSetLibraryNodeEnvironment,
  onSetExplorerFolderOrder,
  onSwitchWorkspace,
  onExplorerFilterChange,
  onRefreshExplorer,
  onSelectExplorerNode,
  onInspectExplorerNode,
  onResize,
  onCollapseSidebar,
}: SideBarProps) {
  const [libraryFilter, setLibraryFilter] = useState('')
  const [isResizing, setIsResizing] = useState(false)
  const lastPointerX = useRef(0)
  const resizeFrame = useRef<number | undefined>(undefined)
  const draftWidth = useRef(width)
  const workbenchRef = useRef<HTMLElement | null>(null)
  const isResizingRef = useRef(false)
  const sidebarSectionStates = ui.sidebarSectionStates ?? {}
  const activePane =
    ui.activeSidebarPane === 'connections' ||
    ui.activeSidebarPane === 'environments'
      ? 'library'
      : ui.activeSidebarPane
  const applyDraftWidth = (nextWidth: number) => {
    const clampedWidth = clampSidebarWidth(nextWidth)
    draftWidth.current = clampedWidth
    workbenchRef.current?.style.setProperty('--sidebar-width', `${clampedWidth}px`)
  }
  const scheduleDraftWidth = (nextWidth: number) => {
    draftWidth.current = clampSidebarWidth(nextWidth)
    if (resizeFrame.current !== undefined) {
      return
    }

    resizeFrame.current = window.requestAnimationFrame(() => {
      resizeFrame.current = undefined
      applyDraftWidth(draftWidth.current)
    })
  }
  const stopResizing = () => {
    if (!isResizingRef.current) {
      return
    }

    if (resizeFrame.current !== undefined) {
      window.cancelAnimationFrame(resizeFrame.current)
      resizeFrame.current = undefined
      applyDraftWidth(draftWidth.current)
    }

    document.body.classList.remove('is-sidebar-resizing')
    isResizingRef.current = false
    setIsResizing(false)
    onResize(draftWidth.current)
  }

  useEffect(() => {
    return () => {
      if (resizeFrame.current !== undefined) {
        window.cancelAnimationFrame(resizeFrame.current)
      }
      document.body.classList.remove('is-sidebar-resizing')
    }
  }, [])

  return (
    <aside
      className="workbench-sidebar"
      aria-label={`${activePane} sidebar`}
      data-tour-id="library-sidebar"
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={220}
        aria-valuemax={420}
        aria-valuenow={width}
        className={`pane-resize-handle pane-resize-handle--sidebar${isResizing ? ' is-active' : ''}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          workbenchRef.current = event.currentTarget.closest('.ads-workbench')
          lastPointerX.current = event.clientX
          draftWidth.current = clampSidebarWidth(width)
          isResizingRef.current = true
          document.body.classList.add('is-sidebar-resizing')
          setIsResizing(true)
        }}
        onPointerMove={(event) => {
          if (!isResizingRef.current) {
            return
          }

          const delta = event.clientX - lastPointerX.current
          lastPointerX.current = event.clientX
          scheduleDraftWidth(draftWidth.current + delta)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          stopResizing()
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          stopResizing()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            onResize(width - 16)
          }

          if (event.key === 'ArrowRight') {
            event.preventDefault()
            onResize(width + 16)
          }
        }}
      />

      {activePane === 'explorer' ? (
        <ExplorerPane
          activeConnection={connections.find((connection) => connection.id === activeConnectionId)}
          activeEnvironment={environments.find((environment) => environment.id === activeEnvironmentId)}
          explorerFilter={ui.explorerFilter}
          explorerItems={explorerItems}
          explorerStatus={explorerStatus}
          explorerSummary={explorerSummary}
          explorerScopes={getConnectionExplorerScopes?.(
            activeConnectionId,
            activeEnvironmentId,
          )}
          getExplorerScopeError={(scope) =>
            getConnectionExplorerScopeError?.(
              activeConnectionId,
              activeEnvironmentId,
              scope,
            )
          }
          isExplorerScopeLoading={(scope) =>
            isExplorerScopeLoading?.(
              activeConnectionId,
              scope,
              activeEnvironmentId,
            ) ?? false
          }
          onLoadExplorerScope={(scope, cursor) =>
            onLoadExplorerScope(
              activeConnectionId,
              scope,
              activeEnvironmentId,
              cursor,
            )
          }
          onExplorerFilterChange={onExplorerFilterChange}
          onRefreshExplorer={onRefreshExplorer}
          onInspectExplorerNode={onInspectExplorerNode}
          onSelectExplorerNode={onSelectExplorerNode}
          onOpenScopedQuery={(target) => onOpenScopedQuery(activeConnectionId, target)}
        />
      ) : null}

      {activePane === 'library' ? (
        <LibraryPane
          activeConnectionId={activeConnectionId}
          activeEnvironmentId={activeEnvironmentId}
          activeLibraryNodeId={activeLibraryNodeId}
          adapterManifests={adapterManifests}
          getConnectionExplorerItems={getConnectionExplorerItems}
          getConnectionExplorerScopes={getConnectionExplorerScopes}
          getConnectionExplorerStatus={getConnectionExplorerStatus}
          getConnectionHealth={getConnectionHealth}
          connections={connections}
          environments={environments}
          explorerStatus={explorerStatus}
          apiServerEnabled={apiServerEnabled}
          activeApiServer={activeApiServer}
          activeApiServerId={activeApiServerId}
          apiServers={apiServers}
          workspaceSearchEnabled={workspaceSearchEnabled}
          datastoreTestsEnabled={datastoreTestsEnabled}
          activeWorkspaceSearch={activeWorkspaceSearch}
          workspaceSwitcherStatus={workspaceSwitcherStatus}
          createFolderDialogRequestRevision={createFolderDialogRequestRevision}
          closeFolderDialogRequestRevision={closeFolderDialogRequestRevision}
          isExplorerScopeLoading={isExplorerScopeLoading}
          libraryFilter={libraryFilter}
          libraryNodes={libraryNodes}
          explorerFolderOrders={explorerFolderOrders}
          sectionStates={sidebarSectionStates}
          onCloneEnvironment={onCloneEnvironment}
          onCreateConnection={onCreateConnection}
          onCreateEnvironment={onCreateEnvironment}
          onCreateFolder={onCreateLibraryFolder}
          onCreateTab={onCreateTab}
          onCreateApiServer={onCreateApiServer}
          onOpenApiServer={onOpenApiServer}
          onOpenWorkspaceSearch={onOpenWorkspaceSearch}
          onStartApiServer={onStartApiServer}
          onStopApiServer={onStopApiServer}
          onDeleteApiServer={onDeleteApiServer}
          onCreateTestSuite={onCreateTestSuite}
          onCreateWorkspace={onCreateWorkspace}
          onDeleteConnection={onDeleteConnection}
          onDeleteEnvironment={onDeleteEnvironment}
          onDeleteNode={onDeleteLibraryNode}
          onDuplicateNode={onDuplicateLibraryNode}
          onEditEnvironment={onEditEnvironment}
          onMoveNode={onMoveLibraryNode}
          onLoadExplorerScope={onLoadExplorerScope}
          onOpenConnectionDrawer={onOpenConnectionDrawer}
          onOpenConnectionExplorer={onOpenConnectionExplorer}
          onOpenConnectionMetrics={onOpenConnectionMetrics}
          onInspectExplorerNode={onInspectExplorerNode}
          onCreateApiServerFromNode={onCreateApiServerFromNode}
          onAddNodeToApiServer={onAddNodeToApiServer}
          onOpenObjectView={onOpenObjectView}
          onOpenScopedQuery={onOpenScopedQuery}
          onOpenLibraryItem={onOpenLibraryItem}
          onOpenTestSuiteCase={onOpenTestSuiteCase}
          onRenameNode={onRenameLibraryNode}
          onRenameWorkspace={onRenameWorkspace}
          onSetNodeEnvironment={onSetLibraryNodeEnvironment}
          onSetExplorerFolderOrder={onSetExplorerFolderOrder}
          onSwitchWorkspace={onSwitchWorkspace}
          onSelectConnection={onSelectConnection}
          onSelectEnvironment={onSelectEnvironment}
          onSidebarSectionExpandedChange={onSidebarSectionExpandedChange}
          onCollapseExplorerItems={onCollapseExplorerItems}
          onLibraryFilterChange={setLibraryFilter}
          onCollapseSidebar={onCollapseSidebar}
          onTestConnection={onTestConnection}
        />
      ) : null}

      {activePane === 'tests' && datastoreTestsEnabled ? (
        <TestsPane
          activeConnectionId={activeConnectionId}
          connections={connections}
          environments={environments}
          libraryNodes={libraryNodes}
          onCreateTestSuite={onCreateTestSuite}
          onOpenLibraryItem={onOpenLibraryItem}
          onOpenTemplate={onOpenTestSuiteTemplate}
        />
      ) : null}
    </aside>
  )
}

function clampSidebarWidth(value: number) {
  return Math.min(420, Math.max(220, Math.round(value)))
}

