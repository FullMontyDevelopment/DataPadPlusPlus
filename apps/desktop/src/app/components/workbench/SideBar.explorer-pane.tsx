import { useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  ExplorerResponse,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { workbenchSliceForEngine } from './datastores/registry'
import { ContextMenuSurface } from './ContextMenuSurface'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExplorerIcon,
  RefreshIcon,
} from './icons'
import { ExplorerNodeIcon } from './SideBar.node-icons'
import {
  explorerNodeTarget,
  environmentAccentVariables,
  isExplorerNodeQueryable,
} from './SideBar.helpers'

export function ExplorerPane({
  activeConnection,
  activeEnvironment,
  explorerFilter,
  explorerItems,
  explorerStatus,
  explorerSummary,
  explorerScopes,
  getExplorerScopeError,
  isExplorerScopeLoading,
  onLoadExplorerScope,
  onExplorerFilterChange,
  onInspectExplorerNode,
  onOpenScopedQuery,
  onRefreshExplorer,
  onSelectExplorerNode,
}: {
  activeConnection?: ConnectionProfile
  activeEnvironment?: EnvironmentProfile
  explorerFilter: string
  explorerItems: ExplorerNode[]
  explorerStatus: 'idle' | 'loading' | 'ready'
  explorerSummary?: string
  explorerScopes?: Record<string, ExplorerResponse>
  onExplorerFilterChange(value: string): void
  getExplorerScopeError?(scope?: string): string | undefined
  isExplorerScopeLoading?(scope?: string): boolean
  onLoadExplorerScope?(scope?: string, cursor?: string): void
  onInspectExplorerNode(node: ExplorerNode): void
  onOpenScopedQuery(target: ScopedQueryTarget): void
  onRefreshExplorer(): void
  onSelectExplorerNode(node: ExplorerNode): void
}) {
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState>()
  const environmentStyle = environmentAccentVariables(activeEnvironment)
  const DatastoreExplorerNavigator = activeConnection
    ? workbenchSliceForEngine(activeConnection.engine).explorer.Navigator
    : undefined
  const openNodeQuery = (item: ExplorerNode) => {
    if (!isExplorerNodeQueryable(item)) {
      return
    }

    onOpenScopedQuery(explorerNodeTarget(item, activeConnection))
  }

  const openContextMenu = (event: MouseEvent<HTMLElement>, node: ExplorerNode) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      node,
      originElement: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
    })
  }

  const inspectNode = (node: ExplorerNode) => {
    onInspectExplorerNode(node)
  }

  return (
    <>
      <div className="sidebar-header">
        <h1>Explorer</h1>
        <div className="sidebar-actions">
          <button
            type="button"
            className="sidebar-icon-button"
            aria-label="Refresh explorer"
            title="Refresh metadata for the active connection. Loaded child nodes are kept open."
            onClick={onRefreshExplorer}
          >
            <RefreshIcon className="sidebar-icon" />
          </button>
        </div>
      </div>

      <label className="sidebar-search">
        <span className="sr-only">Filter explorer</span>
        <input
          type="search"
          placeholder="Filter explorer"
          value={explorerFilter}
          onChange={(event) => onExplorerFilterChange(event.target.value)}
        />
      </label>

      <div className="sidebar-meta-row">
        <span>{explorerSummary ?? 'Root objects'}</span>
        <span>{explorerStatus === 'loading' ? 'Loading' : `${explorerItems.length}`}</span>
      </div>

      <div className="sidebar-scroll">
        {!DatastoreExplorerNavigator && explorerItems.length === 0 ? (
          <div className="sidebar-empty">
            <ExplorerIcon className="empty-icon" />
            <p>No explorer metadata loaded.</p>
          </div>
        ) : null}

        {DatastoreExplorerNavigator && activeConnection ? (
          <DatastoreExplorerNavigator
            compact
            connection={activeConnection}
            environment={activeEnvironment}
            scopes={explorerScopes ?? {}}
            filter={explorerFilter}
            isScopeLoading={(scope) => isExplorerScopeLoading?.(scope) ?? false}
            getScopeError={(scope) => getExplorerScopeError?.(scope)}
            onLoadScope={(scope, cursor) => onLoadExplorerScope?.(scope, cursor)}
            onSelectNode={onSelectExplorerNode}
            onNodeContextMenu={openContextMenu}
          />
        ) : explorerItems.map((item) => {
          const depth = Math.max(0, (item.path?.length ?? 1) - 1)

          return (
            <button
              key={item.id}
              type="button"
              className={`tree-item explorer-tree-item${activeEnvironment ? ' has-environment-accent' : ''}`}
              style={{ '--tree-depth': depth, ...environmentStyle } as CSSProperties}
              title={
                item.expandable || item.scope
                  ? `${item.label}: inspect this ${item.kind} and load its child metadata.`
                  : `${item.label}: inspect this ${item.kind}.`
              }
              onClick={() => onSelectExplorerNode(item)}
              onDoubleClick={() => openNodeQuery(item)}
              onContextMenu={(event) => openContextMenu(event, item)}
            >
              <span className="tree-item-chevron">
                {item.expandable ? (
                  <ChevronRightIcon className="tree-icon" />
                ) : (
                  <ChevronDownIcon className="tree-icon tree-icon--muted" />
                )}
              </span>
              <span className="tree-item-badge tree-item-badge--ghost">
                <ExplorerNodeIcon connection={activeConnection} kind={item.kind} />
              </span>
              <span className="tree-item-content">
                <strong>{item.label}</strong>
                <span>
                  {item.kind}
                  {item.detail ? ` / ${item.detail}` : ''}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {contextMenu ? (
        <ExplorerContextMenu
          activeConnection={activeConnection}
          menu={contextMenu}
          onClose={() => setContextMenu(undefined)}
          onInspectNode={inspectNode}
          onOpenQuery={openNodeQuery}
        />
      ) : null}
    </>
  )
}

interface ExplorerContextMenuState {
  node: ExplorerNode
  originElement?: HTMLElement | null
  x: number
  y: number
}

function ExplorerContextMenu({
  activeConnection,
  menu,
  onClose,
  onInspectNode,
  onOpenQuery,
}: {
  activeConnection?: ConnectionProfile
  menu: ExplorerContextMenuState
  onClose(): void
  onInspectNode(node: ExplorerNode): void
  onOpenQuery(node: ExplorerNode): void
}) {
  const queryable = isExplorerNodeQueryable(menu.node)
  const run = (action: () => void) => {
    onClose()
    action()
  }

  return (
    <ContextMenuSurface
      anchorPoint={{ x: menu.x, y: menu.y }}
      ariaLabel={`Explorer options for ${menu.node.label}`}
      className="connection-context-menu"
      onClose={onClose}
      originElement={menu.originElement}
    >
      <button
        type="button"
        role="menuitem"
        className="connection-context-menu-item"
        aria-label={`Inspect ${menu.node.label}`}
        onClick={() => run(() => onInspectNode(menu.node))}
      >
        <ExplorerNodeIcon connection={activeConnection} kind={menu.node.kind} />
        <span>Inspect</span>
      </button>
      {queryable ? (
        <button
          type="button"
          role="menuitem"
          className="connection-context-menu-item"
          aria-label={`Open query for ${menu.node.label}`}
          onClick={() => run(() => onOpenQuery(menu.node))}
        >
          <ExplorerNodeIcon connection={activeConnection} kind={menu.node.kind} />
          <span>Open Query</span>
        </button>
      ) : null}
    </ContextMenuSurface>
  )
}
