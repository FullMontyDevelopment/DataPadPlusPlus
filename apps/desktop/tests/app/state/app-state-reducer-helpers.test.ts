import type {
  BootstrapPayload,
  ExecutionRequest,
  ExecutionResponse,
  ExplorerResponse,
  ResultPageResponse,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { createSeedBootstrapPayload } from '../../fixtures/seed-workspace'
import {
  applyExecutionToPayload,
  applyResultPageToPayload,
  createWorkbenchMessage,
  hasExplorerScope,
  isExplorerRequestLoading,
  mergeExplorerCacheEntry,
  openMessagesPayload,
} from '../../../src/app/state/app-state-reducer-helpers'
import { mergeExplorerResponse } from '../../../src/app/state/app-state-explorer-merge'

function payloadWithResult(resultPayload: ResultPayload): BootstrapPayload {
  const payload = createSeedBootstrapPayload()
  const tab = payload.snapshot.tabs[0]

  if (!tab) {
    throw new Error('Seed fixture must include at least one tab')
  }

  payload.snapshot.tabs = [
    {
      ...tab,
      result: {
        id: 'result-1',
        engine: 'mongodb',
        summary: '1 row',
        defaultRenderer: resultPayload.renderer,
        rendererModes: [resultPayload.renderer],
        payloads: [resultPayload],
        notices: [],
        executedAt: '2026-05-13T12:00:00.000Z',
        durationMs: 12,
        truncated: false,
        rowLimit: 20,
        pageInfo: {
          pageSize: 20,
          pageIndex: 0,
          bufferedRows: 1,
          hasMore: false,
        },
      },
    },
  ]
  payload.snapshot.ui.activeTabId = tab.id
  payload.snapshot.ui.bottomPanelVisible = false
  payload.snapshot.ui.activeBottomPanelTab = 'messages'

  return payload
}

function resultFrom(payload: BootstrapPayload | undefined) {
  const result = payload?.snapshot.tabs[0]?.result

  if (!result) {
    throw new Error('Expected first tab to have a result envelope')
  }

  return result
}

function pageFor(
  payload: ResultPayload,
  pageInfo: Partial<ResultPageResponse['pageInfo']> = {},
  notices: string[] = [],
): ResultPageResponse {
  return {
    tabId: 'tab-sql-ops',
    payload,
    notices,
    pageInfo: {
      pageSize: 20,
      pageIndex: 1,
      bufferedRows: 1,
      hasMore: false,
      ...pageInfo,
    },
  }
}

describe('createWorkbenchMessage', () => {
  it('creates user-facing messages with stable source, severity, and details', () => {
    const message = createWorkbenchMessage(
      'Could not run query',
      'Desktop command',
      'warning',
      'Relation accounts was not found.',
    )

    expect(message.id).toMatch(/^msg-/)
    expect(message).toMatchObject({
      severity: 'warning',
      message: 'Could not run query',
      source: 'Desktop command',
      details: 'Relation accounts was not found.',
    })
    expect(new Date(message.createdAt).toString()).not.toBe('Invalid Date')
  })
})

describe('openMessagesPayload', () => {
  it('opens the messages panel without mutating the previous payload', () => {
    const payload = createSeedBootstrapPayload()
    payload.snapshot.ui.bottomPanelVisible = false
    payload.snapshot.ui.activeBottomPanelTab = 'results'

    const next = openMessagesPayload(payload)

    expect(next?.snapshot.ui.bottomPanelVisible).toBe(true)
    expect(next?.snapshot.ui.activeBottomPanelTab).toBe('messages')
    expect(payload.snapshot.ui.bottomPanelVisible).toBe(false)
    expect(payload.snapshot.ui.activeBottomPanelTab).toBe('results')
  })

  it('preserves undefined payloads for startup errors before workspace load', () => {
    expect(openMessagesPayload(undefined)).toBeUndefined()
  })
})

describe('applyExecutionToPayload', () => {
  function executionFor(payload: BootstrapPayload, dirty: boolean): ExecutionResponse {
    const tab = payload.snapshot.tabs[0]

    if (!tab) {
      throw new Error('Seed fixture must include at least one tab')
    }

    const result: ExecutionResponse['result'] = {
      id: 'result-1',
      engine: 'mongodb',
      summary: '1 row',
      defaultRenderer: 'table',
      rendererModes: ['table'],
      payloads: [
        {
          renderer: 'table',
          columns: ['ok'],
          rows: [['1']],
        },
      ],
      notices: [],
      executedAt: '2026-05-13T12:00:00.000Z',
      durationMs: 8,
      truncated: false,
      rowLimit: 20,
    }

    return {
      executionId: 'execution-1',
      tab: {
        ...tab,
        dirty,
        status: 'success',
        lastRunAt: '2026-05-13T12:00:00.000Z',
        result,
      },
      result,
      guardrail: {
        status: 'allow',
        reasons: [],
        safeModeApplied: false,
      },
      diagnostics: [],
    }
  }

  it('does not mark a clean tab dirty when execution only changes results', () => {
    const payload = createSeedBootstrapPayload()
    const tab = payload.snapshot.tabs[0]

    if (!tab) {
      throw new Error('Seed fixture must include at least one tab')
    }

    payload.snapshot.tabs[0] = {
      ...tab,
      dirty: false,
    }

    const next = applyExecutionToPayload(payload, executionFor(payload, true))

    expect(next?.snapshot.tabs[0]?.dirty).toBe(false)
    expect(next?.snapshot.tabs[0]?.status).toBe('success')
    expect(next?.snapshot.ui.activeBottomPanelTab).toBe('results')
  })

  it('does not clear an existing dirty tab when execution completes', () => {
    const payload = createSeedBootstrapPayload()
    const tab = payload.snapshot.tabs[0]

    if (!tab) {
      throw new Error('Seed fixture must include at least one tab')
    }

    payload.snapshot.tabs[0] = {
      ...tab,
      dirty: true,
    }

    const next = applyExecutionToPayload(payload, executionFor(payload, false))

    expect(next?.snapshot.tabs[0]?.dirty).toBe(true)
  })

  it('persists requested document efficiency mode when execution completes', () => {
    const payload = createSeedBootstrapPayload()
    const tab = payload.snapshot.tabs[0]

    if (!tab) {
      throw new Error('Seed fixture must include at least one tab')
    }

    payload.snapshot.tabs[0] = {
      ...tab,
      documentEfficiencyMode: false,
    }

    const request: ExecutionRequest = {
      tabId: tab.id,
      connectionId: tab.connectionId,
      environmentId: tab.environmentId,
      language: tab.language,
      queryText: tab.queryText,
      documentEfficiencyMode: true,
    }

    const next = applyExecutionToPayload(
      payload,
      executionFor(payload, false),
      {},
      request,
    )

    expect(next?.snapshot.tabs[0]?.documentEfficiencyMode).toBe(true)
  })

  it('normalizes malformed execution payloads from adapters', () => {
    const payload = createSeedBootstrapPayload()
    const execution = executionFor(payload, false)

    if (!execution.result || !execution.tab.result) {
      throw new Error('Expected execution fixture to include a result')
    }

    execution.result.defaultRenderer = 'document'
    execution.result.rendererModes = ['document']
    execution.result.payloads = [null as unknown as ResultPayload]
    execution.tab.result = execution.result

    const next = applyExecutionToPayload(payload, execution)

    expect(next?.snapshot.tabs[0]?.result?.payloads[0]).toEqual({
      renderer: 'document',
      documents: [],
    })
  })
})

describe('applyResultPageToPayload', () => {
  it('appends table rows, updates paging state, and opens results', () => {
    const payload = payloadWithResult({
      renderer: 'table',
      columns: ['id', 'name'],
      rows: [
        ['1', 'Ada'],
      ],
    })

    const next = applyResultPageToPayload(
      payload,
      pageFor(
        {
          renderer: 'table',
          columns: ['id', 'name'],
          rows: [
            ['2', 'Grace'],
            ['3', 'Katherine'],
          ],
        },
        { hasMore: true, nextCursor: 'cursor-2' },
        ['Loaded page 2'],
      ),
    )

    const result = resultFrom(next)
    const table = result?.payloads[0]

    expect(table).toMatchObject({
      renderer: 'table',
      rows: [
        ['1', 'Ada'],
        ['2', 'Grace'],
        ['3', 'Katherine'],
      ],
    })
    expect(result?.pageInfo?.bufferedRows).toBe(3)
    expect(result?.truncated).toBe(true)
    expect(result?.continuationToken).toBe('cursor-2')
    expect(result?.notices).toContainEqual({
      code: 'result-page',
      level: 'info',
      message: 'Loaded page 2',
    })
    expect(next?.snapshot.ui.bottomPanelVisible).toBe(true)
    expect(next?.snapshot.ui.activeBottomPanelTab).toBe('results')

    const originalTable = resultFrom(payload).payloads[0]
    expect(originalTable).toMatchObject({
      renderer: 'table',
      rows: [['1', 'Ada']],
    })
  })

  it('appends document pages and counts buffered documents only', () => {
    const payload = payloadWithResult({
      renderer: 'document',
      documents: [{ _id: 'product-1', name: 'Keyboard' }],
    })

    const next = applyResultPageToPayload(
      payload,
      pageFor({
        renderer: 'document',
        documents: [{ _id: 'product-2', name: 'Mouse' }],
      }),
    )

    const result = resultFrom(next)
    const documentPayload = result?.payloads[0]

    expect(documentPayload).toMatchObject({
      renderer: 'document',
      documents: [
        { _id: 'product-1', name: 'Keyboard' },
        { _id: 'product-2', name: 'Mouse' },
      ],
    })
    expect(result?.pageInfo?.bufferedRows).toBe(2)
  })

  it('appends Cosmos DB JSON document pages and preserves page metadata', () => {
    const payload = payloadWithResult({
      renderer: 'json',
      value: {
        Documents: [{ id: 'product-1' }],
        _count: 1,
        _requestCharge: 2.5,
      },
    })

    const next = applyResultPageToPayload(
      payload,
      pageFor({
        renderer: 'json',
        value: {
          Documents: [{ id: 'product-2' }],
          _count: 1,
          _requestCharge: 3.25,
          _activityId: 'activity-2',
        },
      }),
    )

    expect(resultFrom(next).payloads[0]).toEqual({
      renderer: 'json',
      value: {
        Documents: [{ id: 'product-1' }, { id: 'product-2' }],
        _count: 1,
        _requestCharge: 3.25,
        _activityId: 'activity-2',
      },
    })
    expect(resultFrom(next).pageInfo?.bufferedRows).toBe(2)
  })

  it('treats malformed null document page arrays as empty pages', () => {
    const payload = payloadWithResult({
      renderer: 'document',
      documents: [{ _id: 'product-1', name: 'Keyboard' }],
    })

    const next = applyResultPageToPayload(
      payload,
      pageFor({
        renderer: 'document',
        documents: null,
      } as unknown as ResultPayload),
    )

    const result = resultFrom(next)

    expect(result?.payloads[0]).toMatchObject({
      renderer: 'document',
      documents: [{ _id: 'product-1', name: 'Keyboard' }],
    })
    expect(result?.pageInfo?.bufferedRows).toBe(1)
  })

  it('treats malformed null page payloads as empty pages for the active renderer', () => {
    const payload = payloadWithResult({
      renderer: 'document',
      documents: [{ _id: 'product-1', name: 'Keyboard' }],
    })

    const next = applyResultPageToPayload(
      payload,
      pageFor(null as unknown as ResultPayload),
    )

    const result = resultFrom(next)

    expect(result?.payloads[0]).toMatchObject({
      renderer: 'document',
      documents: [{ _id: 'product-1', name: 'Keyboard' }],
    })
    expect(result?.pageInfo?.bufferedRows).toBe(1)
  })

  it('normalizes malformed current document payloads before appending pages', () => {
    const payload = payloadWithResult({
      renderer: 'document',
      documents: null,
    } as unknown as ResultPayload)

    const next = applyResultPageToPayload(
      payload,
      pageFor({
        renderer: 'document',
        documents: [{ _id: 'product-2', name: 'Mouse' }],
      }),
    )

    const result = resultFrom(next)

    expect(result?.payloads[0]).toMatchObject({
      renderer: 'document',
      documents: [{ _id: 'product-2', name: 'Mouse' }],
    })
    expect(result?.pageInfo?.bufferedRows).toBe(1)
  })

  it('merges key-value entries while preserving missing incoming metadata', () => {
    const payload = payloadWithResult({
      renderer: 'keyvalue',
      entries: {
        'session:1': 'active',
      },
      ttl: '60s',
      memoryUsage: '96 bytes',
    })

    const next = applyResultPageToPayload(
      payload,
      pageFor({
        renderer: 'keyvalue',
        entries: {
          'session:2': 'active',
        },
        ttl: '30s',
      }),
    )

    const result = resultFrom(next)

    expect(result?.payloads[0]).toMatchObject({
      renderer: 'keyvalue',
      entries: {
        'session:1': 'active',
        'session:2': 'active',
      },
      ttl: '30s',
      memoryUsage: '96 bytes',
    })
    expect(result?.pageInfo?.bufferedRows).toBe(2)
  })

  it('appends schema items and adds newly paged renderer payloads', () => {
    const schemaPayload = payloadWithResult({
      renderer: 'schema',
      items: [{ label: 'accounts', detail: 'table' }],
    })

    const schemaNext = applyResultPageToPayload(
      schemaPayload,
      pageFor({
        renderer: 'schema',
        items: [{ label: 'orders', detail: 'table' }],
      }),
    )

    expect(resultFrom(schemaNext).payloads[0]).toMatchObject({
      renderer: 'schema',
      items: [
        { label: 'accounts', detail: 'table' },
        { label: 'orders', detail: 'table' },
      ],
    })
    expect(resultFrom(schemaNext).pageInfo?.bufferedRows).toBe(2)

    const rawPayload = payloadWithResult({ renderer: 'raw', text: 'raw result' })
    const rawNext = applyResultPageToPayload(
      rawPayload,
      pageFor({ renderer: 'json', value: { ok: true } }),
    )

    expect(resultFrom(rawNext).payloads).toEqual([
      { renderer: 'raw', text: 'raw result' },
      {
        renderer: 'json',
        value: { ok: true },
      },
    ])
    expect(resultFrom(rawNext).payloads[1]).toEqual({
      renderer: 'json',
      value: { ok: true },
    })
    expect(resultFrom(rawNext).pageInfo?.bufferedRows).toBe(1)
  })

  it('ignores page data for tabs without a result envelope', () => {
    const payload = createSeedBootstrapPayload()
    const next = applyResultPageToPayload(
      payload,
      pageFor({
        renderer: 'table',
        columns: ['id'],
        rows: [['1']],
      }),
    )

    expect(next?.snapshot.tabs[0]?.result).toBeUndefined()
    expect(next).not.toBe(payload)
  })
})

describe('mergeExplorerResponse', () => {
  const current: ExplorerResponse = {
    connectionId: 'conn-1',
    environmentId: 'env-dev',
    summary: 'Initial metadata',
    capabilities: {
      canCancel: true,
      canExplain: false,
      supportsLiveMetadata: true,
      editorLanguage: 'sql',
      defaultRowLimit: 100,
    },
    nodes: [
      {
        id: 'schema:public',
        family: 'sql',
        label: 'public',
        kind: 'schema',
        detail: '2 tables',
      },
      {
        id: 'table:accounts',
        family: 'sql',
        label: 'accounts',
        kind: 'table',
        detail: 'old detail',
      },
    ],
  }

  it('merges explorer nodes for the same connection and environment', () => {
    const incoming: ExplorerResponse = {
      ...current,
      summary: 'Refreshed metadata',
      nodes: [
        {
          id: 'table:accounts',
          family: 'sql',
          label: 'accounts',
          kind: 'table',
          detail: 'new detail',
        },
        {
          id: 'table:orders',
          family: 'sql',
          label: 'orders',
          kind: 'table',
          detail: 'fresh table',
        },
      ],
    }

    const merged = mergeExplorerResponse(current, incoming)

    expect(merged.summary).toBe('Refreshed metadata')
    expect(merged.nodes).toEqual([
      current.nodes[0],
      incoming.nodes[0],
      incoming.nodes[1],
    ])
  })

  it('replaces explorer state when the connection or environment changes', () => {
    const incoming: ExplorerResponse = {
      ...current,
      environmentId: 'env-prod',
      summary: 'Production metadata',
      nodes: [],
    }

    expect(mergeExplorerResponse(current, incoming)).toBe(incoming)
    expect(mergeExplorerResponse(undefined, incoming)).toBe(incoming)
  })
})

describe('mergeExplorerCacheEntry', () => {
  const rootResponse: ExplorerResponse = {
    connectionId: 'conn-1',
    environmentId: 'env-dev',
    summary: 'Mongo databases',
    capabilities: {
      canCancel: true,
      canExplain: false,
      supportsLiveMetadata: true,
      editorLanguage: 'javascript',
      defaultRowLimit: 100,
    },
    nodes: [
      {
        id: 'database:catalog',
        family: 'document',
        label: 'catalog',
        kind: 'database',
        detail: 'MongoDB database',
        scope: 'database:catalog',
      },
      {
        id: 'database:orders',
        family: 'document',
        label: 'orders',
        kind: 'database',
        detail: 'MongoDB database',
        scope: 'database:orders',
      },
    ],
  }

  it('keeps root metadata when a scoped branch load arrives', () => {
    const scopedResponse: ExplorerResponse = {
      ...rootResponse,
      scope: 'database:catalog',
      summary: 'Catalog collections',
      nodes: [
        {
          id: 'collection:catalog.products',
          family: 'document',
          label: 'products',
          kind: 'collection',
          detail: 'collection',
          path: ['catalog', 'Collections'],
          scope: 'collection:catalog:products',
        },
      ],
    }

    const rootEntry = mergeExplorerCacheEntry(undefined, rootResponse)
    const mergedEntry = mergeExplorerCacheEntry(rootEntry, scopedResponse)

    expect(hasExplorerScope(mergedEntry)).toBe(true)
    expect(hasExplorerScope(mergedEntry, 'database:catalog')).toBe(true)
    expect(mergedEntry.response.nodes.map((node) => node.id)).toEqual([
      'database:catalog',
      'database:orders',
      'collection:catalog.products',
    ])
  })

  it('replaces only the requested scope when the same scope refreshes empty', () => {
    const entry = mergeExplorerCacheEntry(
      mergeExplorerCacheEntry(undefined, rootResponse),
      {
        ...rootResponse,
        scope: 'database:catalog',
        nodes: [
          {
            id: 'collection:catalog.products',
            family: 'document',
            label: 'products',
            kind: 'collection',
            detail: 'collection',
          },
        ],
      },
    )
    const refreshed = mergeExplorerCacheEntry(entry, {
      ...rootResponse,
      scope: 'database:catalog',
      summary: 'No collections',
      nodes: [],
    })

    expect(refreshed.response.nodes.map((node) => node.id)).toEqual([
      'database:catalog',
      'database:orders',
    ])
  })

  it('keeps SQL Server parent branches when a deep scoped refresh returns empty', () => {
    const sqlRoot: ExplorerResponse = {
      connectionId: 'conn-sql',
      environmentId: 'env-dev',
      summary: 'SQL databases',
      capabilities: rootResponse.capabilities,
      nodes: [
        {
          id: 'database:datapadplusplus',
          family: 'sql',
          label: 'datapadplusplus',
          kind: 'database',
          detail: 'ONLINE',
          scope: 'database:datapadplusplus',
        },
      ],
    }
    const databaseScope: ExplorerResponse = {
      ...sqlRoot,
      scope: 'database:datapadplusplus',
      nodes: [
        {
          id: 'sqlserver:datapadplusplus:tables',
          family: 'sql',
          label: 'Tables',
          kind: 'tables',
          detail: 'Base tables',
          scope: 'sqlserver:datapadplusplus:tables',
        },
      ],
    }
    const tablesScope: ExplorerResponse = {
      ...sqlRoot,
      scope: 'sqlserver:datapadplusplus:tables',
      nodes: [
        {
          id: 'table:datapadplusplus:dbo:accounts',
          family: 'sql',
          label: 'dbo.accounts',
          kind: 'table',
          detail: 'base table',
          scope: 'table:datapadplusplus:dbo:accounts',
        },
        {
          id: 'columns:datapadplusplus:dbo:accounts',
          family: 'sql',
          label: 'Columns',
          kind: 'columns',
          detail: 'Column definitions',
          scope: 'columns:datapadplusplus:dbo:accounts',
        },
      ],
    }
    const columnsScope: ExplorerResponse = {
      ...sqlRoot,
      scope: 'columns:datapadplusplus:dbo:accounts',
      nodes: [
        {
          id: 'column:datapadplusplus:dbo:accounts:id',
          family: 'sql',
          label: 'id',
          kind: 'column',
          detail: 'int not null',
        },
      ],
    }

    const entry = [
      sqlRoot,
      databaseScope,
      tablesScope,
      columnsScope,
    ].reduce<ReturnType<typeof mergeExplorerCacheEntry> | undefined>(
      (current, response) => mergeExplorerCacheEntry(current, response),
      undefined,
    )
    const refreshed = mergeExplorerCacheEntry(entry, {
      ...sqlRoot,
      scope: 'columns:datapadplusplus:dbo:accounts',
      nodes: [],
    })

    expect(refreshed.response.nodes.map((node) => node.id)).toEqual([
      'database:datapadplusplus',
      'sqlserver:datapadplusplus:tables',
      'table:datapadplusplus:dbo:accounts',
      'columns:datapadplusplus:dbo:accounts',
    ])
  })
})

describe('isExplorerRequestLoading', () => {
  it('tracks loading by connection, environment, and scope', () => {
    const loadingRequests: Record<string, string> = {
      'conn-1::env-dev::__root__': 'request-root',
      'conn-1::env-dev::database:catalog': 'request-catalog',
    }

    expect(isExplorerRequestLoading(loadingRequests, 'conn-1', 'env-dev')).toBe(true)
    expect(
      isExplorerRequestLoading(loadingRequests, 'conn-1', 'env-dev', 'database:catalog'),
    ).toBe(true)
    expect(
      isExplorerRequestLoading(loadingRequests, 'conn-1', 'env-dev', 'database:orders'),
    ).toBe(false)
  })
})
