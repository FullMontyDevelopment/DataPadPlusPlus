import { useState } from 'react'
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
import { ExplorerNodeIcon } from '../../../SideBar.node-icons'
import { SqlRelationshipExplorerWorkspace } from '../../../SqlRelationshipExplorerWorkspace'
import type { DatastoreExplorerWorkspaceProps } from '../../types'
import type { DatastoreExplorerProvider } from './DatastoreExplorerProvider.types'
import { DatastoreExplorerNavigator } from './DatastoreExplorerNavigator'
import { DatastoreExplorerDetails } from './DatastoreExplorerDetails'
import {
  explorerScopeResponse,
  humanize,
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
    if (!relationshipMap?.structure && relationshipMap?.status !== 'loading') {
      relationshipMap?.onRefresh()
    }
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
          status={relationshipMap.status}
          structure={relationshipMap.structure}
          error={relationshipMap.error}
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
      <header className="datastore-explorer-toolbar">
        <div>
          <span className="eyebrow">{provider.label} Explorer</span>
          <h1>{connection.name}</h1>
          <p>{environment.label} · Metadata loads as objects are expanded or selected.</p>
        </div>
        <div className="datastore-explorer-toolbar-actions">
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
        </div>
      </header>

      <div className={`datastore-explorer-layout${selectedNode ? ' has-selection' : ''}`}>
        <aside className="datastore-explorer-tree-panel" aria-label={`${provider.label} objects`}>
          <label className="datastore-explorer-search">
            <SearchIcon />
            <span className="sr-only">Search {provider.label} metadata</span>
            <input
              type="search"
              placeholder="Search databases and objects"
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
              <section className="datastore-explorer-context-card">
                <span className="datastore-explorer-selection-icon">
                  <ExplorerNodeIcon connection={connection} kind={selectedNode.kind} />
                </span>
                <div>
                  <span className="eyebrow">{humanize(selectedNode.kind)}</span>
                  <h2>{selectedNode.label}</h2>
                  <p>{[...(selectedNode.path ?? []), selectedNode.label].join(' / ')}</p>
                </div>
              </section>
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
              <h2>Select a database or object</h2>
              <p>
                Browse {provider.label} metadata, health, security, and diagnostics
                without exposing raw provider payloads.
              </p>
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
