import { describe, expect, it } from 'vitest'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { createSeedSnapshot } from '../../test/fixtures/seed-workspace'
import {
  createExplorerTabInSnapshot,
  createEnvironmentTabInSnapshot,
  createMetricsTabInSnapshot,
  createObjectViewTabInSnapshot,
  createQueryTabForConnection,
  createScopedQueryTabInSnapshot,
  scopedTargetsMatch,
} from './browser-tabs'
import { createSettingsTabInSnapshot } from './browser-settings-tab'

describe('browser tab runtime', () => {
  it('opens Explorer as one unsaveable tab per connection', () => {
    const snapshot = createSeedSnapshot()
    const opened = createExplorerTabInSnapshot(snapshot, 'conn-catalog')
    const explorerTab = opened.tabs.find((tab) => tab.tabKind === 'explorer')

    expect(explorerTab).toMatchObject({
      connectionId: 'conn-catalog',
      dirty: false,
      editorLabel: 'Explorer',
      queryText: '',
    })
    expect(explorerTab?.saveTarget).toBeUndefined()
    expect(opened.ui.activeTabId).toBe(explorerTab?.id)
    expect(opened.ui.rightDrawer).toBe('none')
    expect(opened.ui.explorerView).toBe('structure')

    const reopened = createExplorerTabInSnapshot(opened, 'conn-catalog')

    expect(reopened.tabs.filter((tab) => tab.tabKind === 'explorer')).toHaveLength(1)
    expect(reopened.ui.activeTabId).toBe(explorerTab?.id)
  })

  it('opens Metrics as one unsaveable tab per connection and environment', () => {
    const snapshot = createSeedSnapshot()
    const opened = createMetricsTabInSnapshot(snapshot, 'conn-catalog', 'env-dev')
    const metricsTab = opened.tabs.find((tab) => tab.tabKind === 'metrics')

    expect(metricsTab).toMatchObject({
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      dirty: false,
      editorLabel: 'Metrics',
      queryText: '',
      metricsState: expect.objectContaining({
        connectionId: 'conn-catalog',
        environmentId: 'env-dev',
      }),
    })
    expect(metricsTab?.saveTarget).toBeUndefined()
    expect(opened.ui.activeTabId).toBe(metricsTab?.id)
    expect(opened.ui.rightDrawer).toBe('none')

    const reopened = createMetricsTabInSnapshot(opened, 'conn-catalog', 'env-dev')

    expect(reopened.tabs.filter((tab) => tab.tabKind === 'metrics')).toHaveLength(1)
    expect(reopened.ui.activeTabId).toBe(metricsTab?.id)
  })

  it('opens Environment as one saveable tab per environment', () => {
    const snapshot = createSeedSnapshot()
    const opened = createEnvironmentTabInSnapshot(snapshot, 'env-dev')
    const environmentTab = opened.tabs.find((tab) => tab.tabKind === 'environment')

    expect(environmentTab).toMatchObject({
      environmentId: 'env-dev',
      dirty: false,
      editorLabel: 'Environment',
      queryText: '',
      title: 'Environment - Dev',
    })
    expect(environmentTab?.saveTarget).toBeUndefined()
    expect(opened.ui.activeTabId).toBe(environmentTab?.id)
    expect(opened.ui.activeEnvironmentId).toBe('env-dev')
    expect(opened.ui.rightDrawer).toBe('none')

    const reopened = createEnvironmentTabInSnapshot(opened, 'env-dev')

    expect(reopened.tabs.filter((tab) => tab.tabKind === 'environment')).toHaveLength(1)
    expect(reopened.ui.activeTabId).toBe(environmentTab?.id)
  })

  it('opens Settings as one closeable unsaveable tab', () => {
    const snapshot = createSeedSnapshot()
    const opened = createSettingsTabInSnapshot(snapshot)
    const settingsTab = opened.tabs.find((tab) => tab.tabKind === 'settings')

    expect(settingsTab).toMatchObject({
      dirty: false,
      editorLabel: 'Settings',
      queryText: '',
      title: 'Settings',
    })
    expect(settingsTab?.saveTarget).toBeUndefined()
    expect(opened.ui.activeTabId).toBe(settingsTab?.id)
    expect(opened.ui.rightDrawer).toBe('none')

    const reopened = createSettingsTabInSnapshot(opened)

    expect(reopened.tabs.filter((tab) => tab.tabKind === 'settings')).toHaveLength(1)
    expect(reopened.ui.activeTabId).toBe(settingsTab?.id)
  })

  it('creates connection-level Mongo queries without invented collections', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')

    expect(connection).toBeDefined()

    const tab = createQueryTabForConnection(
      snapshot,
      { ...connection!, database: undefined },
      true,
    )

    expect(tab.queryText).toContain('"collection": ""')
    expect(tab.queryText).not.toContain('products')
    expect(tab.scriptText).toBe('')
  })

  it('opens object views once per connection, environment, and object node', () => {
    const snapshot = createSeedSnapshot()
    const request = {
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      nodeId: 'schema-preview:catalog:products',
      label: 'Schema Preview',
      kind: 'schema-preview',
      path: ['catalog', 'Collections', 'products'],
    }
    const opened = createObjectViewTabInSnapshot(snapshot, request)
    const objectViewTab = opened.tabs.find((tab) => tab.tabKind === 'object-view')

    expect(objectViewTab).toMatchObject({
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      dirty: false,
      editorLabel: 'Object view',
      queryText: '',
      objectViewState: expect.objectContaining({
        nodeId: 'schema-preview:catalog:products',
        kind: 'schema-preview',
        label: 'Schema Preview',
      }),
    })
    expect(objectViewTab?.saveTarget).toBeUndefined()
    expect(opened.ui.activeTabId).toBe(objectViewTab?.id)
    expect(opened.ui.rightDrawer).toBe('none')

    const reopened = createObjectViewTabInSnapshot(opened, request)

    expect(reopened.tabs.filter((tab) => tab.tabKind === 'object-view')).toHaveLength(1)
    expect(reopened.ui.activeTabId).toBe(objectViewTab?.id)
  })

  it('reuses an already-open scoped object query tab', () => {
    const request = {
      connectionId: 'conn-catalog',
      target: {
        kind: 'collection',
        label: 'products',
        path: ['Catalog Mongo', 'catalog', 'Collections'],
        scope: 'collection:products',
        preferredBuilder: 'mongo-find' as const,
      },
    }
    const snapshot = createSeedSnapshot()
    const opened = createScopedQueryTabInSnapshot(snapshot, request)
    const openedTab = opened.tabs.find(
      (tab) => tab.scopedTarget?.scope === 'collection:products',
    )

    expect(openedTab).toBeDefined()

    const reopened = createScopedQueryTabInSnapshot(opened, request)
    const scopedTabs = reopened.tabs.filter(
      (tab) => tab.scopedTarget?.scope === 'collection:products',
    )

    expect(scopedTabs).toHaveLength(1)
    expect(reopened.ui.activeTabId).toBe(openedTab?.id)
  })

  it('does not turn malformed Mongo scoped targets into collection queries', () => {
    const snapshot = createSeedSnapshot()
    const opened = createScopedQueryTabInSnapshot(snapshot, {
      connectionId: 'conn-catalog',
      target: {
        kind: 'collection',
        label: 'Catalog Mongo',
        path: [],
        preferredBuilder: 'mongo-find',
      },
    })
    const openedTab = opened.tabs.find((tab) => tab.id === opened.ui.activeTabId)

    expect(openedTab).toMatchObject({
      title: expect.stringMatching(/^query\.find\.json/),
      queryText: expect.stringContaining('"collection": ""'),
      builderState: expect.objectContaining({
        kind: 'mongo-find',
        collection: '',
      }),
      scriptText: '',
    })
    expect(openedTab?.queryText).not.toContain('products')
  })

  it('reuses legacy scoped tabs that were opened before scoped target metadata existed', () => {
    const snapshot = createSeedSnapshot()
    const legacyTab = {
      ...snapshot.tabs[0]!,
      id: 'tab-legacy-products',
      title: 'products.find.json',
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      family: 'document' as const,
      language: 'mongodb' as const,
      scopedTarget: undefined,
    }
    snapshot.tabs = [legacyTab]

    const reopened = createScopedQueryTabInSnapshot(snapshot, {
      connectionId: 'conn-catalog',
      target: {
        kind: 'collection',
        label: 'products',
        path: ['Catalog Mongo', 'catalog', 'Collections'],
        scope: 'collection:products',
        preferredBuilder: 'mongo-find',
      },
    })

    expect(reopened.tabs).toHaveLength(1)
    expect(reopened.ui.activeTabId).toBe('tab-legacy-products')
  })

  it('creates Mongo aggregation scoped tabs with the aggregation builder active', () => {
    const snapshot = createSeedSnapshot()
    const opened = createScopedQueryTabInSnapshot(snapshot, {
      connectionId: 'conn-catalog',
      target: {
        kind: 'aggregations',
        label: 'Aggregations',
        path: ['Catalog Mongo', 'catalog', 'Collections', 'products'],
        scope: 'aggregation:catalog:products',
        preferredBuilder: 'mongo-aggregation',
      },
    })
    const aggregationTab = opened.tabs.find(
      (tab) => tab.scopedTarget?.scope === 'aggregation:catalog:products',
    )

    expect(aggregationTab).toMatchObject({
      title: 'products.aggregate.json',
      queryViewMode: 'builder',
      builderState: expect.objectContaining({
        kind: 'mongo-aggregation',
        collection: 'products',
      }),
      scriptText: expect.stringContaining('aggregate'),
    })
    expect(aggregationTab?.queryText).toContain('"operation": "aggregate"')
  })

  it('does not invent a Mongo collection when scoped query target identity is incomplete', () => {
    const snapshot = createSeedSnapshot()
    const opened = createScopedQueryTabInSnapshot(snapshot, {
      connectionId: 'conn-catalog',
      target: {
        kind: 'connection',
        label: 'Catalog Mongo',
        path: ['Catalog Mongo'],
        preferredBuilder: 'mongo-find',
      },
    })
    const tab = opened.tabs.find((item) => item.title === 'query.find.json')

    expect(tab).toMatchObject({
      title: 'query.find.json',
      queryViewMode: 'builder',
      builderState: expect.objectContaining({
        kind: 'mongo-find',
        collection: '',
      }),
    })
    expect(tab?.queryText).toContain('"collection": ""')
    expect(tab?.queryText).not.toContain('"collection": "products"')
  })

  it('creates Redis scoped tabs as key-browser tabs filtered to the selected prefix', () => {
    const snapshot = createSeedSnapshot()
    const opened = createScopedQueryTabInSnapshot(snapshot, {
      connectionId: 'conn-cache',
      target: {
        kind: 'prefix',
        label: 'perf:*',
        path: ['Session Redis', 'Key Prefixes'],
        scope: 'prefix:perf:',
        preferredBuilder: 'redis-key-browser',
        queryTemplate: 'SCAN 0 MATCH perf:* COUNT 50',
      },
    })
    const redisTab = opened.tabs.find((tab) => tab.scopedTarget?.scope === 'prefix:perf:')

    expect(redisTab).toMatchObject({
      connectionId: 'conn-cache',
      title: 'perf:*.redis',
      builderState: expect.objectContaining({
        kind: 'redis-key-browser',
        pattern: 'perf:*',
        typeFilter: 'all',
      }),
      queryText: expect.stringContaining('"mode": "redis-key-browser"'),
    })
    expect(redisTab?.queryText).toContain('"pattern": "perf:*"')
  })

  it('creates Redis database scoped tabs with the selected DB index', () => {
    const snapshot = createSeedSnapshot()
    const opened = createScopedQueryTabInSnapshot(snapshot, {
      connectionId: 'conn-cache',
      target: {
        kind: 'database',
        label: 'DB 1',
        path: ['Session Redis', 'Databases'],
        scope: 'db:1',
        preferredBuilder: 'redis-key-browser',
      },
    })
    const redisTab = opened.tabs.find((tab) => tab.scopedTarget?.scope === 'db:1')

    expect(redisTab).toMatchObject({
      connectionId: 'conn-cache',
      title: 'DB 1.redis',
      builderState: expect.objectContaining({
        kind: 'redis-key-browser',
        pattern: '*',
        databaseIndex: 1,
        typeFilter: 'all',
      }),
      queryText: expect.stringContaining('"database": 1'),
    })
    expect(redisTab?.queryText).toContain('"pattern": "*"')
  })

  it('creates SQL scoped tabs in raw editor mode by default', () => {
    const snapshot = createSeedSnapshot()
    const opened = createScopedQueryTabInSnapshot(snapshot, {
      connectionId: 'conn-analytics',
      target: {
        kind: 'table',
        label: 'accounts',
        path: ['Analytics Postgres', 'public', 'Tables'],
        scope: 'table:public.accounts',
        queryTemplate: 'select * from "public"."accounts" limit 100;',
      },
    })
    const sqlTab = opened.tabs.find((tab) => tab.scopedTarget?.scope === 'table:public.accounts')

    expect(sqlTab).toMatchObject({
      connectionId: 'conn-analytics',
      title: 'accounts.sql',
      queryViewMode: 'raw',
      queryText: 'select * from "public"."accounts" limit 100;',
    })
    expect(sqlTab?.builderState).toBeUndefined()
  })

  it('creates Cassandra scoped tabs with the CQL partition builder active', () => {
    const snapshot = createSeedSnapshot()
    snapshot.connections.push(cassandraConnection())

    const opened = createScopedQueryTabInSnapshot(snapshot, {
      connectionId: 'conn-cassandra',
      target: {
        kind: 'table',
        label: 'orders_by_customer',
        path: ['Keyspaces', 'app', 'Tables'],
        scope: 'table:app.orders_by_customer',
        preferredBuilder: 'cql-partition',
        queryTemplate: 'select * from "app"."orders_by_customer" where customer_id = ? limit 20;',
      },
    })
    const cassandraTab = opened.tabs.find((tab) => tab.scopedTarget?.scope === 'table:app.orders_by_customer')

    expect(cassandraTab).toMatchObject({
      connectionId: 'conn-cassandra',
      queryViewMode: 'builder',
      builderState: expect.objectContaining({
        kind: 'cql-partition',
        keyspace: 'app',
        table: 'orders_by_customer',
      }),
      queryText: expect.stringContaining('customer_id'),
    })
  })

  it('seeds DynamoDB scoped builders from the request template table name', () => {
    const snapshot = createSeedSnapshot()
    snapshot.connections.push(dynamoDbConnection())

    const opened = createScopedQueryTabInSnapshot(snapshot, {
      connectionId: 'conn-dynamodb',
      target: {
        kind: 'items',
        label: 'Items',
        path: ['DynamoDB', 'Tables', 'Orders'],
        scope: 'table:Orders:items',
        preferredBuilder: 'dynamodb-key-condition',
        queryTemplate: '{ "operation": "Query", "tableName": "Orders", "limit": 20 }',
      },
    })
    const dynamoTab = opened.tabs.find((tab) => tab.scopedTarget?.scope === 'table:Orders:items')

    expect(dynamoTab).toMatchObject({
      connectionId: 'conn-dynamodb',
      queryViewMode: 'builder',
      builderState: expect.objectContaining({
        kind: 'dynamodb-key-condition',
        table: 'Orders',
      }),
      queryText: expect.stringContaining('"tableName": "Orders"'),
    })
    expect(dynamoTab?.builderState).not.toMatchObject({ table: 'Items' })
  })

  it('seeds search scoped builders from the request template index', () => {
    const snapshot = createSeedSnapshot()
    snapshot.connections.push(searchConnection())

    const opened = createScopedQueryTabInSnapshot(snapshot, {
      connectionId: 'conn-search',
      target: {
        kind: 'documents',
        label: 'Documents',
        path: ['Search', 'Indexes', 'products-v1'],
        scope: 'index:products-v1:documents',
        preferredBuilder: 'search-dsl',
        queryTemplate: '{ "index": "products-v1", "body": { "query": { "match_all": {} }, "size": 20 } }',
      },
    })
    const searchTab = opened.tabs.find((tab) => tab.scopedTarget?.scope === 'index:products-v1:documents')

    expect(searchTab).toMatchObject({
      connectionId: 'conn-search',
      queryViewMode: 'builder',
      builderState: expect.objectContaining({
        kind: 'search-dsl',
        index: 'products-v1',
      }),
      queryText: expect.stringContaining('"index": "products-v1"'),
    })
    expect(searchTab?.builderState).not.toMatchObject({ index: 'Documents' })
  })

  it('matches scoped targets by object identity instead of generated query text', () => {
    const left = {
      kind: 'collection',
      label: 'products',
      path: ['Catalog Mongo', 'catalog', 'Collections'],
      scope: 'collection:products',
      queryTemplate: '{ "collection": "products" }',
      preferredBuilder: 'mongo-find' as const,
    }
    const right = {
      ...left,
      queryTemplate: '{ "collection": "products", "limit": 10 }',
    }
    const differentScope = {
      ...left,
      scope: 'collection:orders',
    }

    expect(scopedTargetsMatch(left, right)).toBe(true)
    expect(scopedTargetsMatch(left, differentScope)).toBe(false)
  })
})

function cassandraConnection(): ConnectionProfile {
  return {
    id: 'conn-cassandra',
    name: 'Cassandra',
    engine: 'cassandra',
    family: 'widecolumn',
    host: 'localhost',
    port: 9042,
    database: 'app',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'cassandra',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: { username: 'cassandra' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function dynamoDbConnection(): ConnectionProfile {
  return {
    id: 'conn-dynamodb',
    name: 'DynamoDB',
    engine: 'dynamodb',
    family: 'widecolumn',
    host: 'localhost',
    port: 8000,
    database: '',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'dynamodb',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function searchConnection(): ConnectionProfile {
  return {
    id: 'conn-search',
    name: 'Search',
    engine: 'elasticsearch',
    family: 'search',
    host: 'localhost',
    port: 9200,
    database: '',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'elasticsearch',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
