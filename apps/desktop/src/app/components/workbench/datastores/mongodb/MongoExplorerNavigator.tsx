import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionProfile, ExplorerNode, ExplorerResponse } from '@datapadplusplus/shared-types'
import type { DatastoreExplorerNavigatorProps } from '../types'
import { explorerScopeKey } from '../../../../state/app-state-reducer-helpers'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  RefreshIcon,
} from '../../icons'
import { ExplorerNodeIcon } from '../../SideBar.node-icons'

type MongoExplorerNavigatorProps = DatastoreExplorerNavigatorProps

export function MongoExplorerNavigator({
  connection,
  environment,
  scopes,
  filter,
  selectedNodeId,
  compact = false,
  isScopeLoading,
  getScopeError,
  onLoadScope,
  onSelectNode,
  onNodeContextMenu,
}: MongoExplorerNavigatorProps) {
  const [expandedNodeIds, setExpandedNodeIds] = useState(
    () => new Set(['mongodb-databases', 'databases']),
  )
  const [collapsedAutomaticNodeIds, setCollapsedAutomaticNodeIds] = useState(
    () => new Set<string>(),
  )
  const normalizedFilter = filter.trim().toLowerCase()
  const [searchExpansionState, setSearchExpansionState] = useState<{
    filter: string
    overrides: Map<string, boolean>
  }>(() => ({ filter: '', overrides: new Map() }))
  const searchExpansionOverrides =
    normalizedFilter && searchExpansionState.filter === normalizedFilter
      ? searchExpansionState.overrides
      : EMPTY_SEARCH_EXPANSION_OVERRIDES
  const [manualDatabaseName, setManualDatabaseName] = useState('')
  const [manualDatabases, setManualDatabases] = useState<string[]>([])
  const configuredDatabase = configuredMongoDatabase(connection)
  const rootResponse = scopes[explorerScopeKey(undefined)]
  const userDatabasesResponse = scopes[explorerScopeKey('databases')]

  useEffect(() => {
    if (!rootResponse && !isScopeLoading(undefined) && !getScopeError(undefined)) {
      onLoadScope()
    }
  }, [getScopeError, isScopeLoading, onLoadScope, rootResponse])

  useEffect(() => {
    if (
      rootResponse &&
      !userDatabasesResponse &&
      !isScopeLoading('databases') &&
      !getScopeError('databases')
    ) {
      onLoadScope('databases')
    }
  }, [
    getScopeError,
    isScopeLoading,
    onLoadScope,
    rootResponse,
    userDatabasesResponse,
  ])

  useEffect(() => {
    if (!configuredDatabase || !userDatabasesResponse) {
      return
    }
    const databaseNode = userDatabasesResponse.nodes.find(
      (node) => node.kind === 'database' && node.label === configuredDatabase,
    )
    if (!databaseNode) {
      return
    }

    if (
      !scopes[explorerScopeKey(databaseNode.scope)] &&
      !isScopeLoading(databaseNode.scope) &&
      !getScopeError(databaseNode.scope)
    ) {
      onLoadScope(databaseNode.scope)
    }
  }, [
    configuredDatabase,
    getScopeError,
    isScopeLoading,
    onLoadScope,
    scopes,
    userDatabasesResponse,
  ])
  const autoExpandedNodeId = userDatabasesResponse?.nodes.find(
    (node) => node.kind === 'database' && node.label === configuredDatabase,
  )?.id

  const roots = useMemo(() => {
    const rootNodes = rootResponse?.nodes ?? []
    return rootNodes.map((node) =>
      node.kind === 'databases' && manualDatabases.length
        ? {
            node,
            manualChildren: manualDatabases.map(mongoManualDatabaseNode),
          }
        : { node, manualChildren: [] },
    )
  }, [manualDatabases, rootResponse?.nodes])

  const addManualDatabase = () => {
    const databaseName = manualDatabaseName.trim()
    if (!databaseName) {
      return
    }
    setManualDatabases((current) =>
      current.includes(databaseName) ? current : [...current, databaseName].sort(),
    )
    setManualDatabaseName('')
    const node = mongoManualDatabaseNode(databaseName)
    setExpandedNodeIds((current) => new Set(current).add(node.id))
    onLoadScope(node.scope)
  }
  const setSearchExpansionOverride = (nodeId: string, expanded: boolean) => {
    setSearchExpansionState((current) => {
      const next = new Map(
        current.filter === normalizedFilter ? current.overrides : undefined,
      )
      next.set(nodeId, expanded)
      return { filter: normalizedFilter, overrides: next }
    })
  }

  return (
    <div className={`mongo-explorer-navigator${compact ? ' is-compact' : ''}`}>
      {!rootResponse && isScopeLoading(undefined) ? (
        <MongoExplorerState label="Loading MongoDB databases…" />
      ) : null}
      {!rootResponse && getScopeError(undefined) ? (
        <MongoExplorerError
          message={getScopeError(undefined)!}
          onRetry={() => onLoadScope()}
        />
      ) : null}
      {rootResponse && roots.length === 0 ? (
        <MongoExplorerState label="No MongoDB Explorer sections are available." />
      ) : null}
      {roots.map(({ node, manualChildren }) => (
        <MongoExplorerNodeRow
          key={node.id}
          node={node}
          depth={0}
          filter={filter}
          selectedNodeId={selectedNodeId}
          scopes={scopes}
          manualChildren={manualChildren}
          expandedNodeIds={expandedNodeIds}
          setExpandedNodeIds={setExpandedNodeIds}
          autoExpandedNodeId={autoExpandedNodeId}
          collapsedAutomaticNodeIds={collapsedAutomaticNodeIds}
          setCollapsedAutomaticNodeIds={setCollapsedAutomaticNodeIds}
          searchExpansionOverrides={searchExpansionOverrides}
          onSetSearchExpansionOverride={setSearchExpansionOverride}
          isScopeLoading={isScopeLoading}
          getScopeError={getScopeError}
          onLoadScope={onLoadScope}
          onSelectNode={onSelectNode}
          onNodeContextMenu={onNodeContextMenu}
          connection={connection}
          environment={environment}
          manualDatabaseControl={
            node.kind === 'databases' ? (
              <form
                className="mongo-explorer-manual-database"
                onSubmit={(event) => {
                  event.preventDefault()
                  addManualDatabase()
                }}
              >
                <DatabaseIcon />
                <input
                  aria-label="Open MongoDB database by name"
                  placeholder="Open database by name"
                  value={manualDatabaseName}
                  onChange={(event) => setManualDatabaseName(event.target.value)}
                />
                <button type="submit" disabled={!manualDatabaseName.trim()}>
                  Open
                </button>
              </form>
            ) : undefined
          }
        />
      ))}
    </div>
  )
}

interface MongoExplorerNodeRowProps extends Omit<
  MongoExplorerNavigatorProps,
  'filter' | 'compact' | 'selectedNodeId'
> {
  node: ExplorerNode
  depth: number
  filter: string
  selectedNodeId?: string
  manualChildren?: ExplorerNode[]
  expandedNodeIds: Set<string>
  setExpandedNodeIds(value: React.SetStateAction<Set<string>>): void
  autoExpandedNodeId?: string
  collapsedAutomaticNodeIds: Set<string>
  setCollapsedAutomaticNodeIds(value: React.SetStateAction<Set<string>>): void
  searchExpansionOverrides: ReadonlyMap<string, boolean>
  onSetSearchExpansionOverride(nodeId: string, expanded: boolean): void
  manualDatabaseControl?: React.ReactNode
}

function MongoExplorerNodeRow({
  node,
  depth,
  filter,
  selectedNodeId,
  scopes,
  manualChildren = [],
  expandedNodeIds,
  setExpandedNodeIds,
  autoExpandedNodeId,
  collapsedAutomaticNodeIds,
  setCollapsedAutomaticNodeIds,
  searchExpansionOverrides,
  onSetSearchExpansionOverride,
  isScopeLoading,
  getScopeError,
  onLoadScope,
  onSelectNode,
  onNodeContextMenu,
  connection,
  environment,
  manualDatabaseControl,
}: MongoExplorerNodeRowProps) {
  const lastRowToggleAtRef = useRef<number | undefined>(undefined)
  const scopeResponse = node.scope ? scopes[explorerScopeKey(node.scope)] : undefined
  const children = [...(scopeResponse?.nodes ?? []), ...manualChildren].filter(
    (child, index, items) => items.findIndex((candidate) => candidate.id === child.id) === index,
  )
  const normalizedFilter = filter.trim().toLowerCase()
  const visibleChildren = children.filter((child) =>
    nodeMatchesFilter(child, normalizedFilter, scopes),
  )
  const nodeMatches = nodeMatchesFilter(node, normalizedFilter, scopes)
  const hasUnloadedMatches = Boolean(
    normalizedFilter && scopeResponse?.pageInfo?.hasMore,
  )
  if (normalizedFilter && !nodeMatches && visibleChildren.length === 0 && !hasUnloadedMatches) {
    return null
  }

  const loading = Boolean(node.scope && isScopeLoading(node.scope))
  const error = node.scope ? getScopeError(node.scope) : undefined
  const expandable = Boolean(node.expandable || node.scope)
  const searchExpansionOverride = searchExpansionOverrides.get(node.id)
  const expanded =
    searchExpansionOverride
    ?? (
      expandedNodeIds.has(node.id)
      || (autoExpandedNodeId === node.id && !collapsedAutomaticNodeIds.has(node.id))
      || Boolean(normalizedFilter)
    )
  const toggle = () => {
    if (!expandable) {
      onSelectNode(node)
      return
    }
    const nextExpanded = !expanded
    if (normalizedFilter) {
      onSetSearchExpansionOverride(node.id, nextExpanded)
    } else {
      setExpandedNodeIds((current) => {
        const next = new Set(current)
        if (expanded) {
          next.delete(node.id)
        } else {
          next.add(node.id)
        }
        return next
      })
      if (autoExpandedNodeId === node.id) {
        setCollapsedAutomaticNodeIds((current) => {
          const next = new Set(current)
          if (expanded) {
            next.add(node.id)
          } else {
            next.delete(node.id)
          }
          return next
        })
      }
    }
    if (nextExpanded && node.scope && !scopeResponse && !loading) {
      onLoadScope(node.scope)
    }
  }
  const selectOrToggleNode = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1) {
      return
    }
    if (selectedNodeId === node.id && expandable) {
      lastRowToggleAtRef.current = event.timeStamp
      toggle()
      return
    }
    lastRowToggleAtRef.current = undefined
    onSelectNode(node)
  }
  const doubleClickNode = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const lastRowToggleAt = lastRowToggleAtRef.current
    lastRowToggleAtRef.current = undefined
    if (
      lastRowToggleAt !== undefined
      && event.timeStamp - lastRowToggleAt < DOUBLE_CLICK_WINDOW_MS
    ) {
      return
    }
    toggle()
  }

  return (
    <div className="mongo-explorer-branch">
      <div
        className={[
          'mongo-explorer-row',
          environment ? 'has-environment-accent' : '',
          selectedNodeId === node.id ? 'is-selected' : '',
          node.kind === 'system-databases' ? 'is-system' : '',
          loading ? 'is-loading' : '',
          error ? 'has-error' : '',
        ].filter(Boolean).join(' ')}
        style={{
          '--mongo-tree-depth': depth,
          '--connection-env-color': environment?.color,
        } as React.CSSProperties}
        data-node-kind={node.kind}
      >
        <button
          type="button"
          className="mongo-explorer-chevron"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`}
          aria-expanded={expandable ? expanded : undefined}
          onClick={toggle}
          disabled={!expandable}
        >
          {expandable ? (
            expanded ? <ChevronDownIcon /> : <ChevronRightIcon />
          ) : (
            <span />
          )}
        </button>
        <button
          type="button"
          className="mongo-explorer-node"
          onClick={selectOrToggleNode}
          onContextMenu={(event) => onNodeContextMenu?.(event, node)}
          onDoubleClick={doubleClickNode}
          title={[node.label, node.detail].filter(Boolean).join(' — ')}
          aria-current={selectedNodeId === node.id ? 'true' : undefined}
        >
          <ExplorerNodeIcon connection={connection} expanded={expanded} kind={node.kind} />
          <span className="mongo-explorer-node-copy">
            <strong>{node.label}</strong>
          </span>
          {node.kind === 'system-databases' ? (
            <span className="mongo-explorer-node-badge">System</span>
          ) : null}
          {scopeResponse?.pageInfo ? (
            <span className="mongo-explorer-count">
              {scopeResponse.nodes.length}
              {scopeResponse.pageInfo.knownTotal !== undefined
                ? ` / ${scopeResponse.pageInfo.knownTotal}`
                : ''}
            </span>
          ) : loading ? (
            <span className="mongo-explorer-node-status">Loading</span>
          ) : error ? (
            <span className="mongo-explorer-node-status is-error">Error</span>
          ) : null}
        </button>
      </div>
      {expanded ? (
        <div className="mongo-explorer-children">
          {loading && !scopeResponse ? (
            <MongoExplorerState label={`Loading ${node.label}…`} depth={depth + 1} />
          ) : null}
          {error ? (
            <MongoExplorerError
              message={error}
              depth={depth + 1}
              onRetry={() => onLoadScope(node.scope)}
            />
          ) : null}
          {!loading && !error && scopeResponse && children.length === 0 ? (
            <MongoExplorerState
              label={emptyScopeLabel(node)}
              depth={depth + 1}
            />
          ) : null}
          {visibleChildren.map((child) => (
            <MongoExplorerNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              filter={filter}
              selectedNodeId={selectedNodeId}
              scopes={scopes}
              expandedNodeIds={expandedNodeIds}
              setExpandedNodeIds={setExpandedNodeIds}
              autoExpandedNodeId={autoExpandedNodeId}
              collapsedAutomaticNodeIds={collapsedAutomaticNodeIds}
              setCollapsedAutomaticNodeIds={setCollapsedAutomaticNodeIds}
              searchExpansionOverrides={searchExpansionOverrides}
              onSetSearchExpansionOverride={onSetSearchExpansionOverride}
              isScopeLoading={isScopeLoading}
              getScopeError={getScopeError}
              onLoadScope={onLoadScope}
              onSelectNode={onSelectNode}
              onNodeContextMenu={onNodeContextMenu}
              connection={connection}
              environment={environment}
            />
          ))}
          {hasUnloadedMatches ? (
            <div className="mongo-explorer-filter-notice">
              More metadata is available; load it to include it in this filter.
            </div>
          ) : null}
          {scopeResponse?.pageInfo?.hasMore && scopeResponse.pageInfo.nextCursor ? (
            <button
              type="button"
              className="mongo-explorer-load-more"
              disabled={loading}
              onClick={() => onLoadScope(node.scope, scopeResponse.pageInfo?.nextCursor)}
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
          {manualDatabaseControl}
        </div>
      ) : null}
    </div>
  )
}

const EMPTY_SEARCH_EXPANSION_OVERRIDES: ReadonlyMap<string, boolean> = new Map()
const DOUBLE_CLICK_WINDOW_MS = 500

function MongoExplorerState({ label, depth = 0 }: { label: string; depth?: number }) {
  return (
    <div
      className="mongo-explorer-state"
      style={{ '--mongo-tree-depth': depth } as React.CSSProperties}
    >
      {label}
    </div>
  )
}

function MongoExplorerError({
  message,
  depth = 0,
  onRetry,
}: {
  message: string
  depth?: number
  onRetry(): void
}) {
  return (
    <div
      className="mongo-explorer-error"
      style={{ '--mongo-tree-depth': depth } as React.CSSProperties}
    >
      <span>{message}</span>
      <button type="button" onClick={onRetry}>
        <RefreshIcon /> Retry
      </button>
    </div>
  )
}

function nodeMatchesFilter(
  node: ExplorerNode,
  normalizedFilter: string,
  scopes: Record<string, ExplorerResponse>,
): boolean {
  if (!normalizedFilter) {
    return true
  }
  if (`${node.label} ${node.kind} ${node.detail}`.toLowerCase().includes(normalizedFilter)) {
    return true
  }
  if (!node.scope) {
    return false
  }
  return (scopes[explorerScopeKey(node.scope)]?.nodes ?? []).some((child) =>
    nodeMatchesFilter(child, normalizedFilter, scopes),
  )
}

function emptyScopeLabel(node: ExplorerNode) {
  if (node.kind === 'databases') {
    return 'No authorized user databases were returned.'
  }
  if (node.kind === 'system-databases') {
    return 'No authorized system databases were returned.'
  }
  if (node.kind === 'database') {
    return 'This database has no available object groups.'
  }
  return `No ${node.label.toLowerCase()} found.`
}

function configuredMongoDatabase(connection: ConnectionProfile) {
  const explicitDatabase = connection.database?.trim()
  if (explicitDatabase) {
    return explicitDatabase
  }
  const connectionString = connection.connectionString?.trim()
  if (!connectionString) {
    return undefined
  }
  const match = connectionString.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i)
  const database = match?.[1] ? decodeURIComponent(match[1]).trim() : ''
  return database || undefined
}

function mongoManualDatabaseNode(databaseName: string): ExplorerNode {
  return {
    id: `database:${databaseName}`,
    family: 'document',
    label: databaseName,
    kind: 'database',
    detail: 'MongoDB database opened by name',
    scope: `database:${databaseName}`,
    path: ['Databases'],
    queryTemplate: JSON.stringify({
      database: databaseName,
      operation: 'runCommand',
      command: { dbStats: 1 },
    }),
    expandable: true,
  }
}
