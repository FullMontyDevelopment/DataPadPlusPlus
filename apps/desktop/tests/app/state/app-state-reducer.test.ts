import type {
  ExecutionResponse,
  ExplorerResponse,
  QueryTabState,
  StructureResponse,
} from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { createSeedBootstrapPayload } from '../../fixtures/seed-workspace'
import { initialState, reducer } from '../../../src/app/state/app-state-reducer'
import { shouldDispatchCommandError } from '../../../src/app/state/app-state'
import type { StateShape } from '../../../src/app/state/app-state-types'
import { connectionHealthKey } from '../../../src/app/state/connection-health'

describe('app-state command error routing', () => {
  it('lets scoped actions suppress generic Desktop command messages', () => {
    expect(shouldDispatchCommandError({ suppressWorkbenchMessage: true })).toBe(false)
    expect(shouldDispatchCommandError()).toBe(true)
  })

  it('still adds a workbench message for non-scoped command failures', () => {
    const state = reducer(
      {
        ...initialState,
        status: 'ready',
        payload: createSeedBootstrapPayload(),
      },
      {
        type: 'COMMAND_ERROR',
        message: 'Unable to save workspace.',
      },
    )

    expect(state.workbenchMessages[0]).toEqual(
      expect.objectContaining({
        message: 'Unable to save workspace.',
        source: 'Desktop command',
      }),
    )
    expect(state.payload?.snapshot.ui.bottomPanelVisible).toBe(true)
    expect(state.payload?.snapshot.ui.activeBottomPanelTab).toBe('messages')
  })

  it('records persistence warnings without leaving Results', () => {
    const payload = createSeedBootstrapPayload()
    payload.snapshot.ui.bottomPanelVisible = true
    payload.snapshot.ui.activeBottomPanelTab = 'results'

    const state = reducer(
      {
        ...initialState,
        status: 'ready',
        payload,
      },
      {
        type: 'WORKBENCH_MESSAGE_ADDED',
        openMessages: false,
        message: {
          id: 'message-persistence',
          severity: 'warning',
          message: 'The result is available, but workspace history could not be saved.',
          source: 'Workspace persistence',
          createdAt: '2026-01-01T00:00:00.000Z',
          details: 'workspace-save-blocked',
        },
      },
    )

    expect(state.workbenchMessages).toHaveLength(1)
    expect(state.payload?.snapshot.ui.activeBottomPanelTab).toBe('results')
    expect(state.payload?.snapshot.ui.bottomPanelVisible).toBe(true)
  })

  it('keeps Results active for a non-blocking command error', () => {
    const payload = createSeedBootstrapPayload()
    payload.snapshot.ui.bottomPanelVisible = true
    payload.snapshot.ui.activeBottomPanelTab = 'results'

    const state = reducer(
      {
        ...initialState,
        status: 'ready',
        payload,
      },
      {
        type: 'COMMAND_ERROR',
        message: 'Workspace history could not be saved.',
        openMessages: false,
      },
    )

    expect(state.workbenchMessages).toHaveLength(1)
    expect(state.payload?.snapshot.ui.activeBottomPanelTab).toBe('results')
  })

  it('keeps a successful result interactive when its persistence warning is recorded', () => {
    const payload = payloadWithTwoTabs()
    const tab = expectTab(payload.snapshot.tabs[0])
    payload.snapshot.ui.activeTabId = tab.id
    payload.snapshot.ui.bottomPanelVisible = true
    payload.snapshot.ui.activeBottomPanelTab = 'results'
    let state: StateShape = {
      ...initialState,
      status: 'ready',
      payload,
    }

    state = reducer(state, {
      type: 'EXECUTION_LOADING',
      tabId: tab.id,
      execution: activeExecution('execution-count'),
    })
    state = reducer(state, {
      type: 'EXECUTION_READY',
      execution: {
        ...executionResponse(tab, 'execution-count'),
        persistenceWarning: {
          code: 'workspace-save-blocked',
          message: 'Workspace history could not be saved.',
        },
      },
      request: executionRequest(tab, 'execution-count'),
    })
    state = reducer(state, {
      type: 'WORKBENCH_MESSAGE_ADDED',
      openMessages: false,
      message: {
        id: 'message-count-persistence',
        severity: 'warning',
        message: 'Workspace history could not be saved.',
        source: 'Workspace persistence',
        createdAt: '2026-01-01T00:00:01.000Z',
        details: 'workspace-save-blocked',
      },
    })

    const currentTab = state.payload?.snapshot.tabs.find((item) => item.id === tab.id)
    expect(currentTab?.result?.id).toBe('execution-count-result')
    expect(state.payload?.snapshot.ui.activeBottomPanelTab).toBe('results')
    expect(state.workbenchMessages).toHaveLength(1)
  })
})

describe('app-state reducer connection health', () => {
  it('tracks health independently by connection and environment', () => {
    let state = reducer(initialState, {
      type: 'CONNECTION_HEALTH_CHECKING',
      connectionId: 'connection-mongo',
      environmentId: 'env-local',
      source: 'manual-test',
    })

    state = reducer(state, {
      type: 'CONNECTION_HEALTH_READY',
      connectionId: 'connection-mongo',
      environmentId: 'env-local',
      source: 'manual-test',
      result: {
        ok: true,
        engine: 'mongodb',
        message: 'Connection ready',
        warnings: [],
        resolvedHost: 'localhost',
        resolvedDatabase: 'catalog',
        durationMs: 12,
      },
    })

    state = reducer(state, {
      type: 'CONNECTION_HEALTH_READY',
      connectionId: 'connection-mongo',
      environmentId: 'env-prod',
      source: 'manual-test',
      result: {
        ok: false,
        engine: 'mongodb',
        message: 'Connection refused',
        warnings: [],
        resolvedHost: 'prod.example',
        durationMs: 30,
      },
    })

    expect(
      state.connectionHealthByKey[connectionHealthKey('connection-mongo', 'env-local')]
        ?.status,
    ).toBe('connected')
    expect(
      state.connectionHealthByKey[connectionHealthKey('connection-mongo', 'env-prod')]
        ?.status,
    ).toBe('issue')
  })

  it('marks successful metadata refreshes as connected without clearing other health', () => {
    let state = reducer(initialState, {
      type: 'CONNECTION_HEALTH_ISSUE',
      connectionId: 'connection-redis',
      environmentId: 'env-local',
      source: 'manual-test',
      message: 'Connection refused',
    })

    state = reducer(state, {
      type: 'CONNECTION_HEALTH_CONNECTED',
      connectionId: 'connection-mongo',
      environmentId: 'env-local',
      source: 'metadata',
      message: 'Metadata loaded',
    })

    expect(
      state.connectionHealthByKey[connectionHealthKey('connection-mongo', 'env-local')]
        ?.status,
    ).toBe('connected')
    expect(
      state.connectionHealthByKey[connectionHealthKey('connection-redis', 'env-local')]
        ?.status,
    ).toBe('issue')
  })

  it('settles a failed check back to the previous health state', () => {
    let state = reducer(initialState, {
      type: 'CONNECTION_HEALTH_CONNECTED',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'query',
      message: 'Query completed',
    })

    state = reducer(state, {
      type: 'CONNECTION_HEALTH_CHECKING',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'structure',
      message: 'Loading structure',
    })

    expect(
      state.connectionHealthByKey[connectionHealthKey('connection-sql', 'env-local')]
        ?.status,
    ).toBe('checking')

    state = reducer(state, {
      type: 'CONNECTION_HEALTH_SETTLED',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'structure',
    })

    const health =
      state.connectionHealthByKey[connectionHealthKey('connection-sql', 'env-local')]
    expect(health?.status).toBe('connected')
    expect(health?.message).toBe('Query completed')
  })

  it('does not let a stale health check settle a newer check', () => {
    let state = reducer(initialState, {
      type: 'CONNECTION_HEALTH_CHECKING',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'startup',
      checkId: 'startup-old',
    })

    state = reducer(state, {
      type: 'CONNECTION_HEALTH_CHECKING',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'startup',
      checkId: 'startup-new',
    })

    state = reducer(state, {
      type: 'CONNECTION_HEALTH_SETTLED',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'startup',
      checkId: 'startup-old',
    })

    const health =
      state.connectionHealthByKey[connectionHealthKey('connection-sql', 'env-local')]
    expect(health?.status).toBe('checking')
    expect(health?.checkId).toBe('startup-new')
  })

  it('ignores a stale health result for a newer active check', () => {
    let state = reducer(initialState, {
      type: 'CONNECTION_HEALTH_CHECKING',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'startup',
      checkId: 'startup-new',
    })

    state = reducer(state, {
      type: 'CONNECTION_HEALTH_READY',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'startup',
      checkId: 'startup-old',
      result: {
        ok: true,
        engine: 'sqlserver',
        message: 'Connection ready',
        warnings: [],
        resolvedHost: 'localhost',
        durationMs: 5,
      },
    })

    const health =
      state.connectionHealthByKey[connectionHealthKey('connection-sql', 'env-local')]
    expect(health?.status).toBe('checking')
    expect(health?.checkId).toBe('startup-new')
  })

  it('does not let a slow startup result replace newer health', () => {
    let state = reducer(initialState, {
      type: 'CONNECTION_HEALTH_CHECKING',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'startup',
      checkId: 'startup-old',
    })

    state = reducer(state, {
      type: 'CONNECTION_HEALTH_CONNECTED',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'metadata',
      message: 'Metadata loaded',
    })

    state = reducer(state, {
      type: 'CONNECTION_HEALTH_READY',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'startup',
      checkId: 'startup-old',
      result: {
        ok: false,
        engine: 'sqlserver',
        message: 'Connection refused',
        warnings: [],
        resolvedHost: 'localhost',
        durationMs: 50,
      },
    })

    const health =
      state.connectionHealthByKey[connectionHealthKey('connection-sql', 'env-local')]
    expect(health?.status).toBe('connected')
    expect(health?.source).toBe('metadata')
  })

  it('redacts secret-looking values from health messages', () => {
    const state = reducer(initialState, {
      type: 'CONNECTION_HEALTH_ISSUE',
      connectionId: 'connection-sql',
      environmentId: 'env-local',
      source: 'query',
      message: 'Connection failed with password=open-sesame',
    })

    expect(
      state.connectionHealthByKey[connectionHealthKey('connection-sql', 'env-local')]
        ?.message,
    ).toContain('password=********')
  })
})

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

describe('app-state reducer structure metadata', () => {
  const structure = (connectionId: string): StructureResponse => ({
    connectionId,
    environmentId: 'env-dev',
    engine: 'oracle',
    summary: 'Oracle structure',
    groups: [],
    nodes: [],
    edges: [],
    metrics: [],
  })

  it('invalidates only the matching connection structure after DDL', () => {
    let state = reducer(initialState, {
      type: 'STRUCTURE_READY',
      structure: structure('connection-oracle'),
    })

    state = reducer(state, {
      type: 'STRUCTURE_INVALIDATED',
      connectionId: 'connection-other',
      environmentId: 'env-dev',
    })
    expect(state.structure?.connectionId).toBe('connection-oracle')

    state = reducer(state, {
      type: 'STRUCTURE_INVALIDATED',
      connectionId: 'connection-oracle',
      environmentId: 'env-dev',
    })
    expect(state.structure).toBeUndefined()
    expect(state.structureStatus).toBe('idle')
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

  it('settles a server-phase datastore refresh as soon as its data is returned', () => {
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
      execution: activeExecution('redis-scan'),
    })

    expect(state.payload?.snapshot.tabs[0]?.status).toBe('running')
    expect(state.payload?.snapshot.tabs[0]?.activeExecution?.phase).toBe('server')

    state = reducer(state, {
      type: 'EXECUTION_DISPLAYED',
      tabId: tab.id,
      executionId: 'redis-scan',
    })

    expect(state.executionsByTab[tab.id]).toBeUndefined()
    expect(state.payload?.snapshot.tabs[0]?.activeExecution).toBeUndefined()
    expect(state.payload?.snapshot.tabs[0]?.status).toBe('success')
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

  it('does not let a delayed tab update erase a newer execution result', () => {
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
      execution: activeExecution('execution-new'),
    })
    const completedExecution = executionResponse(tab, 'execution-new')
    completedExecution.tab.history = [
      {
        id: 'history-new',
        queryText: tab.queryText,
        executedAt: '2026-01-01T00:00:01.000Z',
        status: 'success',
      },
    ]
    state = reducer(state, {
      type: 'EXECUTION_READY',
      execution: completedExecution,
      request: executionRequest(tab, 'execution-new'),
    })

    const delayedPayload = payloadWithTwoTabs()
    const delayedTab = expectTab(delayedPayload.snapshot.tabs[0])
    delayedTab.queryText = 'select newly typed text;'
    delayedTab.lastRunAt = undefined
    delayedTab.result = undefined
    delayedTab.history = []
    state = reducer(state, {
      type: 'COMMAND_SUCCESS',
      payload: delayedPayload,
    })

    const currentTab = state.payload?.snapshot.tabs.find((item) => item.id === tab.id)
    expect(currentTab?.queryText).toBe('select newly typed text;')
    expect(currentTab?.result?.id).toBe('execution-new-result')
    expect(currentTab?.history).not.toHaveLength(0)
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
