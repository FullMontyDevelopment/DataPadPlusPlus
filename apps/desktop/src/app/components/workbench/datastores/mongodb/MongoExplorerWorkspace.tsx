import { useState } from 'react'
import type { ExplorerNode, ScopedQueryTarget } from '@datapadplusplus/shared-types'
import type { DatastoreExplorerWorkspaceProps } from '../types'
import {
  ArrowLeftIcon,
  ExplorerIcon,
  RefreshIcon,
  SearchIcon,
} from '../../icons'
import { ExplorerNodeIcon } from '../../SideBar.node-icons'
import { explorerScopeKey } from '../../../../state/app-state-reducer-helpers'
import { mongoExplorerDetailProvider } from './MongoExplorerDetailRegistry'
import type { MongoExplorerDetailActionId } from './MongoExplorerDetail.types'
import { MongoDetailActions } from './MongoExplorerDetails'
import { MongoExplorerNavigator } from './MongoExplorerNavigator'

export function MongoExplorerWorkspace({
  connection,
  environment,
  status,
  error,
  inspection,
  scopes,
  isScopeLoading,
  getScopeError,
  onLoadScope,
  onInspectNode,
  onOpenQuery,
  onOpenObjectView,
}: DatastoreExplorerWorkspaceProps) {
  const [filter, setFilter] = useState('')
  const [selectedNode, setSelectedNode] = useState<ExplorerNode>()
  const selectedProvider = selectedNode
    ? mongoExplorerDetailProvider(selectedNode.kind)
    : undefined
  const selectedScopeResponse = selectedNode?.scope
    ? scopes[explorerScopeKey(selectedNode.scope)]
    : undefined

  const selectNode = (node: ExplorerNode) => {
    const provider = mongoExplorerDetailProvider(node.kind)
    setSelectedNode(node)
    if (provider.mode === 'inspection') {
      onInspectNode(node)
      return
    }
    if (
      provider.mode === 'scope'
      && node.scope
      && !scopes[explorerScopeKey(node.scope)]
      && !isScopeLoading(node.scope)
    ) {
      onLoadScope(node.scope)
    }
  }

  const runAction = (action: MongoExplorerDetailActionId, node: ExplorerNode) => {
    switch (action) {
      case 'open-query':
        onOpenQuery(mongoQueryTarget(node, 'mongo-find'))
        return
      case 'open-aggregation':
        onOpenQuery(mongoQueryTarget(node, 'mongo-aggregation'))
        return
      case 'open-schema':
        onOpenObjectView(mongoObjectNode(node, 'schema-preview', 'Schema Preview'))
        return
      case 'open-indexes':
        onOpenObjectView(mongoObjectNode(node, 'indexes', 'Indexes'))
        return
      case 'open-validation':
        onOpenObjectView(mongoObjectNode(node, 'validation-rules', 'Validation Rules'))
        return
      case 'open-statistics': {
        const databaseName = nodeDatabaseName(node)
        onOpenObjectView({
          ...node,
          id: `database-statistics:${databaseName}`,
          label: 'Database Statistics',
          kind: 'database-statistics',
        })
        return
      }
      case 'open-pipeline':
        onOpenObjectView(mongoObjectNode(node, 'view-pipeline', 'View Pipeline'))
        return
      case 'open-overview':
        onOpenObjectView(node)
    }
  }

  const DetailComponent = selectedProvider?.component
  const detailLoading = selectedNode
    ? selectedProvider?.mode === 'scope'
      ? isScopeLoading(selectedNode.scope)
      : status === 'loading' && inspection?.nodeId !== selectedNode.id
    : false

  return (
    <section className="mongo-explorer-workspace" aria-label="MongoDB Explorer">
      <header className="mongo-explorer-toolbar">
        <div>
          <span className="eyebrow">MongoDB Explorer</span>
          <h2>{connection.name}</h2>
          <p>{environment.label} · Metadata loads as objects are expanded or selected.</p>
        </div>
        <button
          type="button"
          className={`drawer-button mongo-explorer-refresh-button${
            isScopeLoading(undefined) ? ' is-refreshing' : ''
          }`}
          onClick={() => onLoadScope()}
          disabled={isScopeLoading(undefined)}
          aria-label="Refresh MongoDB databases"
          aria-busy={isScopeLoading(undefined)}
          title="Reload the authorized MongoDB database list"
        >
          <RefreshIcon />
          {isScopeLoading(undefined) ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <div className={`mongo-explorer-layout${selectedNode ? ' has-selection' : ''}`}>
        <aside className="mongo-explorer-tree-panel" aria-label="MongoDB databases and objects">
          <label className="mongo-explorer-search">
            <SearchIcon />
            <span className="sr-only">Search MongoDB metadata</span>
            <input
              type="search"
              placeholder="Search databases and objects"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          {error && !Object.keys(scopes).length ? (
            <div className="mongo-explorer-workspace-error">{error}</div>
          ) : null}
          <div className="mongo-explorer-tree-scroll">
            <MongoExplorerNavigator
              connection={connection}
              scopes={scopes}
              filter={filter}
              selectedNodeId={selectedNode?.id}
              isScopeLoading={isScopeLoading}
              getScopeError={getScopeError}
              onLoadScope={onLoadScope}
              onSelectNode={selectNode}
            />
          </div>
        </aside>

        <main className="mongo-explorer-detail-panel" aria-live="polite">
          {selectedNode && selectedProvider && DetailComponent ? (
            <>
              <button
                type="button"
                className="mongo-explorer-detail-back"
                onClick={() => setSelectedNode(undefined)}
              >
                <ArrowLeftIcon /> Back to navigator
              </button>
              <section className="mongo-explorer-context-card" aria-label="Selected MongoDB object">
                <header className="mongo-explorer-selection-heading">
                  <span className="mongo-explorer-selection-icon">
                    <ExplorerNodeIcon connection={connection} kind={selectedNode.kind} />
                  </span>
                  <div>
                    <span className="eyebrow">{humanizeKind(selectedNode.kind)}</span>
                    <h2>{selectedNode.label}</h2>
                    <p>{mongoNodeBreadcrumb(selectedNode)}</p>
                  </div>
                </header>
                <MongoDetailActions
                  actions={selectedProvider.actions ?? []}
                  node={selectedNode}
                  onRunAction={runAction}
                />
              </section>
              <DetailComponent
                connection={connection}
                node={selectedNode}
                inspection={inspection}
                scopeResponse={selectedScopeResponse}
                scopeLoading={detailLoading}
                scopeError={
                  selectedProvider.mode === 'scope'
                    ? getScopeError(selectedNode.scope)
                    : error
                }
                actions={selectedProvider.actions ?? []}
                onLoadScope={onLoadScope}
                onSelectNode={selectNode}
                onRunAction={runAction}
              />
            </>
          ) : (
            <div className="mongo-explorer-welcome">
              <ExplorerIcon />
              <h2>Select a database or object</h2>
              <p>
                Browse collections, indexes, validation, permissions, statistics, and
                bounded samples without leaving Explorer.
              </p>
            </div>
          )}
        </main>
      </div>
    </section>
  )
}

function nodeDatabaseName(node: ExplorerNode) {
  if (node.kind === 'database') return node.label
  const parts = node.id.split(':')
  if (parts.length >= 2 && parts[0] !== node.label) return parts[1]
  return node.path?.[0] ?? ''
}

function nodeObjectName(node: ExplorerNode) {
  if (['collection', 'view', 'gridfs-collection'].includes(node.kind)) return node.label
  const parts = node.id.split(':')
  if (parts.length >= 3) return parts.slice(2).join(':')
  if (node.kind === 'gridfs-files') return 'fs.files'
  if (node.kind === 'gridfs-chunks') return 'fs.chunks'
  return node.label
}

function mongoQueryTarget(
  node: ExplorerNode,
  preferredBuilder: 'mongo-find' | 'mongo-aggregation',
): ScopedQueryTarget {
  const databaseName = nodeDatabaseName(node)
  const objectName = nodeObjectName(node)
  const views = ['view', 'view-results', 'sample-results', 'pipeline'].includes(node.kind)
  return {
    kind: node.kind,
    label: objectName,
    path: [databaseName, views ? 'Views' : 'Collections', objectName].filter(
      (part): part is string => Boolean(part),
    ),
    scope: node.scope,
    queryTemplate: node.queryTemplate,
    preferredBuilder,
  }
}

function mongoObjectNode(node: ExplorerNode, kind: string, label: string): ExplorerNode {
  const databaseName = nodeDatabaseName(node)
  const objectName = nodeObjectName(node)
  return {
    ...node,
    id: `${kind}:${databaseName}:${objectName}`,
    label,
    kind,
    scope: `${kind}:${databaseName}:${objectName}`,
  }
}

function mongoNodeBreadcrumb(node: ExplorerNode) {
  const parts = [...(node.path ?? []), node.label].filter(
    (part, index, items) => part && items.indexOf(part) === index,
  )
  return parts.join(' / ') || node.detail
}

function humanizeKind(kind: string) {
  return kind
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
