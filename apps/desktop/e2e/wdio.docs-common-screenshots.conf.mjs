import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as baseConfig } from './wdio.docs-screenshots.conf.mjs'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const workspaceRoot = process.env.DATAPADPLUSPLUS_WORKSPACE_DIR ?? resolve(repoRoot, 'tests', 'fixtures', '.screenshot-workspace')
const workspacePath = resolve(workspaceRoot, 'workspace.json')

export const config = {
  ...baseConfig,
  specs: [resolve(import.meta.dirname, 'specs', 'docs-common-screenshots.e2e.mjs')],
  onPrepare() {
    const snapshot = JSON.parse(readFileSync(workspacePath, 'utf8'))
    const tab = {
      id: 'tab-documentation-cockroachdb-table-health',
      title: 'table_health — CockroachDB',
      tabKind: 'object-view',
      connectionId: 'fixture-cockroachdb',
      environmentId: 'env-local-demo',
      family: 'sql',
      language: 'json',
      editorLabel: 'Object view',
      queryText: '',
      objectViewState: {
        connectionId: 'fixture-cockroachdb',
        environmentId: 'env-local-demo',
        nodeId: 'documentation-cockroachdb-table-health',
        label: 'table_health',
        kind: 'view',
        path: ['datapadplusplus', 'observability', 'Views', 'table_health'],
        summary: 'Read-only view used to review table health before export.',
        queryTemplate: 'select table_name, rows_estimate, last_vacuum from observability.table_health limit 50;',
        payload: {
          schema: 'observability',
          viewName: 'table_health',
          rowCount: 12,
          columns: [
            { name: 'table_name', type: 'text', nullable: false },
            { name: 'rows_estimate', type: 'bigint', nullable: false },
            { name: 'last_vacuum', type: 'timestamp', nullable: true },
          ],
        },
        warnings: [],
      },
      status: 'idle',
      dirty: false,
      history: [],
    }

    snapshot.tabs = [...snapshot.tabs.filter((item) => !item.id.startsWith('tab-documentation-')), tab]

    const executedAt = '1788353605'
    const resultFor = (engine, summary, defaultRenderer, rendererModes, payloads) => ({
      id: `result-documentation-${engine}`,
      engine,
      summary,
      defaultRenderer,
      rendererModes,
      payloads,
      notices: [],
      executedAt,
      durationMs: 42,
      serverDurationMs: 31,
      displayDurationMs: 11,
      truncated: false,
      rowLimit: 50,
      pageInfo: {
        pageSize: 50,
        pageIndex: 0,
        bufferedRows: 3,
        hasMore: false,
        totalRowsKnown: 3,
      },
    })
    const tabById = (id) => snapshot.tabs.find((item) => item.id === id)
    const postgresTab = tabById('tab-fixture-postgresql')
    if (postgresTab) {
      postgresTab.lastRunAt = executedAt
      postgresTab.result = resultFor(
        'postgresql',
        '3 bounded rows returned.',
        'table',
        ['table', 'schema', 'json'],
        [
          {
            renderer: 'table',
            columns: ['table_name', 'rows_estimate', 'last_vacuum'],
            rows: [
              ['orders', '18420', '2026-08-31 09:24:00Z'],
              ['customers', '6420', '2026-08-31 09:21:00Z'],
              ['order_items', '39210', '2026-08-31 09:18:00Z'],
            ],
          },
          {
            renderer: 'schema',
            items: [
              { label: 'table_name', detail: 'text · not null' },
              { label: 'rows_estimate', detail: 'bigint · not null' },
              { label: 'last_vacuum', detail: 'timestamptz · nullable' },
            ],
          },
          { renderer: 'json', value: { source: 'example', rows: 3 } },
        ],
      )
    }
    const mongoTab = tabById('tab-fixture-mongodb')
    if (mongoTab) {
      const mongoConnection = snapshot.connections.find((item) => item.id === 'fixture-mongodb')
      if (mongoConnection) mongoConnection.readOnly = false
      mongoTab.scopedTarget = {
        kind: 'collection',
        label: 'products',
        path: ['catalog', 'products'],
        scope: 'catalog.products',
        queryTemplate: '{ "collection": "products", "filter": {}, "limit": 50 }',
      }
      mongoTab.builderState = {
        kind: 'mongo-find',
        database: 'catalog',
        collection: 'products',
        filters: [{ id: 'mongo-filter-active', field: 'status', operator: 'eq', value: 'active', valueType: 'string' }],
        projectionMode: 'include',
        projectionFields: [
          { id: 'mongo-project-sku', field: 'sku' },
          { id: 'mongo-project-stock', field: 'inventory.available' },
        ],
        sort: [{ id: 'mongo-sort-stock', field: 'inventory.available', direction: 'desc' }],
        limit: 50,
        lastAppliedQueryText: mongoTab.queryText,
      }
      mongoTab.lastRunAt = executedAt
      mongoTab.result = resultFor(
        'mongodb',
        '2 documents returned from catalog.products.',
        'document',
        ['document', 'json', 'raw'],
        [
          {
            renderer: 'document',
            database: 'catalog',
            collection: 'products',
            hydrationMode: 'full',
            documents: [
              { _id: 'itm-2048', sku: 'luna-lamp', status: 'active', inventory: { reserved: 4, available: 18 }, channels: ['web', 'store'] },
              { _id: 'itm-2049', sku: 'aurora-desk', status: 'active', inventory: { reserved: 1, available: 8 }, channels: ['web'] },
            ],
            editMetadata: {
              adapterStrategy: 'mongodb',
              identity: { field: '_id' },
              protectedPaths: [['_id']],
              maxDocumentBytes: 16777216,
            },
            metadata: { source: 'example' },
          },
          { renderer: 'json', value: { database: 'catalog', collection: 'products', count: 2 } },
          { renderer: 'raw', text: '2 documents returned from catalog.products.' },
        ],
      )
    }
    const redisTab = tabById('tab-fixture-redis')
    if (redisTab) {
      redisTab.scopedTarget = {
        kind: 'key',
        label: 'session:demo-user',
        path: ['0', 'session:demo-user'],
        scope: '0:session:demo-user',
        queryTemplate: 'HGETALL session:demo-user',
      }
      redisTab.builderState = {
        kind: 'redis-key-browser',
        pattern: 'session:*',
        typeFilter: 'hash',
        databaseIndex: 0,
        cursor: '0',
        scanCount: 25,
        pageSize: 25,
        scannedCount: 3,
        selectedKey: 'session:demo-user',
        expandedPrefixes: ['session'],
        visibleColumns: ['key', 'type', 'ttl', 'memory'],
        viewMode: 'tree',
        lastRefreshAt: executedAt,
        lastAppliedQueryText: redisTab.queryText,
      }
      redisTab.lastRunAt = executedAt
      redisTab.result = resultFor(
        'redis',
        'Complete hash value loaded.',
        'keyvalue',
        ['keyvalue', 'raw'],
        [
          {
            renderer: 'keyvalue',
            key: 'session:demo-user',
            databaseIndex: 0,
            redisType: 'hash',
            entries: {
              userId: 'demo-user',
              region: 'emea',
              plan: 'standard',
              lastSeenAt: '2026-09-02T09:30:00Z',
            },
            ttl: '23m 11s',
            ttlSeconds: 1391,
            memoryUsage: '4.8 KB',
            memoryUsageBytes: 4915,
            encoding: 'listpack',
            length: 4,
            value: { userId: 'demo-user', region: 'emea', plan: 'standard' },
            sampleTruncated: false,
            supports: { edit: true, ttl: true, export: true },
            metadata: { source: 'example' },
          },
          { renderer: 'raw', text: 'HGETALL session:demo-user\nTTL session:demo-user' },
        ],
      )
    }
    const searchTab = tabById('tab-fixture-opensearch')
    if (searchTab) {
      searchTab.builderState = {
        kind: 'search-dsl',
        index: 'orders',
        queryMode: 'match',
        field: 'status',
        value: 'open',
        valueType: 'string',
        filters: [{ id: 'search-filter-region', field: 'region', operator: 'term', value: 'emea', valueType: 'string' }],
        sourceFields: [{ id: 'search-source-id', field: 'order_id' }, { id: 'search-source-total', field: 'total' }],
        sort: [{ id: 'search-sort-total', field: 'total', direction: 'desc' }],
        aggregations: [{ id: 'search-agg-status', field: 'status', name: 'orders_by_status', type: 'terms', size: 10 }],
        size: 25,
        lastAppliedQueryText: searchTab.queryText,
      }
      searchTab.lastRunAt = executedAt
      searchTab.result = resultFor(
        'opensearch',
        '2 search hits returned from orders.',
        'searchHits',
        ['searchHits', 'profile', 'metrics', 'json'],
        [
          {
            renderer: 'searchHits',
            total: 2,
            hits: [
              { id: 'order-1042', score: 1.23, source: { order_id: 'ORD-1042', status: 'open', region: 'emea', total: 184.5 } },
              { id: 'order-1041', score: 0.98, source: { order_id: 'ORD-1041', status: 'open', region: 'emea', total: 96.2 } },
            ],
            aggregations: { orders_by_status: { open: 2 } },
          },
          { renderer: 'profile', summary: 'Search execution profile.', stages: [{ name: 'query', durationMs: 7, rows: 2, details: { shards: 1 } }] },
          { renderer: 'metrics', metrics: [{ name: 'hits_total', value: 2 }, { name: 'took_ms', value: 8, unit: 'ms' }] },
          { renderer: 'json', value: { source: 'example', took: 8, hits: 2 } },
        ],
      )
    }
    const dynamoTab = tabById('tab-fixture-dynamodb')
    if (dynamoTab) {
      dynamoTab.builderState = {
        kind: 'dynamodb-key-condition',
        table: 'orders',
        partitionKey: { id: 'dynamo-pk', field: 'account_id', operator: 'eq', value: 'demo-account', valueType: 'string' },
        sortKey: { id: 'dynamo-sk', field: 'created_at', operator: 'gte', value: '2026-08-01T00:00:00+02:00', valueType: 'date' },
        filters: [{ id: 'dynamo-filter-status', field: 'status', operator: 'eq', value: 'open', valueType: 'string' }],
        projectionFields: [{ id: 'dynamo-project-id', field: 'order_id' }, { id: 'dynamo-project-total', field: 'total' }],
        consistentRead: false,
        limit: 25,
        lastAppliedQueryText: dynamoTab.queryText,
      }
    }
    const testTab = {
      id: 'tab-documentation-test-suite',
      title: 'Order data smoke tests',
      tabKind: 'test-suite',
      connectionId: 'fixture-postgresql',
      environmentId: 'env-local-demo',
      family: 'sql',
      language: 'sql',
      editorLabel: 'Datastore tests',
      queryText: '',
      testSuite: {
        id: 'suite-documentation-orders',
        name: 'Order data smoke tests',
        description: 'Read-only smoke tests for an order-data connection.',
        engine: 'postgresql',
        family: 'sql',
        connectionId: 'fixture-postgresql',
        environmentId: 'env-local-demo',
        scopedTarget: { kind: 'table', label: 'orders', path: ['datapadplusplus', 'public', 'orders'], scope: 'public.orders', queryTemplate: 'select * from public.orders limit 5;' },
        inferredLanguage: 'sql',
        variables: { account_status: 'active' },
        cases: [
          {
            id: 'case-orders-readable',
            name: 'Orders are readable',
            enabled: true,
            setup: [],
            execute: [{ id: 'step-orders-read', label: 'Read five recent orders', phase: 'execute', kind: 'query', language: 'sql', queryText: 'select order_id, status from public.orders limit 5;', rowLimit: 5, timeoutMs: 5000 }],
            assertions: [{ id: 'assert-orders-no-error', label: 'Query completes without error', kind: 'no-error', comparison: 'equals', expected: true, sourceStepId: 'step-orders-read' }],
            teardown: [],
          },
          {
            id: 'case-order-count',
            name: 'Active orders remain bounded',
            enabled: true,
            setup: [],
            execute: [{ id: 'step-order-count', label: 'Count active orders', phase: 'execute', kind: 'query', language: 'sql', queryText: "select count(*) from public.orders where status = 'active';", rowLimit: 1, timeoutMs: 5000 }],
            assertions: [{ id: 'assert-order-count', label: 'At least one active order exists', kind: 'row-count', comparison: 'greater-than-or-equal', expected: 1, sourceStepId: 'step-order-count' }],
            teardown: [],
          },
        ],
      },
      testRun: {
        id: 'run-documentation-orders',
        suiteId: 'suite-documentation-orders',
        connectionId: 'fixture-postgresql',
        environmentId: 'env-local-demo',
        status: 'passed',
        startedAt: executedAt,
        finishedAt: executedAt,
        durationMs: 116,
        passed: 2,
        failed: 0,
        blocked: 0,
        warnings: [],
        cases: [],
      },
      activeTestCaseId: 'case-orders-readable',
      status: 'idle',
      dirty: false,
      history: [],
    }
    snapshot.tabs.push(testTab)
    snapshot.ui.activeConnectionId = tab.connectionId
    snapshot.ui.activeEnvironmentId = tab.environmentId
    snapshot.ui.activeTabId = tab.id
    snapshot.ui.sidebarCollapsed = false
    snapshot.ui.rightDrawer = 'none'
    const mainWindow = snapshot.ui.workspaceWindows?.find((item) => item.role === 'main')
    if (mainWindow) {
      mainWindow.tabIds = [...mainWindow.tabIds.filter((id) => !id.startsWith('tab-documentation-')), tab.id, testTab.id]
      mainWindow.activeTabId = tab.id
    }
    writeFileSync(workspacePath, `${JSON.stringify(snapshot, null, 2)}\n`)
  },
}
