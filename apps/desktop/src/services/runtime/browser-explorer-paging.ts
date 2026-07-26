import type {
  ConnectionProfile,
  ExplorerNode,
  ExplorerPageInfo,
  ExplorerRequest,
} from '@datapadplusplus/shared-types'

const CURSOR_VERSION = 'browser-explorer-v1'

export function pageBrowserExplorerNodes(
  connection: ConnectionProfile,
  nodes: ExplorerNode[],
  request: ExplorerRequest,
): { nodes: ExplorerNode[]; pageInfo: ExplorerPageInfo } {
  const pageSize = Math.min(100, Math.max(1, request.limit ?? 50))
  const scopeKey = `${connection.engine}\u001f${request.environmentId}\u001f${request.scope ?? ''}`
  const offset = request.cursor
    ? decodeCursor(request.cursor, scopeKey)
    : 0
  const page = nodes.slice(offset, offset + pageSize)
  const nextOffset = offset + page.length
  const hasMore = nextOffset < nodes.length

  return {
    nodes: page,
    pageInfo: {
      cursor: request.cursor,
      nextCursor: hasMore ? encodeCursor(scopeKey, nextOffset) : undefined,
      returnedCount: page.length,
      knownTotal: nodes.length,
      hasMore,
    },
  }
}

function encodeCursor(scopeKey: string, offset: number) {
  const payload = JSON.stringify({
    version: CURSOR_VERSION,
    scope: stableHash(scopeKey),
    offset,
  })
  return toBase64Url(payload)
}

function decodeCursor(cursor: string, scopeKey: string) {
  try {
    const payload = JSON.parse(fromBase64Url(cursor)) as {
      version?: string
      scope?: string
      offset?: number
    }
    if (
      payload.version !== CURSOR_VERSION
      || payload.scope !== stableHash(scopeKey)
      || !Number.isSafeInteger(payload.offset)
      || Number(payload.offset) < 0
    ) {
      throw new Error('mismatch')
    }
    return Number(payload.offset)
  } catch {
    throw new Error('invalid-explorer-cursor')
  }
}

function stableHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

