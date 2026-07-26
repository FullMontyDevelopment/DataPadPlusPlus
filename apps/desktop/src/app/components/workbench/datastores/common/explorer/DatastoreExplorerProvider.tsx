import type { ComponentType } from 'react'
import { datastoreTreeForEngine } from '@datapadplusplus/shared-types'
import type { ObjectViewWorkspaceProps } from '../../types'
import type {
  CreateDatastoreExplorerProviderOptions,
  DatastoreExplorerProvider,
  DatastoreObjectViewProvider,
} from './DatastoreExplorerProvider.types'
import {
  detailProvidersFromTree,
  detailProviderForRuntimeNode,
} from './DatastoreExplorerProvider.model'
import { DatastoreExplorerNavigator } from './DatastoreExplorerNavigator'
import { DatastoreExplorerWorkspace } from './DatastoreExplorerWorkspace'

export function createDatastoreExplorerProvider(
  options: CreateDatastoreExplorerProviderOptions,
): DatastoreExplorerProvider {
  const tree = datastoreTreeForEngine(options.engine, options.family)
  const detailProviders = detailProvidersFromTree(tree.roots, options)
  const detailLookup = new Map(detailProviders.map((provider) => [provider.kind, provider]))
  const provider = {
    engine: options.engine,
    family: options.family,
    label: options.label,
    tree,
    detailProviders,
    systemKinds: new Set(options.systemKinds ?? [
      'system-databases',
      'system-keyspaces',
      'system-schemas',
      'system-tables',
    ]),
    supportsRelationshipMap: Boolean(options.supportsRelationshipMap),
    Navigator: (props) => <DatastoreExplorerNavigator provider={provider} {...props} />,
    Workspace: (props) => <DatastoreExplorerWorkspace provider={provider} {...props} />,
    detailProviderForNode: (node) =>
      detailProviderForRuntimeNode(detailLookup.get(node.kind), node),
  } satisfies DatastoreExplorerProvider

  return provider
}

export function createDatastoreObjectViewProvider(
  engine: DatastoreObjectViewProvider['engine'],
  Workspace: ComponentType<ObjectViewWorkspaceProps>,
): DatastoreObjectViewProvider {
  return { engine, Workspace }
}
