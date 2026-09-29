import { useState } from 'react'
import type { ExplorerNode, ScopedQueryTarget } from '@datapadplusplus/shared-types'
import type { DatastoreExplorerWorkspaceProps } from '../types'
import {
  ArrowLeftIcon,
  ExplorerIcon,
  RefreshIcon,
  SearchIcon,
} from '../../icons'
import { ExplorerSelectionHeader, ExplorerWorkspaceHeader } from '../common/explorer/ExplorerChrome'
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
    <section className="mongo-explorer-workspace datastore-explorer-workspace" aria-label="MongoDB Explorer">
      <ExplorerWorkspaceHeader connection={connection} environment={environment} label="MongoDB">
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
      </ExplorerWorkspaceHeader>

      <div className={`mongo-explorer-layout datastore-explorer-layout${selectedNode ? ' has-selection' : ''}`}>
        <aside className="mongo-explorer-tree-panel datastore-explorer-tree-panel" aria-label="MongoDB databases and objects">
          <label className="mongo-explorer-search datastore-explorer-search">
            <SearchIcon />
            <span className="sr-only">Search MongoDB metadata</span>
            <input
              type="search"
              placeholder="Filter loaded objects"
              title="Filter objects already loaded in Explorer. Expand a branch to load more."
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          {error && !Object.keys(scopes).length ? (
            <div className="mongo-explorer-workspace-error">{error}</div>
          ) : null}
          <div className="mongo-explorer-tree-scroll datastore-explorer-tree-scroll">
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

        <main className="mongo-explorer-detail-panel datastore-explorer-detail-panel" aria-live="polite">
          {selectedNode && selectedProvider && DetailComponent ? (
            <>
              <button
                type="button"
                className="mongo-explorer-detail-back datastore-explorer-detail-back"
                onClick={() => setSelectedNode(undefined)}
              >
                <ArrowLeftIcon /> Back to navigator
              </button>
              <ExplorerSelectionHeader
                connection={connection} node={selectedNode} description={selectedNode.detail}
                className="mongo-explorer-context-card" label="Selected MongoDB object"
                actions={<MongoDetailActions
                  actions={selectedProvider.actions ?? []}
                  node={selectedNode}
                  onRunAction={runAction}
                />}
              />
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
              <h2>Explore MongoDB</h2>
              <p>Select an object in the navigator to see its details and available actions.</p>
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
