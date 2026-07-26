import type {
  ExplorerNode,
  ExplorerPageInfo,
  ExplorerRequest,
} from '@datapadplusplus/shared-types'

const CURSOR_VERSION = 'mongodb-preview-v1'

export function pageMongoExplorerNodes(
  nodes: ExplorerNode[],
  request: ExplorerRequest,
): { nodes: ExplorerNode[]; pageInfo: ExplorerPageInfo } {
  const limit = request.limit ?? 100
  const scopeHash = stableScopeHash(request.scope ?? '')
  const offset = request.cursor ? parseCursor(request.cursor, scopeHash) : 0
  const page = nodes.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  const hasMore = nextOffset < nodes.length

  return {
    nodes: page,
    pageInfo: {
      cursor: request.cursor,
      nextCursor: hasMore ? `${CURSOR_VERSION}:${scopeHash}:${nextOffset}` : undefined,
      returnedCount: page.length,
      knownTotal: nodes.length,
      hasMore,
    },
  }
}

function parseCursor(cursor: string, expectedScopeHash: string) {
  const [version, scopeHash, rawOffset, extra] = cursor.split(':')
  const offset = Number(rawOffset)
  if (
    version !== CURSOR_VERSION ||
    scopeHash !== expectedScopeHash ||
    extra !== undefined ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    throw new Error('invalid-explorer-cursor: The MongoDB Explorer cursor is malformed or belongs to a different scope.')
  }
  return offset
}

function stableScopeHash(scope: string) {
  let hash = 0x811c9dc5
  for (const character of scope) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
