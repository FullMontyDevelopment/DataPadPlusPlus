import { useEffect, useRef, useState } from 'react'
import type {
  ExplorerNode,
  ScopedQueryTarget,
  StructureNode,
} from '@datapadplusplus/shared-types'
import { explorerScopeKey } from '../../../../../state/app-state-reducer-helpers'
import {
  ArrowLeftIcon,
  ExplorerIcon,
  ObjectRelationshipIcon,
  RefreshIcon,
  SearchIcon,
} from '../../../icons'
import { SqlRelationshipExplorerWorkspace } from '../../../SqlRelationshipExplorerWorkspace'
import type { DatastoreExplorerWorkspaceProps } from '../../types'
import type { DatastoreExplorerProvider } from './DatastoreExplorerProvider.types'
import { DatastoreExplorerNavigator } from './DatastoreExplorerNavigator'
import { DatastoreExplorerActions, DatastoreExplorerDetails } from './DatastoreExplorerDetails'
import { ExplorerSelectionHeader, ExplorerWorkspaceHeader } from './ExplorerChrome'
import {
  explorerScopeResponse,
} from './DatastoreExplorerProvider.model'

export function DatastoreExplorerWorkspace({
  provider,
  connection,
  environment,
  status,
  error,
  inspection,
  scopes,
  relationshipMap,
  isScopeLoading,
  getScopeError,
  onLoadScope,
  onInspectNode,
  onOpenQuery,
  onOpenObjectView,
}: DatastoreExplorerWorkspaceProps & { provider: DatastoreExplorerProvider }) {
  const [filter, setFilter] = useState('')
  const [selectedNode, setSelectedNode] = useState<ExplorerNode>()
  const [mode, setMode] = useState<'browser' | 'relationships'>('browser')
  const relationshipLoadRef = useRef<string | undefined>(undefined)
  const relationshipRequestIsCurrent =
    relationshipMap?.request?.connectionId === connection.id &&
    relationshipMap.request.environmentId === environment.id &&
    relationshipMap.request.mode === 'relationships' &&
    !relationshipMap.request.scope
  const relationshipStructure =
    relationshipRequestIsCurrent &&
    relationshipMap?.structure?.connectionId === connection.id &&
    relationshipMap.structure.environmentId === environment.id
      ? relationshipMap.structure
      : undefined
  const relationshipError = relationshipRequestIsCurrent ? relationshipMap?.error : undefined
  const relationshipLoading = relationshipRequestIsCurrent && relationshipMap?.status === 'loading'

  useEffect(() => {
    if (mode !== 'relationships' || !provider.supportsRelationshipMap || !relationshipMap) {
      relationshipLoadRef.current = undefined
      return
    }
    if (relationshipStructure || relationshipLoading || relationshipError) {
      relationshipLoadRef.current = undefined
      return
    }
    const key = JSON.stringify([connection.id, environment.id])
    if (relationshipLoadRef.current === key) return
    relationshipLoadRef.current = key
    // Completion metadata and another connection's cached structure are not a relationship map.
    relationshipMap.onRefresh({ mode: 'relationships', maxNodes: 320, maxEdges: 1000, depth: 1 })
  }, [connection.id, environment.id, mode, provider.supportsRelationshipMap, relationshipError, relationshipLoading, relationshipMap, relationshipStructure])
  const detailProvider = selectedNode
    ? provider.detailProviderForNode(selectedNode)
    : undefined
  const scopeResponse = selectedNode?.scope
    ? explorerScopeResponse(scopes, selectedNode.scope)
    : undefined

  const selectNode = (node: ExplorerNode) => {
    setSelectedNode(node)
    const detail = provider.detailProviderForNode(node)
    if (
      (detail.mode === 'scope' || detail.mode === 'scope-inspection')
      && node.scope
      && !scopes[explorerScopeKey(node.scope)]
      && !isScopeLoading(node.scope)
    ) {
      onLoadScope(node.scope)
    }
    if (detail.mode === 'inspection' || detail.mode === 'scope-inspection') {
      onInspectNode(node)
    }
  }

  const openQuery = (node: ExplorerNode): ScopedQueryTarget => ({
    kind: node.kind,
    label: node.label,
    path: [...(node.path ?? []), node.label],
    scope: node.scope,
    queryTemplate: node.queryTemplate,
  })

  const openRelationshipMap = () => {
    setMode('relationships')
  }

  if (mode === 'relationships' && provider.supportsRelationshipMap && relationshipMap) {
    return (
      <div className="datastore-explorer-relationship-view">
        <div className="datastore-explorer-mode-toolbar">
          <button type="button" className="drawer-button" onClick={() => setMode('browser')}>
            <ArrowLeftIcon /> Back to Explorer
          </button>
        </div>
        <SqlRelationshipExplorerWorkspace
          activeConnection={connection}
          activeEnvironment={environment}
          status={relationshipLoading || (!relationshipStructure && !relationshipError) ? 'loading' : 'ready'}
          structure={relationshipStructure}
          error={relationshipError}
          onRefresh={relationshipMap.onRefresh}
          onInspectNode={(node) => onInspectNode(structureNodeToExplorerNode(node))}
          onOpenQuery={(node, queryText) => onOpenQuery({
            kind: node.isView ? 'view' : 'table',
            label: node.objectName,
            path: [node.schema, node.objectName],
            scope: node.qualifiedName,
            queryTemplate: queryText,
          })}
          onOpenObjectView={onOpenObjectView}
        />
      </div>
    )
  }

  return (
    <section
      className="datastore-explorer-workspace"
      aria-label={`${provider.label} Explorer`}
      data-tour-id="explorer-metadata"
    >
      <ExplorerWorkspaceHeader connection={connection} environment={environment} label={provider.label}>
          {provider.supportsRelationshipMap ? (
            <button type="button" className="drawer-button" onClick={openRelationshipMap}>
              <ObjectRelationshipIcon /> Relationship map
            </button>
          ) : null}
          <button
            type="button"
            className="drawer-button"
            onClick={() => onLoadScope()}
            disabled={isScopeLoading(undefined)}
            aria-busy={isScopeLoading(undefined)}
          >
            <RefreshIcon className={isScopeLoading(undefined) ? 'is-spinning' : undefined} />
            {isScopeLoading(undefined) ? 'Refreshing…' : 'Refresh'}
          </button>
      </ExplorerWorkspaceHeader>

      <div className={`datastore-explorer-layout${selectedNode ? ' has-selection' : ''}`}>
        <aside className="datastore-explorer-tree-panel" aria-label={`${provider.label} objects`}>
          <label className="datastore-explorer-search">
            <SearchIcon />
            <span className="sr-only">Search {provider.label} metadata</span>
            <input
              type="search"
              placeholder="Filter loaded objects"
              title="Filter objects already loaded in Explorer. Expand a branch to load more."
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          {error ? (
            <div className="datastore-explorer-workspace-error">{error}</div>
          ) : null}
          <div className="datastore-explorer-tree-scroll">
            <DatastoreExplorerNavigator
              provider={provider}
              connection={connection}
              environment={environment}
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

        <main className="datastore-explorer-detail-panel" aria-live="polite">
          {selectedNode && detailProvider ? (
            <>
              <button
                type="button"
                className="datastore-explorer-detail-back"
                onClick={() => setSelectedNode(undefined)}
              >
                <ArrowLeftIcon /> Back to navigator
              </button>
              <ExplorerSelectionHeader
                connection={connection}
                node={selectedNode}
                description={detailProvider.description || selectedNode.detail}
                actions={<DatastoreExplorerActions node={selectedNode} provider={detailProvider}
                  onOpenQuery={() => onOpenQuery(openQuery(selectedNode))}
                  onOpenObjectView={() => onOpenObjectView(selectedNode)} />}
              />
              <DatastoreExplorerDetails
                connection={connection}
                node={selectedNode}
                provider={detailProvider}
                inspection={inspection}
                scopeResponse={scopeResponse}
                loading={
                  (
                    (detailProvider.mode === 'scope' || detailProvider.mode === 'scope-inspection')
                    && isScopeLoading(selectedNode.scope)
                  )
                  || (
                    (detailProvider.mode === 'inspection' || detailProvider.mode === 'scope-inspection')
                    && status === 'loading'
                    && inspection?.nodeId !== selectedNode.id
                  )
                }
                error={getScopeError(selectedNode.scope) ?? error}
                onLoadMore={(cursor) => onLoadScope(selectedNode.scope, cursor)}
                onSelectNode={selectNode}
                onOpenQuery={() => onOpenQuery(openQuery(selectedNode))}
                onOpenObjectView={() => onOpenObjectView(selectedNode)}
              />
            </>
          ) : (
            <div className="datastore-explorer-welcome">
              <ExplorerIcon />
              <h2>Explore {provider.label}</h2>
              <p>Select an object in the navigator to see its details and available actions.</p>
            </div>
          )}
        </main>
      </div>
    </section>
  )
}

function structureNodeToExplorerNode(node: StructureNode): ExplorerNode {
  return {
    id: node.id,
    family: node.family,
    label: node.label,
    kind: node.kind,
    detail: node.detail ?? node.qualifiedName ?? node.kind,
    scope: node.qualifiedName,
    path: [node.database, node.schema].filter((value): value is string => Boolean(value)),
    expandable: false,
  }
}
