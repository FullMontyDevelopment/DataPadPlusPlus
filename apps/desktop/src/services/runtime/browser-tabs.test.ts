import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../../test/fixtures/seed-workspace'
import {
  createExplorerTabInSnapshot,
  createEnvironmentTabInSnapshot,
  createMetricsTabInSnapshot,
  createObjectViewTabInSnapshot,
  createScopedQueryTabInSnapshot,
  scopedTargetsMatch,
} from './browser-tabs'

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
