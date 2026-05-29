import type { ExecutionResponse, ExplorerResponse, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { createSeedBootstrapPayload } from '../../test/fixtures/seed-workspace'
import { initialState, reducer } from './app-state-reducer'
import type { StateShape } from './app-state-types'

describe('app-state reducer explorer metadata cache', () => {
  it('keeps concurrent connection metadata isolated while scoped refreshes complete', () => {
    const mongoRoot = explorerResponse('connection-mongo', 'env-dev', [
      explorerNode('database:catalog', 'catalog', 'database', 'database:catalog'),
    ])
    const redisRoot = explorerResponse('connection-redis', 'env-dev', [
      explorerNode('prefix:orders:', 'orders:', 'prefix', 'prefix:orders:'),
    ])
    const mongoCollections = explorerResponse(
      'connection-mongo',
      'env-dev',
      [
        explorerNode(
          'collection:catalog.products',
          'products',
          'collection',
          'collection:catalog:products',
          ['catalog', 'Collections'],
        ),
      ],
      'database:catalog',
    )

    let state = reducer(initialState, {
      type: 'EXPLORER_LOADING',
      request: {
        connectionId: 'connection-mongo',
        environmentId: 'env-dev',
      },
      requestId: 'mongo-root-1',
    })

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: mongoRoot,
      requestId: 'mongo-root-1',
    })

    state = reducer(state, {
      type: 'EXPLORER_LOADING',
      request: {
        connectionId: 'connection-redis',
        environmentId: 'env-dev',
      },
      requestId: 'redis-root-1',
    })

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: redisRoot,
      requestId: 'redis-root-1',
    })

    state = reducer(state, {
      type: 'EXPLORER_LOADING',
      request: {
        connectionId: 'connection-mongo',
        environmentId: 'env-dev',
        scope: 'database:catalog',
      },
      requestId: 'mongo-scope-1',
    })

    expect(state.explorerCache?.['connection-redis::env-dev']?.response.nodes).toEqual(
      redisRoot.nodes,
    )
    expect(state.explorerLoadingRequests['connection-mongo::env-dev::database:catalog']).toBe(
      'mongo-scope-1',
    )

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: mongoCollections,
      requestId: 'mongo-scope-1',
    })

    expect(
      state.explorerCache?.['connection-mongo::env-dev']?.response.nodes.map((node) => node.id),
    ).toEqual(['database:catalog', 'collection:catalog.products'])
    expect(
      state.explorerCache?.['connection-redis::env-dev']?.response.nodes.map((node) => node.id),
    ).toEqual(['prefix:orders:'])
    expect(state.explorerLoadingRequests).toEqual({})
  })

  it('ignores stale explorer metadata responses for the same branch', () => {
    const oldRoot = explorerResponse('connection-mongo', 'env-dev', [
      explorerNode('database:old', 'old', 'database', 'database:old'),
    ])
    const freshRoot = explorerResponse('connection-mongo', 'env-dev', [
      explorerNode('database:fresh', 'fresh', 'database', 'database:fresh'),
    ])

    let state = reducer(initialState, {
      type: 'EXPLORER_LOADING',
      request: {
        connectionId: 'connection-mongo',
        environmentId: 'env-dev',
      },
      requestId: 'old-request',
    })

    state = reducer(state, {
      type: 'EXPLORER_LOADING',
      request: {
        connectionId: 'connection-mongo',
        environmentId: 'env-dev',
      },
      requestId: 'fresh-request',
    })

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: oldRoot,
      requestId: 'old-request',
    })

    expect(state.explorerCache).toBeUndefined()
    expect(state.explorerLoadingRequests['connection-mongo::env-dev::__root__']).toBe(
      'fresh-request',
    )

    state = reducer(state, {
      type: 'EXPLORER_READY',
      explorer: freshRoot,
      requestId: 'fresh-request',
    })

    expect(state.explorerCache?.['connection-mongo::env-dev']?.response.nodes[0]?.id).toBe(
      'database:fresh',
    )
    expect(state.explorerLoadingRequests).toEqual({})
  })

  it('records non-loading explorer errors such as failed object inspection', () => {
    const state = reducer(initialState, {
      type: 'EXPLORER_ERROR',
      request: {
        connectionId: 'connection-mongo',
        environmentId: 'env-dev',
      },
      message: 'Unable to inspect explorer object.',
    })

    expect(state.explorerError).toBe('Unable to inspect explorer object.')
    expect(state.explorerLoadingRequests).toEqual({})
  })
})

describe('app-state reducer tab-scoped execution', () => {
  it('keeps tab B running when tab A completes', () => {
    const payload = payloadWithTwoTabs()
    const tabA = expectTab(payload.snapshot.tabs[0])
    const tabB = expectTab(payload.snapshot.tabs[1])
    let state: StateShape = {
      ...initialState,
      status: 'ready',
      payload,
    }

    state = reducer(state, {
      type: 'EXECUTION_LOADING',
      tabId: tabA.id,
      execution: activeExecution('execution-a'),
    })
    state = reducer(state, {
      type: 'EXECUTION_LOADING',
      tabId: tabB.id,
      execution: activeExecution('execution-b'),
    })
    state = reducer(state, {
      type: 'EXECUTION_READY',
      execution: executionResponse(tabA, 'execution-a'),
      request: executionRequest(tabA, 'execution-a'),
    })

    expect(state.executionsByTab[tabA.id]).toBeUndefined()
    expect(state.executionsByTab[tabB.id]?.executionId).toBe('execution-b')
    expect(state.payload?.snapshot.tabs.find((tab) => tab.id === tabA.id)?.status).toBe(
      'success',
    )
    expect(state.payload?.snapshot.tabs.find((tab) => tab.id === tabB.id)?.status).toBe(
      'running',
    )
  })

  it('ignores stale same-tab completions after a newer execution starts', () => {
    const payload = payloadWithTwoTabs()
    const tab = expectTab(payload.snapshot.tabs[0])
    let state: StateShape = {
      ...initialState,
      status: 'ready',
      payload,
    }

    state = reducer(state, {
      type: 'EXECUTION_LOADING',
      tabId: tab.id,
      execution: activeExecution('execution-old'),
    })
    state = reducer(state, {
      type: 'EXECUTION_LOADING',
      tabId: tab.id,
      execution: activeExecution('execution-new'),
    })

    const before = state.payload
    state = reducer(state, {
      type: 'EXECUTION_READY',
      execution: executionResponse(tab, 'execution-old'),
      request: executionRequest(tab, 'execution-old'),
    })

    expect(state.payload).toBe(before)
    expect(state.lastExecution).toBeUndefined()
    expect(state.executionsByTab[tab.id]?.executionId).toBe('execution-new')
  })

  it('keeps a rendered result busy until the results panel acknowledges display', () => {
    const payload = payloadWithTwoTabs()
    const tab = expectTab(payload.snapshot.tabs[0])
    payload.snapshot.ui.activeTabId = tab.id
    let state: StateShape = {
      ...initialState,
      status: 'ready',
      payload,
    }

    state = reducer(state, {
      type: 'EXECUTION_LOADING',
      tabId: tab.id,
      execution: activeExecution('execution-a'),
    })
    state = reducer(state, {
      type: 'EXECUTION_READY',
      execution: executionResponse(tab, 'execution-a'),
      request: executionRequest(tab, 'execution-a'),
      waitForDisplay: true,
    })

    expect(state.executionsByTab[tab.id]?.phase).toBe('rendering')
    expect(state.payload?.snapshot.tabs[0]?.status).toBe('running')

    state = reducer(state, {
      type: 'EXECUTION_DISPLAYED',
      tabId: tab.id,
      executionId: 'execution-a',
    })

    expect(state.executionsByTab[tab.id]).toBeUndefined()
    expect(state.payload?.snapshot.tabs[0]?.status).toBe('success')
    expect(state.payload?.snapshot.tabs[0]?.result?.serverDurationMs).toBe(10)
    expect(state.payload?.snapshot.tabs[0]?.result?.displayDurationMs).toBeGreaterThan(10)
  })

  it('preserves running state when a command payload updates the running tab', () => {
    const payload = payloadWithTwoTabs()
    const tab = expectTab(payload.snapshot.tabs[0])
    let state: StateShape = {
      ...initialState,
      status: 'ready',
      payload,
    }

    state = reducer(state, {
      type: 'EXECUTION_LOADING',
      tabId: tab.id,
      execution: activeExecution('execution-a'),
    })

    const incomingPayload = payloadWithTwoTabs()
    const incomingTab = expectTab(incomingPayload.snapshot.tabs[0])
    incomingTab.queryText = 'select 2;'
    incomingTab.dirty = true

    state = reducer(state, {
      type: 'COMMAND_SUCCESS',
      payload: incomingPayload,
    })

    const updatedTab = state.payload?.snapshot.tabs.find((item) => item.id === tab.id)
    expect(updatedTab?.status).toBe('running')
    expect(updatedTab?.dirty).toBe(true)
    expect(updatedTab?.activeExecution?.executionId).toBe('execution-a')
  })
})

function explorerResponse(
  connectionId: string,
  environmentId: string,
  nodes: ExplorerResponse['nodes'],
  scope?: string,
): ExplorerResponse {
  return {
    connectionId,
    environmentId,
    scope,
    summary: `${connectionId} metadata`,
    capabilities: {
      canCancel: true,
      canExplain: false,
      supportsLiveMetadata: true,
      editorLanguage: 'sql',
      defaultRowLimit: 100,
    },
    nodes,
  }
}

function explorerNode(
  id: string,
  label: string,
  kind: string,
  scope: string,
  path?: string[],
): ExplorerResponse['nodes'][number] {
  return {
    id,
    label,
    kind,
    scope,
    path,
    family: 'document',
    detail: '',
  }
}

function payloadWithTwoTabs() {
  const payload = createSeedBootstrapPayload()
  const tab = payload.snapshot.tabs[0]

  if (!tab) {
    throw new Error('Seed fixture must include a tab')
  }

  payload.snapshot.tabs = [
    {
      ...tab,
      id: 'tab-a',
      title: 'Tab A',
      editorLabel: 'Tab A',
      status: 'idle',
      result: undefined,
      history: [],
    },
    {
      ...tab,
      id: 'tab-b',
      title: 'Tab B',
      editorLabel: 'Tab B',
      status: 'idle',
      result: undefined,
      history: [],
    },
  ]
  payload.snapshot.ui.activeTabId = 'tab-a'
  return payload
}

function expectTab(tab: QueryTabState | undefined): QueryTabState {
  if (!tab) {
    throw new Error('Expected query tab fixture')
  }

  return tab
}

function activeExecution(
  executionId: string,
): NonNullable<QueryTabState['activeExecution']> {
  return {
    executionId,
    phase: 'server',
    startedAt: '2026-01-01T00:00:00.000Z',
  }
}

function executionRequest(tab: QueryTabState, executionId: string) {
  return {
    executionId,
    tabId: tab.id,
    connectionId: tab.connectionId,
    environmentId: tab.environmentId,
    language: tab.language,
    queryText: tab.queryText,
  }
}

function executionResponse(tab: QueryTabState, executionId: string): ExecutionResponse {
  const result: ExecutionResponse['result'] = {
    id: `${executionId}-result`,
    engine: tab.language === 'mongodb' ? 'mongodb' : 'postgresql',
    summary: '1 row returned.',
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
    executedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 10,
  }

  return {
    executionId,
    tab: {
      ...tab,
      status: 'success',
      result,
      lastRunAt: '2026-01-01T00:00:01.000Z',
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
