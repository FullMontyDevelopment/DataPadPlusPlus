import { describe, expect, it } from 'vitest'
import type {
  ConnectionProfile,
  ExplorerNode,
  ExplorerRequest,
} from '@datapadplusplus/shared-types'
import { pageBrowserExplorerNodes } from '../../../src/services/runtime/browser-explorer-paging'

const connection = {
  id: 'connection-1',
  name: 'PostgreSQL',
  engine: 'postgresql',
  family: 'sql',
} as ConnectionProfile

const nodes = Array.from({ length: 5 }, (_, index): ExplorerNode => ({
  id: `node-${index}`,
  family: 'sql',
  label: `Node ${index}`,
  kind: 'table',
  detail: 'Table',
}))

function request(scope?: string, cursor?: string): ExplorerRequest {
  return {
    connectionId: connection.id,
    environmentId: 'environment-1',
    limit: 2,
    scope,
    cursor,
  }
}

describe('browser Explorer paging', () => {
  it('uses opaque continuation cursors and reports the loaded page', () => {
    const first = pageBrowserExplorerNodes(connection, nodes, request())

    expect(first.nodes.map((node) => node.id)).toEqual(['node-0', 'node-1'])
    expect(first.pageInfo).toMatchObject({
      returnedCount: 2,
      knownTotal: 5,
      hasMore: true,
    })
    expect(first.pageInfo.nextCursor).not.toContain('node')

    const second = pageBrowserExplorerNodes(
      connection,
      nodes,
      request(undefined, first.pageInfo.nextCursor),
    )
    expect(second.nodes.map((node) => node.id)).toEqual(['node-2', 'node-3'])
  })

  it('rejects malformed and scope-mismatched cursors', () => {
    expect(() => pageBrowserExplorerNodes(
      connection,
      nodes,
      request(undefined, 'not-a-cursor'),
    )).toThrow('invalid-explorer-cursor')

    const first = pageBrowserExplorerNodes(connection, nodes, request('schema:public'))
    expect(() => pageBrowserExplorerNodes(
      connection,
      nodes,
      request('schema:other', first.pageInfo.nextCursor),
    )).toThrow('invalid-explorer-cursor')
  })
})
