import assert from 'node:assert/strict'
import { createServer } from 'node:net'

// Runs only in the runner's disposable workspace, with its file-backed test vault.
async function invoke(command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then(
      value => done({ value }), error => done({ commandError: JSON.stringify(error) }),
    )
  }, command, args).then(result => {
    if (result.commandError) throw new Error(result.commandError)
    return result.value
  })
}

async function availablePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

function client(endpoint, token) {
  let id = 0
  let session
  async function rpc(method, params, notification = false) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(session ? { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': '2025-11-25' } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: ++id }), method, params }),
      signal: AbortSignal.timeout(20000),
    })
    session = response.headers.get('mcp-session-id') ?? session
    assert.equal(response.ok, true, `HTTP status ${response.status} for ${method}`)
    const body = await response.text()
    if (notification) return
    const data = response.headers.get('content-type')?.includes('text/event-stream')
      ? body.split('\n').filter(line => line.startsWith('data:') && line.slice(5).trim()).map(line => JSON.parse(line.slice(5))).find(message => message.id === id)
      : JSON.parse(body)
    return data
  }
  return {
    rpc,
    fresh: () => client(endpoint, token),
    initialize: async () => {
      await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'DataPad test', version: '1' } })
      await rpc('notifications/initialized', {}, true)
    },
    call: async (name, args = {}, expectError = false) => {
      const message = await rpc('tools/call', { name, arguments: args })
      const result = message.result
      if (expectError) {
        assert.ok(message.error || result?.isError, `${name} must reject this call: ${JSON.stringify(result?.structuredContent)}`)
        return result?.structuredContent ?? message.error
      }
      assert.equal(message.error, undefined, `${name}: ${JSON.stringify(message.error)}`)
      assert.notEqual(result?.isError, true, `${name}: ${JSON.stringify(result?.structuredContent)}`)
      return result.structuredContent
    },
  }
}

describe('Authenticated MCP saved work', () => {
  let writer, reader, denied, endpoint, serverId, workspaceId, connectionId, environmentId, itemId, tabId
  before(async () => {
    await browser.waitUntil(async () => browser.execute(() => Boolean(window.__TAURI_INTERNALS__)), { timeout: 30000 })
    const payload = await invoke('bootstrap_app')
    const connection = payload.snapshot.connections.find(connection => connection.engine === 'sqlite')
    assert.ok(connection, 'The isolated SQLite fixture must exist')
    connectionId = connection.id
    environmentId = connection.environmentIds[0] ?? ''
    const status = await invoke('get_workspace_switcher_status')
    workspaceId = status.activeWorkspaceId
    const opened = await invoke('create_query_tab', { connectionId })
    tabId = opened.snapshot.ui.activeTabId
    await invoke('update_query_tab', { tabId, queryText: 'select 42 as answer', queryViewMode: 'raw' })
    const saved = await invoke('save_query_tab_to_library', { request: { tabId, name: 'MCP isolated query', environmentId, tags: [] } })
    itemId = saved.snapshot.libraryNodes.find(item => item.name === 'MCP isolated query').id
    assert.equal(saved.snapshot.preferences.workspaceSearch.enabled, false, 'Listing must work without Workspace Search')
    const port = await availablePort()
    const enabled = await invoke('update_datastore_mcp_server_settings', { request: { enabled: true, port, connectionIds: payload.snapshot.connections.map(connection => connection.id), environmentIds: environmentId ? [environmentId] : [], allowNoEnvironment: !environmentId } })
    serverId = enabled.snapshot.preferences.datastoreMcpServer.activeServerId
    async function makeClient(scopes) {
      const issued = await invoke('create_datastore_mcp_server_token', { request: { serverId, label: 'Isolated test', scopes } })
      return client(`http://127.0.0.1:${port}/mcp`, issued.token)
    }
    writer = await makeClient(['library:read', 'library:write', 'query:read', 'query:write', 'tests:run'])
    reader = await makeClient(['library:read', 'query:read', 'tests:run'])
    denied = await makeClient(['query:read'])
    endpoint = `http://127.0.0.1:${port}/mcp`
    await invoke('start_datastore_mcp_server', { request: { serverId } })
    await writer.initialize(); await reader.initialize(); await denied.initialize()
  })
  after(async () => {
    if (serverId) await invoke('stop_datastore_mcp_server', { request: { serverId } })
  })
  async function definition() { return writer.call('datapad_get_saved_query', { workspaceId, itemId }) }
  async function finish(runId) {
    let status
    await browser.waitUntil(async () => {
      status = await writer.call('datapad_get_run', { runId })
      return !status.active
    }, { timeout: 30000 })
    return status
  }
  it('discovers tools and Library items without search and rejects missing scopes', async () => {
    const tools = (await writer.rpc('tools/list', {})).result.tools
    for (const name of ['datapad_list_saved_queries', 'datapad_update_saved_query', 'datapad_run_test_suite', 'datapad_cancel_run']) assert.ok(tools.some(tool => tool.name === name), name)
    const listed = await reader.call('datapad_list_saved_queries')
    assert.equal(listed.workspaceId, workspaceId)
    assert.ok(listed.items.some(item => item.itemId === itemId))
    await denied.call('datapad_list_saved_queries', {}, true)
    await reader.call('datapad_update_saved_query', { workspaceId, itemId, expectedRevision: (await definition()).item.revision, changes: { name: 'Unauthorized' } }, true)
    const unauthorized = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(unauthorized.status, 401)
  })
  it('updates clean tabs, refreshes Library immediately, and rejects stale or dirty updates', async () => {
    const before = await definition()
    const args = { workspaceId, itemId, expectedRevision: before.item.revision, changes: { name: 'MCP renamed query', queryText: 'select 43 as answer' } }
    await writer.call('datapad_update_saved_query', args)
    await browser.waitUntil(async () => (await browser.execute(() => document.body.innerText)).includes('MCP renamed query'), { timeout: 10000 })
    assert.equal((await invoke('bootstrap_app')).snapshot.tabs.find(tab => tab.id === tabId).queryText, 'select 43 as answer')
    assert.equal((await writer.call('datapad_update_saved_query', args, true)).code, 'library-revision-conflict')
    await invoke('update_query_tab', { tabId, queryText: 'select unsaved', queryViewMode: 'raw' })
    assert.equal((await writer.call('datapad_update_saved_query', { ...args, expectedRevision: (await definition()).item.revision }, true)).code, 'library-draft-conflict')
    // Execute the saved revision while the linked editor has a different unsaved draft.
    const plan = await writer.call('datapad_plan_saved_query_run', { workspaceId, itemId, expectedRevision: (await definition()).item.revision, environmentId })
    const run = await writer.call('datapad_run_saved_query', { planId: plan.planId, ...(plan.requiredConfirmationText ? { confirmationText: plan.requiredConfirmationText } : {}) })
    assert.equal((await finish(run.runId)).status, 'completed')
    assert.equal((await invoke('bootstrap_app')).snapshot.tabs.find(tab => tab.id === tabId).queryText, 'select unsaved')
    await writer.call('datapad_run_saved_query', { planId: plan.planId }, true)
    await invoke('close_query_tab', { tabId })
  })
  it('requires query:write for writes and executes only explicitly confirmed plans', async () => {
    await writer.call('datapad_update_saved_query', { workspaceId, itemId, expectedRevision: (await definition()).item.revision, changes: { queryText: 'create table if not exists mcp_isolated_test (id integer primary key)' } })
    const current = await definition()
    assert.equal(current.definition.queryText, 'create table if not exists mcp_isolated_test (id integer primary key)')
    assert.equal(current.definition.queryViewMode, 'raw')
    const args = { workspaceId, itemId, expectedRevision: current.item.revision, environmentId }
    assert.equal((await reader.call('datapad_plan_saved_query_run', args, true)).code, 'mcp-scope-required')
    const plan = await writer.call('datapad_plan_saved_query_run', args)
    assert.equal(plan.mayWrite, true)
    if (plan.requiredConfirmationText) await writer.call('datapad_run_saved_query', { planId: plan.planId }, true)
    const run = await writer.call('datapad_run_saved_query', { planId: plan.planId, ...(plan.requiredConfirmationText ? { confirmationText: plan.requiredConfirmationText } : {}) })
    assert.equal((await finish(run.runId)).status, 'completed')
  })
  it('invalidates plans when a saved revision changes and cancels a running query', async () => {
    await writer.call('datapad_update_saved_query', { workspaceId, itemId, expectedRevision: (await definition()).item.revision, changes: { queryText: 'select 1' } })
    const stale = await writer.call('datapad_plan_saved_query_run', { workspaceId, itemId, expectedRevision: (await definition()).item.revision, environmentId })
    await writer.call('datapad_update_saved_query', { workspaceId, itemId, expectedRevision: (await definition()).item.revision, changes: { queryText: 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n' } })
    assert.equal((await writer.call('datapad_run_saved_query', { planId: stale.planId }, true)).code, 'library-revision-conflict')
    const plan = await writer.call('datapad_plan_saved_query_run', { workspaceId, itemId, expectedRevision: (await definition()).item.revision, environmentId })
    const run = await writer.call('datapad_run_saved_query', { planId: plan.planId })
    await invoke('set_workspace_switcher_enabled', { request: { enabled: true } })
    await assert.rejects(() => invoke('create_workspace', { request: { name: 'Must not switch during execution' } }), /workspace-context-execution-active/)
    await reader.call('datapad_get_run', { runId: run.runId }, true)
    assert.equal((await writer.call('datapad_update_saved_query', { workspaceId, itemId, expectedRevision: (await definition()).item.revision, changes: { name: 'Cannot edit while running' } }, true)).code, 'library-execution-active')
    const canceled = await writer.call('datapad_cancel_run', { runId: run.runId })
    assert.equal(canceled.cancellationRequested, true)
    assert.equal((await finish(run.runId)).status, 'canceled')
  })

  it('rejects a revoked token even when its MCP session was already initialized', async () => {
    const issued = await invoke('create_datastore_mcp_server_token', { request: { serverId, label: 'Revocation test', scopes: ['library:read'] } })
    const temporary = client(endpoint, issued.token)
    await temporary.initialize()
    await temporary.call('datapad_list_saved_queries')
    await invoke('delete_datastore_mcp_server_token', { request: { serverId, tokenId: issued.tokenId } })
    await assert.rejects(() => temporary.call('datapad_list_saved_queries'), /HTTP status 401/)
  })
  it('edits and runs one saved suite case, checking setup and teardown permissions', async () => {
    await invoke('update_datastore_tests_settings', { request: { enabled: true } })
    const opened = await invoke('create_test_suite_tab', { request: { connectionId, environmentId, scopedTarget: { kind: 'database', label: 'main', path: [] } } })
    const suiteTabId = opened.snapshot.ui.activeTabId
    const saved = await invoke('save_query_tab_to_library', { request: { tabId: suiteTabId, name: 'MCP isolated suite', kind: 'test-suite', environmentId, tags: [] } })
    const suiteItemId = saved.snapshot.libraryNodes.find(item => item.name === 'MCP isolated suite').id
    const before = await writer.call('datapad_get_test_suite', { workspaceId, itemId: suiteItemId })
    const step = (id, phase, queryText) => ({ id, label: id, phase, kind: 'query', enabled: true, queryText })
    const suite = { ...before.definition.testSuite, variables: { expected: '43' }, cases: [{
      id: 'case1', name: 'Selected case', enabled: true,
      setup: [step('setup1', 'setup', 'insert into mcp_isolated_test (id) values (43)')],
      execute: [step('query1', 'execute', 'select id from mcp_isolated_test where id = {{expected}}')],
      teardown: [step('cleanup1', 'teardown', 'delete from mcp_isolated_test where id = 43')],
      assertions: [{ id: 'assert1', label: 'One row', kind: 'row-count', sourceStepId: 'query1', expected: 1 }],
    }, { id: 'case2', name: 'Not selected', setup: [], execute: [step('unused', 'execute', 'select missing_column')], teardown: [], assertions: [] }] }
    const updated = await writer.call('datapad_update_test_suite', { workspaceId, itemId: suiteItemId, expectedRevision: before.item.revision, changes: { testSuite: suite } })
    const args = { workspaceId, itemId: suiteItemId, expectedRevision: updated.item.revision, environmentId, caseId: 'case1' }
    assert.equal((await reader.call('datapad_plan_test_suite_run', args, true)).code, 'mcp-scope-required')
    const plan = await writer.call('datapad_plan_test_suite_run', args)
    const run = await writer.call('datapad_run_test_suite', { planId: plan.planId, ...(plan.requiredConfirmationText ? { confirmationText: plan.requiredConfirmationText } : {}) })
    const result = await finish(run.runId)
    assert.equal(result.status, 'passed', JSON.stringify(result.result))
    assert.equal(result.result.cases.length, 1)
    assert.equal((await invoke('bootstrap_app')).snapshot.tabs.some(tab => tab.id.startsWith('mcp-run-')), false)
    const original = await writer.call('datapad_get_test_suite', { workspaceId, itemId: suiteItemId })
    await writer.call('datapad_update_test_suite', { workspaceId, itemId: suiteItemId, expectedRevision: original.item.revision, changes: { testSuite: { ...suite, connectionId: 'wrong' } } }, true)
  })

  if (process.env.DATAPADPLUSPLUS_MCP_FIXTURE_ENGINE) {
    const engine = process.env.DATAPADPLUSPLUS_MCP_FIXTURE_ENGINE
    it(`runs a saved test suite against the isolated ${engine} fixture`, async () => {
      assert.ok(['postgresql', 'mongodb', 'redis', 'valkey', 'dynamodb'].includes(engine))
      const snapshot = (await invoke('bootstrap_app')).snapshot
      const connection = snapshot.connections.find(connection => connection.engine === engine)
      assert.ok(connection, `${engine} fixture profile must be enabled`)
      const target = engine === 'dynamodb'
        ? { kind: 'table', label: 'accounts', path: [] }
        : { kind: 'database', label: engine === 'mongodb' ? 'catalog' : engine === 'postgresql' ? 'datapadplusplus' : '0', path: [] }
      const opened = await invoke('create_test_suite_tab', { request: { connectionId: connection.id, environmentId, scopedTarget: target } })
      const saved = await invoke('save_query_tab_to_library', { request: { tabId: opened.snapshot.ui.activeTabId, name: `MCP ${engine} fixture`, kind: 'test-suite', environmentId, tags: [] } })
      const item = saved.snapshot.libraryNodes.find(item => item.name === `MCP ${engine} fixture`)
      const definition = await reader.call('datapad_get_test_suite', { workspaceId, itemId: item.id })
      const args = { workspaceId, itemId: item.id, expectedRevision: definition.item.revision, environmentId }
      const plan = await reader.call('datapad_plan_test_suite_run', args)
      assert.equal(plan.mayWrite, false)
      const run = await reader.call('datapad_run_test_suite', { planId: plan.planId })
      let status
      await browser.waitUntil(async () => {
        status = await reader.call('datapad_get_run', { runId: run.runId })
        return !status.active
      }, { timeout: 30000 })
      assert.equal(status.status, 'passed', JSON.stringify(status.result))
    })
    if (engine === 'postgresql') {
      it('reports a timed-out saved query without claiming success or rollback', async () => {
        const connection = (await invoke('bootstrap_app')).snapshot.connections.find(connection => connection.engine === engine)
        const opened = await invoke('create_query_tab', { connectionId: connection.id })
        const sleepTabId = opened.snapshot.ui.activeTabId
        await invoke('update_query_tab', { tabId: sleepTabId, queryText: 'select pg_sleep(3)', queryViewMode: 'raw' })
        const saved = await invoke('save_query_tab_to_library', { request: { tabId: sleepTabId, name: 'MCP timeout query', environmentId, tags: [] } })
        const sleepId = saved.snapshot.libraryNodes.find(item => item.name === 'MCP timeout query').id
        await invoke('update_datastore_mcp_server_settings', { request: { enabled: true, serverId, requestTimeoutMs: 1000 } })
        try {
          const definition = await writer.call('datapad_get_saved_query', { workspaceId, itemId: sleepId })
          const plan = await writer.call('datapad_plan_saved_query_run', { workspaceId, itemId: sleepId, expectedRevision: definition.item.revision, environmentId })
          const run = await writer.call('datapad_run_saved_query', { planId: plan.planId })
          const result = await finish(run.runId)
          assert.equal(result.status, 'uncertain')
          assert.equal(result.result.code, 'mcp-run-interrupted')
        } finally {
          await invoke('update_datastore_mcp_server_settings', { request: { enabled: true, serverId, requestTimeoutMs: 0 } })
        }
      })
    }
  }

  it('invalidates old sessions on workspace switching and reloads durable saved edits', async () => {
    const saved = await definition()
    const originalName = saved.item.name
    const switched = await invoke('create_workspace', { request: { name: 'MCP isolated second workspace' } })
    assert.notEqual(switched.workspaceSwitcherStatus.activeWorkspaceId, workspaceId)
    await assert.rejects(() => reader.call('datapad_list_saved_queries'))
    const restored = await invoke('switch_workspace', { request: { workspaceId } })
    const recoveredItem = restored.payload.snapshot.libraryNodes.find(item => item.id === itemId)
    assert.equal(recoveredItem.name, originalName)
    assert.equal(recoveredItem.queryText, saved.definition.queryText)
    await invoke('start_datastore_mcp_server', { request: { serverId } })
    await assert.rejects(() => reader.call('datapad_list_saved_queries'), /HTTP status 4/)
    reader = reader.fresh()
    await reader.initialize()
    assert.ok((await reader.call('datapad_list_saved_queries')).items.some(item => item.itemId === itemId))
  })
})
