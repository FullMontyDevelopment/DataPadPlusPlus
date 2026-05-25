import { useEffect, useRef, useState } from 'react'
import type {
  ClosedQueryTabSnapshot,
  AdapterManifest,
  ConnectionGroupMode,
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  LibraryNode,
  ScopedQueryTarget,
  UiState,
} from '@datapadplusplus/shared-types'
import { ExplorerPane } from './SideBar.explorer-pane'
import { LibraryPane } from './SideBar.library-pane'

interface SideBarProps {
  ui: UiState
  width: number
  connections: ConnectionProfile[]
  adapterManifests: AdapterManifest[]
  environments: EnvironmentProfile[]
  libraryNodes: LibraryNode[]
  closedTabs: ClosedQueryTabSnapshot[]
  explorerItems: ExplorerNode[]
  getConnectionExplorerItems?(connectionId: string, environmentId?: string): ExplorerNode[] | undefined
  getConnectionExplorerStatus?(connectionId: string, environmentId?: string): 'idle' | 'loading' | 'ready'
  explorerSummary?: string
  explorerStatus: 'idle' | 'loading' | 'ready'
  isExplorerScopeLoading?(connectionId: string, scope?: string, environmentId?: string): boolean
  activeConnectionId: string
  activeEnvironmentId: string
  onSelectConnection(connectionId: string): void
  onSelectEnvironment(environmentId: string): void
  onCreateConnection(parentId?: string): void
  onCreateEnvironment(): void
  onCloneEnvironment(environmentId: string): void
  onEditEnvironment(environmentId: string): void
  onDeleteEnvironment(environmentId: string): void
  onConnectionGroupModeChange(value: ConnectionGroupMode): void
  onSidebarSectionExpandedChange(sectionId: string, expanded: boolean): void
  onDuplicateConnection(connectionId: string): void
  onDeleteConnection(connectionId: string): void
  onOpenConnectionExplorer(connectionId: string): void
  onOpenConnectionMetrics(connectionId: string): void
  onOpenConnectionDrawer(connectionId: string): void
  onTestConnection(connectionId: string): void
  onLoadExplorerScope(connectionId: string, scope?: string, environmentId?: string): void
  onOpenObjectView(connectionId: string, node: ExplorerNode): void
  onOpenScopedQuery(connectionId: string, target: ScopedQueryTarget): void
  onCreateTab(connectionId?: string): void
  onCreateTestSuite(connectionId?: string): void
  onOpenTestSuiteTemplate(connectionId: string, templateId: string): void
  onCreateLibraryFolder(parentId: string | undefined, name: string): void
  onDeleteLibraryNode(nodeId: string): void
  onMoveLibraryNode(nodeId: string, parentId?: string): void
  onOpenLibraryItem(nodeId: string): void
  onRenameLibraryNode(nodeId: string, name: string): void
  onSetLibraryNodeEnvironment(nodeId: string, environmentId?: string): void
  onReopenClosedTab(closedTabId: string): void
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
  closedTabs,
  explorerItems,
  getConnectionExplorerItems,
  getConnectionExplorerStatus,
  explorerSummary,
  explorerStatus,
  isExplorerScopeLoading,
  activeConnectionId,
  activeEnvironmentId,
  onSelectConnection,
  onSelectEnvironment,
  onCreateConnection,
  onCreateEnvironment,
  onCloneEnvironment,
  onEditEnvironment,
  onDeleteEnvironment,
  onSidebarSectionExpandedChange,
  onDuplicateConnection,
  onDeleteConnection,
  onOpenConnectionExplorer,
  onOpenConnectionMetrics,
  onOpenConnectionDrawer,
  onTestConnection,
  onLoadExplorerScope,
  onOpenObjectView,
  onOpenScopedQuery,
  onCreateTab,
  onCreateTestSuite,
  onCreateLibraryFolder,
  onDeleteLibraryNode,
  onMoveLibraryNode,
  onOpenLibraryItem,
  onRenameLibraryNode,
  onSetLibraryNodeEnvironment,
  onReopenClosedTab,
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
    ui.activeSidebarPane === 'tests' ||
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
    <aside className="workbench-sidebar" aria-label={`${activePane} sidebar`}>
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
          adapterManifests={adapterManifests}
          closedTabs={closedTabs}
          getConnectionExplorerItems={getConnectionExplorerItems}
          getConnectionExplorerStatus={getConnectionExplorerStatus}
          connections={connections}
          environments={environments}
          explorerStatus={explorerStatus}
          isExplorerScopeLoading={isExplorerScopeLoading}
          libraryFilter={libraryFilter}
          libraryNodes={libraryNodes}
          sectionStates={sidebarSectionStates}
          onCloneEnvironment={onCloneEnvironment}
          onCreateConnection={onCreateConnection}
          onCreateEnvironment={onCreateEnvironment}
          onCreateFolder={onCreateLibraryFolder}
          onCreateTab={onCreateTab}
          onCreateTestSuite={onCreateTestSuite}
          onDeleteConnection={onDeleteConnection}
          onDeleteEnvironment={onDeleteEnvironment}
          onDeleteNode={onDeleteLibraryNode}
          onDuplicateConnection={onDuplicateConnection}
          onEditEnvironment={onEditEnvironment}
          onMoveNode={onMoveLibraryNode}
          onLoadExplorerScope={onLoadExplorerScope}
          onOpenConnectionDrawer={onOpenConnectionDrawer}
          onOpenConnectionExplorer={onOpenConnectionExplorer}
          onOpenConnectionMetrics={onOpenConnectionMetrics}
          onInspectExplorerNode={onInspectExplorerNode}
          onOpenObjectView={onOpenObjectView}
          onOpenScopedQuery={onOpenScopedQuery}
          onOpenLibraryItem={onOpenLibraryItem}
          onRenameNode={onRenameLibraryNode}
          onSetNodeEnvironment={onSetLibraryNodeEnvironment}
          onReopenClosedTab={onReopenClosedTab}
          onSelectConnection={onSelectConnection}
          onSelectEnvironment={onSelectEnvironment}
          onSidebarSectionExpandedChange={onSidebarSectionExpandedChange}
          onLibraryFilterChange={setLibraryFilter}
          onCollapseSidebar={onCollapseSidebar}
          onTestConnection={onTestConnection}
        />
      ) : null}
    </aside>
  )
}

function clampSidebarWidth(value: number) {
  return Math.min(420, Math.max(220, Math.round(value)))
}

