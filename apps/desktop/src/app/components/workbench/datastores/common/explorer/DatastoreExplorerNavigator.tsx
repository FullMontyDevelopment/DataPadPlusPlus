import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ExplorerNode } from '@datapadplusplus/shared-types'
import { explorerScopeKey } from '../../../../../state/app-state-reducer-helpers'
import { ExplorerNodeIcon } from '../../../SideBar.node-icons'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  RefreshIcon,
  WarningIcon,
} from '../../../icons'
import type { DatastoreExplorerNavigatorProps } from '../../types'
import type { DatastoreExplorerProvider } from './DatastoreExplorerProvider.types'
import {
  buildExplorerTree,
  filterExplorerTree,
  type DatastoreExplorerTreeItem,
} from './DatastoreExplorerProvider.model'

export function DatastoreExplorerNavigator({
  provider,
  connection,
  environment,
  scopes,
  filter,
  selectedNodeId,
  compact,
  isScopeLoading,
  getScopeError,
  onLoadScope,
  onSelectNode,
  onNodeContextMenu,
}: DatastoreExplorerNavigatorProps & { provider: DatastoreExplorerProvider }) {
  const tree = useMemo(
    () => filterExplorerTree(buildExplorerTree(connection, scopes), filter),
    [connection, filter, scopes],
  )
  const normalizedFilter = filter.trim().toLowerCase()
  const [expansionOverrides, setExpansionOverrides] = useState<Map<string, boolean>>(new Map())
  const [searchExpansionState, setSearchExpansionState] = useState<{
    filter: string
    overrides: Map<string, boolean>
  }>(() => ({ filter: '', overrides: new Map() }))
  const activeExpansionOverrides =
    normalizedFilter && searchExpansionState.filter === normalizedFilter
      ? searchExpansionState.overrides
      : normalizedFilter
        ? EMPTY_EXPANSION_OVERRIDES
        : expansionOverrides
  const rootResponse = scopes[explorerScopeKey(undefined)]
  const rootError = getScopeError(undefined)
  const rootLoading = isScopeLoading(undefined)

  useEffect(() => {
    if (!rootResponse && !rootError && !isScopeLoading(undefined)) {
      onLoadScope()
    }
  }, [isScopeLoading, onLoadScope, rootError, rootResponse])

  const toggle = (item: DatastoreExplorerTreeItem, currentlyExpanded: boolean) => {
    const opening = !currentlyExpanded
    if (normalizedFilter) {
      setSearchExpansionState((current) => {
        const next = new Map(
          current.filter === normalizedFilter ? current.overrides : undefined,
        )
        next.set(item.id, opening)
        return { filter: normalizedFilter, overrides: next }
      })
    } else {
      setExpansionOverrides((current) => {
        const next = new Map(current)
        next.set(item.id, opening)
        return next
      })
    }
    if (
      opening
      && item.node?.scope
      && !scopes[explorerScopeKey(item.node.scope)]
      && !isScopeLoading(item.node.scope)
    ) {
      onLoadScope(item.node.scope)
    }
  }

  if (rootError && !rootResponse) {
    return (
      <ExplorerNavigationState
        title="Metadata unavailable"
        detail={rootError}
        onRetry={() => onLoadScope()}
      />
    )
  }
  if (!rootResponse && isScopeLoading(undefined)) {
    return <ExplorerNavigationState title="Loading metadata…" detail={`Reading ${provider.label} metadata with safe limits.`} />
  }
  if (!tree.length) {
    return (
      <ExplorerNavigationState
        title={filter.trim() ? 'No matching objects' : 'No objects returned'}
        detail={filter.trim() ? 'Adjust the Explorer search.' : 'The selected scope is empty or unavailable to this account.'}
      />
    )
  }

  return (
    <div className={`datastore-explorer-navigator${compact ? ' is-compact' : ''}`} role="tree">
      {tree.map((item) => (
        <ExplorerTreeRow
          key={item.id}
          provider={provider}
          connection={connection}
          environment={environment}
          item={item}
          depth={0}
          expansionOverrides={activeExpansionOverrides}
          selectedNodeId={selectedNodeId}
          filterActive={Boolean(filter.trim())}
          scopes={scopes}
          isScopeLoading={isScopeLoading}
          getScopeError={getScopeError}
          onLoadScope={onLoadScope}
          onSelectNode={onSelectNode}
          onNodeContextMenu={onNodeContextMenu}
          onToggle={toggle}
        />
      ))}
      {rootResponse?.pageInfo?.hasMore && rootResponse.pageInfo.nextCursor ? (
        <button
          type="button"
          className="datastore-explorer-load-more"
          disabled={rootLoading}
          onClick={() => onLoadScope(undefined, rootResponse.pageInfo?.nextCursor)}
        >
          {rootLoading ? 'Loading…' : 'Load more root objects'}
        </button>
      ) : null}
    </div>
  )
}

function ExplorerTreeRow({
  provider,
  connection,
  environment,
  item,
  depth,
  expansionOverrides,
  selectedNodeId,
  filterActive,
  scopes,
  isScopeLoading,
  getScopeError,
  onLoadScope,
  onSelectNode,
  onNodeContextMenu,
  onToggle,
}: {
  provider: DatastoreExplorerProvider
  connection: DatastoreExplorerNavigatorProps['connection']
  environment: DatastoreExplorerNavigatorProps['environment']
  item: DatastoreExplorerTreeItem
  depth: number
  expansionOverrides: ReadonlyMap<string, boolean>
  selectedNodeId?: string
  filterActive: boolean
  scopes: DatastoreExplorerNavigatorProps['scopes']
  isScopeLoading(scope?: string): boolean
  getScopeError(scope?: string): string | undefined
  onLoadScope(scope?: string, cursor?: string): void
  onSelectNode(node: ExplorerNode): void
  onNodeContextMenu: DatastoreExplorerNavigatorProps['onNodeContextMenu']
  onToggle(item: DatastoreExplorerTreeItem, currentlyExpanded: boolean): void
}) {
  const node = item.node
  const scopeResponse = node?.scope ? scopes[explorerScopeKey(node.scope)] : undefined
  const scopeError = node?.scope ? getScopeError(node.scope) : undefined
  const scopeLoading = node?.scope ? isScopeLoading(node.scope) : false
  const hasChildren = item.children.length > 0 || Boolean(node?.expandable || node?.scope)
  const defaultExpanded =
    item.synthetic
    || (depth === 0 && !provider.systemKinds.has(item.kind))
  const expansionOverride = expansionOverrides.get(item.id)
  const isExpanded = expansionOverride ?? (filterActive || defaultExpanded)
  const count = scopeResponse?.pageInfo?.knownTotal ?? item.children.length
  const partial = Boolean(scopeResponse?.pageInfo?.hasMore)
  const system = provider.systemKinds.has(item.kind)

  return (
    <>
      <div
        className={`datastore-explorer-row${selectedNodeId === node?.id ? ' is-selected' : ''}${system ? ' is-system' : ''}${environment ? ' has-environment-accent' : ''}`}
        style={{
          '--explorer-depth': depth,
          '--connection-env-color': environment?.color,
        } as CSSProperties}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={node ? selectedNodeId === node.id : undefined}
        title={item.detail || `${item.label} ${item.kind}`}
      >
        <button
          type="button"
          className="datastore-explorer-chevron"
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.label}`}
          disabled={!hasChildren}
          onClick={() => onToggle(item, isExpanded)}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />
          ) : <span />}
        </button>
        <button
          type="button"
          className="datastore-explorer-node"
          onClick={() => {
            if (!node) {
              onToggle(item, isExpanded)
              return
            }
            if (!hasChildren) {
              onSelectNode(node)
              return
            }

            const selectionIsInBranch = Boolean(
              selectedNodeId && branchContainsNode(item, selectedNodeId),
            )
            onToggle(item, isExpanded)
            if (!selectionIsInBranch) {
              onSelectNode(node)
            }
          }}
          onContextMenu={(event) => node ? onNodeContextMenu?.(event, node) : undefined}
        >
          <ExplorerNodeIcon connection={connection} kind={item.kind} />
          <span className="datastore-explorer-node-copy">
            <strong>{item.label}</strong>
            <small>{item.detail || item.kind}</small>
          </span>
          {scopeLoading ? <RefreshIcon className="is-spinning" /> : null}
          {scopeError ? <WarningIcon className="is-error" /> : null}
          {count > 0 ? <span className="datastore-explorer-count">{count}{partial ? '+' : ''}</span> : null}
        </button>
      </div>
      {scopeError && isExpanded ? (
        <div
          className="datastore-explorer-inline-error"
          style={{ '--explorer-depth': depth + 1 } as CSSProperties}
        >
          <span>{scopeError}</span>
          <button type="button" onClick={() => onLoadScope(node?.scope)}>Retry</button>
        </div>
      ) : null}
      {isExpanded ? item.children.map((child) => (
        <ExplorerTreeRow
          key={child.id}
          provider={provider}
          connection={connection}
          environment={environment}
          item={child}
          depth={depth + 1}
          expansionOverrides={expansionOverrides}
          selectedNodeId={selectedNodeId}
          filterActive={filterActive}
          scopes={scopes}
          isScopeLoading={isScopeLoading}
          getScopeError={getScopeError}
          onLoadScope={onLoadScope}
          onSelectNode={onSelectNode}
          onNodeContextMenu={onNodeContextMenu}
          onToggle={onToggle}
        />
      )) : null}
      {isExpanded && scopeResponse?.pageInfo?.hasMore && scopeResponse.pageInfo.nextCursor ? (
        <button
          type="button"
          className="datastore-explorer-load-more"
          style={{ '--explorer-depth': depth + 1 } as CSSProperties}
          disabled={scopeLoading}
          onClick={() => onLoadScope(node?.scope, scopeResponse.pageInfo?.nextCursor)}
        >
          {scopeLoading ? 'Loading…' : `Load more ${item.label.toLowerCase()}`}
        </button>
      ) : null}
    </>
  )
}

const EMPTY_EXPANSION_OVERRIDES: ReadonlyMap<string, boolean> = new Map()

function branchContainsNode(item: DatastoreExplorerTreeItem, nodeId: string): boolean {
  return item.node?.id === nodeId
    || item.children.some((child) => branchContainsNode(child, nodeId))
}

function ExplorerNavigationState({
  title,
  detail,
  onRetry,
}: {
  title: string
  detail: string
  onRetry?: () => void
}) {
  return (
    <div className="datastore-explorer-navigation-state">
      <strong>{title}</strong>
      <span>{detail}</span>
      {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}
    </div>
  )
}
