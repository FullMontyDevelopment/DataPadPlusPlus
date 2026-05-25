import type { LibraryNode } from '@datapadplusplus/shared-types'

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
