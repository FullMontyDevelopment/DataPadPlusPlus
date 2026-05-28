import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import type { ConnectionTreeAction } from './SideBar.datastore-tree-registry'

export interface ConnectionTreeNode {
  id: string
  label: string
  kind: string
  detail?: string
  scope?: string
  path?: string[]
  queryTemplate?: string
  queryable?: boolean
  expandable?: boolean
  refreshScope?: string
  category?: boolean
  actions?: ConnectionTreeAction[]
  builderKind?: ScopedQueryTarget['preferredBuilder']
  children?: ConnectionTreeNode[]
}

export function branch(
  id: string,
  label: string,
  kind: string,
  detail: string,
  children: ConnectionTreeNode[],
  options: Partial<ConnectionTreeNode> = {},
): ConnectionTreeNode {
  return { id, label, kind, detail, children, ...options }
}

export function leaf(
  id: string,
  label: string,
  kind: string,
  detail: string,
  options: Partial<ConnectionTreeNode> = {},
): ConnectionTreeNode {
  return { id, label, kind, detail, ...options }
}
