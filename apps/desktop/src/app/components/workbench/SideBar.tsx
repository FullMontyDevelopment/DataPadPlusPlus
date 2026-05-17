import { useMemo, useRef, useState } from 'react'
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
import { ConnectionsPane } from './SideBar.connections-pane'
import { connectionGroupLabel } from './SideBar.helpers'
import { EnvironmentsPane } from './SideBar.environments-pane'
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
  closedTabs: ClosedQueryTabSnapshot[]
  explorerItems: ExplorerNode[]
  connectionExplorerItems: ExplorerNode[]
  explorerSummary?: string
  explorerStatus: 'idle' | 'loading' | 'ready'
  activeConnectionId: string
  activeEnvironmentId: string
  onSelectConnection(connectionId: string): void
  onSelectEnvironment(environmentId: string): void
  onCreateConnection(): void
  onCreateEnvironment(): void
  onConnectionGroupModeChange(value: ConnectionGroupMode): void
  onSidebarSectionExpandedChange(sectionId: string, expanded: boolean): void
  onDuplicateConnection(connectionId: string): void
  onDeleteConnection(connectionId: string): void
  onOpenConnectionExplorer(connectionId: string): void
  onOpenConnectionMetrics(connectionId: string): void
  onOpenConnectionDrawer(connectionId: string): void
  onLoadExplorerScope(connectionId: string, scope?: string): void
  onOpenScopedQuery(connectionId: string, target: ScopedQueryTarget): void
  onCreateTab(connectionId?: string): void
  onCreateTestSuite(connectionId?: string): void
  onOpenTestSuiteTemplate(connectionId: string, templateId: string): void
  onSaveCurrentQuery(): void
  onCreateLibraryFolder(parentId?: string): void
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
  connectionExplorerItems,
  explorerSummary,
  explorerStatus,
  activeConnectionId,
  activeEnvironmentId,
  onSelectConnection,
  onSelectEnvironment,
  onCreateConnection,
  onCreateEnvironment,
  onConnectionGroupModeChange,
  onSidebarSectionExpandedChange,
  onDuplicateConnection,
  onDeleteConnection,
  onOpenConnectionExplorer,
  onOpenConnectionMetrics,
  onOpenConnectionDrawer,
  onLoadExplorerScope,
  onOpenScopedQuery,
  onCreateTab,
  onCreateTestSuite,
  onOpenTestSuiteTemplate,
  onSaveCurrentQuery,
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
}: SideBarProps) {
  const [connectionFilter, setConnectionFilter] = useState('')
  const connectionGroupMode = ui.connectionGroupMode ?? 'none'
  const [environmentFilter, setEnvironmentFilter] = useState('')
  const [libraryFilter, setLibraryFilter] = useState('')
  const [isResizing, setIsResizing] = useState(false)
  const lastPointerX = useRef(0)
  const sidebarSectionStates = ui.sidebarSectionStates ?? {}
  const connectionGroups = useMemo(() => {
    const filtered = connections.filter((connection) => {
      const haystack = `${connection.name} ${connection.engine} ${connection.group ?? ''} ${connection.tags.join(' ')}`.toLowerCase()
      return haystack.includes(connectionFilter.toLowerCase())
    })

    return filtered.reduce<Record<string, ConnectionProfile[]>>((accumulator, connection) => {
      const group = connectionGroupLabel(connection, connectionGroupMode, environments)
      accumulator[group] ??= []
      accumulator[group].push(connection)
      return accumulator
    }, {})
  }, [connectionFilter, connectionGroupMode, connections, environments])
  const filteredEnvironments = useMemo(() => {
    const filter = environmentFilter.toLowerCase()

    return environments.filter((environment) => {
      const haystack =
        `${environment.label} ${environment.risk} ${Object.keys(environment.variables).join(' ')}`.toLowerCase()
      return haystack.includes(filter)
    })
  }, [environmentFilter, environments])

  return (
    <aside className="workbench-sidebar" aria-label={`${ui.activeSidebarPane} sidebar`}>
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
          lastPointerX.current = event.clientX
          setIsResizing(true)
        }}
        onPointerMove={(event) => {
          if (!isResizing) {
            return
          }

          const delta = event.clientX - lastPointerX.current
          lastPointerX.current = event.clientX
          onResize(width + delta)
        }}
        onPointerUp={() => setIsResizing(false)}
        onPointerCancel={() => setIsResizing(false)}
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

      {ui.activeSidebarPane === 'connections' ? (
        <ConnectionsPane
          activeConnectionId={activeConnectionId}
          adapterManifests={adapterManifests}
          connectionFilter={connectionFilter}
          connectionGroupMode={connectionGroupMode}
          connectionGroups={connectionGroups}
          environments={environments}
          explorerNodes={connectionExplorerItems}
          explorerStatus={explorerStatus}
          sectionStates={sidebarSectionStates}
          onConnectionFilterChange={setConnectionFilter}
          onConnectionGroupModeChange={onConnectionGroupModeChange}
          onSidebarSectionExpandedChange={onSidebarSectionExpandedChange}
          onCreateConnection={onCreateConnection}
          onDeleteConnection={onDeleteConnection}
          onDuplicateConnection={onDuplicateConnection}
          onOpenConnectionExplorer={onOpenConnectionExplorer}
          onOpenConnectionMetrics={onOpenConnectionMetrics}
          onOpenConnectionDrawer={onOpenConnectionDrawer}
          onLoadExplorerScope={onLoadExplorerScope}
          onOpenScopedQuery={onOpenScopedQuery}
          onCreateTab={onCreateTab}
          onSelectConnection={onSelectConnection}
        />
      ) : null}

      {ui.activeSidebarPane === 'environments' ? (
        <EnvironmentsPane
          activeEnvironmentId={activeEnvironmentId}
          environmentFilter={environmentFilter}
          environments={filteredEnvironments}
          onCreateEnvironment={onCreateEnvironment}
          onEnvironmentFilterChange={setEnvironmentFilter}
          onSelectEnvironment={onSelectEnvironment}
        />
      ) : null}

      {ui.activeSidebarPane === 'explorer' ? (
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

      {ui.activeSidebarPane === 'library' ? (
        <LibraryPane
          closedTabs={closedTabs}
          environments={environments}
          libraryFilter={libraryFilter}
          libraryNodes={libraryNodes}
          sectionStates={sidebarSectionStates}
          onCreateFolder={onCreateLibraryFolder}
          onDeleteNode={onDeleteLibraryNode}
          onMoveNode={onMoveLibraryNode}
          onOpenLibraryItem={onOpenLibraryItem}
          onRenameNode={onRenameLibraryNode}
          onSetNodeEnvironment={onSetLibraryNodeEnvironment}
          onReopenClosedTab={onReopenClosedTab}
          onSidebarSectionExpandedChange={onSidebarSectionExpandedChange}
          onSaveCurrentQuery={onSaveCurrentQuery}
          onLibraryFilterChange={setLibraryFilter}
        />
      ) : null}

      {ui.activeSidebarPane === 'tests' ? (
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

