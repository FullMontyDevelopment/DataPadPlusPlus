import type { LibraryNode, QueryTabState } from '@datapadplusplus/shared-types'

const GLOBAL_TAB_KINDS = new Set<NonNullable<QueryTabState['tabKind']>>([
  'environment',
  'settings',
  'api-server',
  'mcp-server',
  'workspace-search',
  'security-checks',
])

const CONNECTION_CONTEXT_TAB_KINDS = new Set<NonNullable<QueryTabState['tabKind']>>([
  'query',
  'explorer',
  'metrics',
  'object-view',
])

export function resolveActiveLibraryNodeId(
  nodes: LibraryNode[],
  activeTab: QueryTabState | undefined,
  activeConnectionId?: string,
) {
  if (activeTab?.tabKind && GLOBAL_TAB_KINDS.has(activeTab.tabKind)) {
    return undefined
  }

  const savedItemId =
    activeTab?.saveTarget?.kind === 'library'
      ? activeTab.saveTarget.libraryItemId
      : activeTab?.savedQueryId

  if (savedItemId && nodes.some((node) => node.id === savedItemId)) {
    return savedItemId
  }

  const hasConnectionContext =
    !activeTab ||
    !activeTab.tabKind ||
    CONNECTION_CONTEXT_TAB_KINDS.has(activeTab.tabKind)
  if (!hasConnectionContext) {
    return undefined
  }

  const connectionId = activeTab?.connectionId || activeConnectionId
  if (!connectionId) {
    return undefined
  }

  return nodes.find(
    (node) => node.kind === 'connection' && node.connectionId === connectionId,
  )?.id
}

export function libraryAncestorNodeIds(nodes: LibraryNode[], nodeId?: string) {
  const ancestors = new Set<string>()
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const visited = new Set<string>()
  let current = nodeId ? nodesById.get(nodeId) : undefined

  while (current?.parentId && !visited.has(current.parentId)) {
    visited.add(current.parentId)
    ancestors.add(current.parentId)
    current = nodesById.get(current.parentId)
  }

  return ancestors
}

export function libraryNodePath(nodes: LibraryNode[], node: LibraryNode | undefined) {
  if (!node) {
    return ''
  }

  const names = [node.name]
  let parentId = node.parentId
  const visited = new Set<string>()

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodes.find((candidate) => candidate.id === parentId)
    if (!parent) {
      break
    }
    names.unshift(parent.name)
    parentId = parent.parentId
  }

  return names.join(' / ')
}

export function findFolderIdByPath(nodes: LibraryNode[], path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\s*\/\s*/g, ' / ').trim()
  return nodes.find(
    (node) =>
      node.kind === 'folder' &&
      libraryNodePath(nodes, node).toLowerCase() === normalized.toLowerCase(),
  )?.id
}

export function canMoveLibraryNode(
  nodes: LibraryNode[],
  nodeId: string | undefined,
  parentId?: string,
) {
  if (!nodeId) {
    return false
  }

  const node = nodes.find((candidate) => candidate.id === nodeId)

  if (!node || node.parentId === parentId) {
    return false
  }

  if (!parentId) {
    return true
  }

  const parent = nodes.find((candidate) => candidate.id === parentId)

  if (!parent || parent.kind !== 'folder' || parent.id === nodeId) {
    return false
  }

  let current: LibraryNode | undefined = parent
  const visited = new Set<string>()

  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.parentId === nodeId) {
      return false
    }
    current = nodes.find((candidate) => candidate.id === current?.parentId)
  }

  return true
}
