import { describe, expect, it } from 'vitest'
import type { ResolvedEnvironment } from '@datapadplusplus/shared-types'
import {
  redactConnectionTestForEnvironment,
  redactExplorerInspectForEnvironment,
  redactExplorerResponseForEnvironment,
  redactForEnvironment,
  redactRedisKeyScanForEnvironment,
  redactResultPageForEnvironment,
  redactStructureResponseForEnvironment,
} from '../../../src/services/runtime/browser-response-redaction'

function secretEnvironment(): ResolvedEnvironment {
  return {
    environmentId: 'env-qa',
    label: 'QA',
    risk: 'low',
    variables: {
      API_TOKEN: 'super-secret-token',
    },
    unresolvedKeys: [],
    inheritedChain: ['QA'],
    sensitiveKeys: ['API_TOKEN'],
    variableDefinitions: [],
  }
}

describe('browser response redaction', () => {
  it('redacts resolved secret values inside nested browser runtime responses', () => {
    const redacted = redactForEnvironment(
      {
        summary: 'used super-secret-token',
        result: {
          payloads: [
            {
              renderer: 'json',
              value: {
                text: 'super-secret-token',
              },
            },
          ],
        },
      },
      secretEnvironment(),
    )

    const serialized = JSON.stringify(redacted)

    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).toContain('********')
  })

  it('redacts secret-like payload fields even without secret variables', () => {
    const redacted = redactForEnvironment(
      {
        username: 'ada',
        password: 'plain-password',
        nested: {
          apiToken: 'plain-token',
        },
      },
      {
        ...secretEnvironment(),
        variables: {},
        sensitiveKeys: [],
      },
    )

    const serialized = JSON.stringify(redacted)

    expect(serialized).toContain('ada')
    expect(serialized).not.toContain('plain-password')
    expect(serialized).not.toContain('plain-token')
  })

  it('redacts result page payloads and notices before they reach the UI', () => {
    const redacted = redactResultPageForEnvironment(
      {
        tabId: 'tab-1',
        payload: {
          renderer: 'table',
          columns: ['token'],
          rows: [['super-secret-token']],
        },
        pageInfo: {
          pageSize: 20,
          pageIndex: 1,
          bufferedRows: 1,
          hasMore: false,
        },
        notices: ['loaded super-secret-token'],
      },
      secretEnvironment(),
    )

    const serialized = JSON.stringify(redacted)

    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).toContain('********')
  })

  it('redacts connection test output with environment and inline secret values', () => {
    const redacted = redactConnectionTestForEnvironment(
      {
        ok: false,
        engine: 'mongodb',
        message: 'Authentication failed with super-secret-token and inline-secret',
        warnings: [
          'Token super-secret-token was present',
          'Password inline-secret was present',
        ],
        resolvedHost: 'mongodb://user:inline-secret@localhost/catalog',
        resolvedDatabase: 'catalog-super-secret-token',
        durationMs: 1,
      },
      secretEnvironment(),
      ['inline-secret'],
    )

    const serialized = JSON.stringify(redacted)

    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).not.toContain('inline-secret')
    expect(serialized).toContain('********')
  })

  it('ignores malformed secret values instead of failing redaction', () => {
    const redacted = redactConnectionTestForEnvironment(
      {
        ok: false,
        engine: 'mongodb',
        message: 'Authentication failed with inline-secret',
        warnings: ['Check credentials'],
        resolvedHost: 'localhost',
        resolvedDatabase: undefined,
        durationMs: 1,
      },
      {
        ...secretEnvironment(),
        variables: {
          API_TOKEN: null,
        } as never,
      },
      [null, undefined, 'inline-secret'],
    )

    expect(redacted.message).toBe('Authentication failed with ********')
  })

  it('redacts explorer display metadata while preserving functional node ids and scopes', () => {
    const redacted = redactExplorerResponseForEnvironment(
      {
        connectionId: 'conn-1',
        environmentId: 'env-qa',
        scope: 'database:super-secret-token',
        summary: 'Loaded super-secret-token',
        capabilities: {
          canCancel: false,
          canExplain: false,
          supportsLiveMetadata: true,
          editorLanguage: 'json',
          defaultRowLimit: 20,
        },
        nodes: [
          {
            id: 'node-super-secret-token',
            family: 'document',
            label: 'catalog super-secret-token',
            kind: 'database',
            detail: 'detail super-secret-token',
            scope: 'node-scope-super-secret-token',
            path: ['root', 'super-secret-token'],
            queryTemplate: '{"token":"super-secret-token"}',
          },
        ],
      },
      secretEnvironment(),
    )

    expect(redacted.scope).toBe('database:super-secret-token')
    const node = redacted.nodes[0]
    expect(node).toBeDefined()
    if (!node) throw new Error('Expected redacted explorer node.')
    expect(node.id).toBe('node-super-secret-token')
    expect(node.scope).toBe('node-scope-super-secret-token')
    expect(node.label).toBe('catalog ********')
    expect(node.path?.[1]).toBe('********')
    expect(node.queryTemplate).toBe('{"token":"********"}')
  })

  it('redacts explorer inspections without changing the inspected node id', () => {
    const redacted = redactExplorerInspectForEnvironment(
      {
        nodeId: 'node-super-secret-token',
        summary: 'Inspected super-secret-token',
        queryTemplate: 'select "super-secret-token"',
        payload: {
          password: 'plain-password',
          value: 'super-secret-token',
        },
      },
      secretEnvironment(),
    )

    const serialized = JSON.stringify(redacted)

    expect(redacted.nodeId).toBe('node-super-secret-token')
    expect(serialized).not.toContain('plain-password')
    expect(serialized).toContain('********')
  })

  it('redacts structure display fields, metrics, and samples', () => {
    const redacted = redactStructureResponseForEnvironment(
      {
        connectionId: 'conn-1',
        environmentId: 'env-qa',
        engine: 'mongodb',
        summary: 'Structure super-secret-token',
        groups: [
          {
            id: 'group-super-secret-token',
            label: 'Group super-secret-token',
            kind: 'schema',
            detail: 'detail super-secret-token',
          },
        ],
        nodes: [
          {
            id: 'node-super-secret-token',
            family: 'document',
            label: 'Node super-secret-token',
            kind: 'collection',
            groupId: 'group-super-secret-token',
            detail: 'detail super-secret-token',
            metrics: [{ label: 'Token', value: 'super-secret-token' }],
            fields: [
              {
                name: 'super-secret-token',
                dataType: 'string',
                detail: 'field super-secret-token',
              },
            ],
            sample: {
              token: 'super-secret-token',
              password: 'plain-password',
            },
          },
        ],
        edges: [
          {
            id: 'edge-super-secret-token',
            from: 'node-super-secret-token',
            to: 'other-super-secret-token',
            label: 'edge super-secret-token',
            kind: 'references',
          },
        ],
        metrics: [{ label: 'Sample', value: 'super-secret-token' }],
        nextCursor: 'cursor-super-secret-token',
      },
      secretEnvironment(),
    )

    const serialized = JSON.stringify(redacted)

    const group = redacted.groups[0]
    const node = redacted.nodes[0]
    const edge = redacted.edges[0]
    expect(group).toBeDefined()
    expect(node).toBeDefined()
    expect(edge).toBeDefined()
    if (!group || !node || !edge) throw new Error('Expected redacted structure rows.')
    expect(group.id).toBe('group-super-secret-token')
    expect(node.id).toBe('node-super-secret-token')
    expect(edge.from).toBe('node-super-secret-token')
    expect(node.label).toBe('Node ********')
    expect(node.fields?.[0]?.name).toBe('********')
    expect(serialized).not.toContain('plain-password')
  })

  it('redacts Redis scan key metadata before display', () => {
    const redacted = redactRedisKeyScanForEnvironment(
      {
        connectionId: 'conn-1',
        environmentId: 'env-qa',
        databaseIndex: 0,
        cursor: 'cursor-super-secret-token',
        nextCursor: 'next-super-secret-token',
        scannedCount: 1,
        keys: [
          {
            key: 'session:super-secret-token',
            type: 'string',
            ttlLabel: 'expires super-secret-token',
            memoryUsageLabel: '96 B super-secret-token',
            encoding: 'raw super-secret-token',
          },
        ],
        usedTypeFilterFallback: false,
        moduleTypes: ['module-super-secret-token'],
        warnings: ['warning super-secret-token'],
      },
      secretEnvironment(),
    )

    const serialized = JSON.stringify(redacted)

    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).toContain('********')
  })
})
