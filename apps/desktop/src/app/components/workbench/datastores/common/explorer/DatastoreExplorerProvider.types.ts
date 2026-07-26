import type {
  ComponentType,
} from 'react'
import type {
  DatastoreEngine,
  DatastoreFamily,
  DatastoreTreeManifest,
  ExplorerNode,
} from '@datapadplusplus/shared-types'
import type {
  DatastoreExplorerNavigatorProps,
  DatastoreExplorerWorkspaceProps,
  ObjectViewWorkspaceProps,
} from '../../types'

export type DatastoreExplorerDetailMode =
  | 'scope'
  | 'inspection'
  | 'scope-inspection'
  | 'launch'
  | 'state'

export type DatastoreExplorerDetailCategory =
  | 'overview'
  | 'data'
  | 'schema'
  | 'security'
  | 'health'
  | 'administration'
  | 'launch'

export interface DatastoreExplorerDetailProvider {
  kind: string
  label: string
  description?: string
  mode: DatastoreExplorerDetailMode
  category: DatastoreExplorerDetailCategory
}

export interface DatastoreExplorerProvider {
  engine: DatastoreEngine
  family: DatastoreFamily
  label: string
  tree: DatastoreTreeManifest
  detailProviders: readonly DatastoreExplorerDetailProvider[]
  systemKinds: ReadonlySet<string>
  supportsRelationshipMap: boolean
  Navigator: ComponentType<DatastoreExplorerNavigatorProps>
  Workspace: ComponentType<DatastoreExplorerWorkspaceProps>
  detailProviderForNode(node: ExplorerNode): DatastoreExplorerDetailProvider
}

export interface DatastoreObjectViewProvider {
  engine: DatastoreEngine
  Workspace: ComponentType<ObjectViewWorkspaceProps>
}

export interface CreateDatastoreExplorerProviderOptions {
  engine: DatastoreEngine
  family: DatastoreFamily
  label: string
  systemKinds?: readonly string[]
  inspectionKinds?: readonly string[]
  scopeKinds?: readonly string[]
  launchKinds?: readonly string[]
  stateKinds?: readonly string[]
  supportsRelationshipMap?: boolean
}
