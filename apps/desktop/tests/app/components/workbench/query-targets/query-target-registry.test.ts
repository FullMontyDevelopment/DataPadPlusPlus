import { DATASTORE_ENGINES } from '@datapadplusplus/shared-types'
import type { ConnectionProfile, ExplorerNode, QueryBuilderState, ScopedQueryTarget } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../../../../fixtures/seed-workspace'
import {
  QUERY_TARGET_REGISTRY,
  queryTargetOptions,
} from '../../../../../src/app/components/workbench/query-targets/query-target-registry'
import {
  buildQueryTargetChangePlan,
  builderStateForQueryTarget,
} from '../../../../../src/app/components/workbench/query-targets/query-target-change'

describe('query target registry', () => {
  it('declares selectable levels or an explicit no-target reason for every engine', () => {
    expect(Object.keys(QUERY_TARGET_REGISTRY).sort()).toEqual([...DATASTORE_ENGINES].sort())
    for (const engine of DATASTORE_ENGINES) {
      const entry = QUERY_TARGET_REGISTRY[engine]
      expect(entry.levels.length > 0 || Boolean(entry.noTargetReason)).toBe(true)
    }
  })

  it('builds discovered MongoDB database and collection choices and retains unavailable targets', () => {
    const snapshot = createSeedSnapshot()
    const connection = required(snapshot.connections.find((item) => item.id === 'conn-catalog'))
    const nodes = [
      explorerNode('database', 'catalog', ['Databases'], 'database:catalog', true),
      explorerNode('collection', 'products', ['catalog', 'Collections'], 'collection:catalog:products'),
      explorerNode('collection', 'orders', ['catalog', 'Collections'], 'collection:catalog:orders'),
    ]
    const target: ScopedQueryTarget = {
      kind: 'collection',
      label: 'missing',
      path: ['catalog', 'Collections'],
      scope: 'collection:catalog:missing',
      preferredBuilder: 'mongo-find',
    }

    const result = queryTargetOptions(connection, nodes, target, undefined)

    expect(result.options[0]?.map((item) => item.value)).toEqual(['catalog'])
    expect(result.options[1]?.map((item) => item.value)).toEqual(['missing', 'orders', 'products'])
    expect(result.options[1]?.[0]).toMatchObject({ unavailable: true })
  })

  it('changes builder targets without losing filters, projection, sort, or limits', () => {
    const snapshot = createSeedSnapshot()
    const connection = required(snapshot.connections.find((item) => item.id === 'conn-catalog'))
    const builder: QueryBuilderState = {
      kind: 'mongo-find',
      database: 'catalog',
      collection: 'products',
      filters: [{ id: 'f1', field: 'status', operator: 'eq', value: 'active', valueType: 'string' }],
      projectionMode: 'include',
      projectionFields: [{ id: 'p1', field: 'sku' }],
      sort: [{ id: 's1', field: 'sku', direction: 'asc' }],
      limit: 75,
    }
    const next = builderStateForQueryTarget(builder, connection, {
      kind: 'collection',
      label: 'orders',
      path: ['archive', 'Collections'],
      scope: 'collection:archive:orders',
      preferredBuilder: 'mongo-find',
    })

    expect(next).toMatchObject({
      kind: 'mongo-find',
      database: 'archive',
      collection: 'orders',
      filters: builder.filters,
      projectionFields: builder.projectionFields,
      sort: builder.sort,
      limit: 75,
    })
  })

  it('updates every non-MongoDB builder target without changing its query controls', () => {
    const snapshot = createSeedSnapshot()
    const base = required(snapshot.connections.find((item) => item.id === 'conn-analytics'))
    const sql: QueryBuilderState = {
      kind: 'sql-select',
      schema: 'dbo',
      table: 'orders',
      projectionFields: [{ id: 'p1', field: 'id' }],
      filters: [{ id: 'f1', field: 'active', operator: 'eq', value: 'true', valueType: 'boolean' }],
      filterLogic: 'and',
      sort: [{ id: 's1', field: 'id', direction: 'desc' }],
      limit: 40,
    }
    const sqlNext = builderStateForQueryTarget(
      sql,
      engineConnection(base, 'sqlserver', 'sql'),
      target('table', 'billing.invoices', ['Orders SQL Server', 'Databases', 'archive', 'Tables'], 'table:archive:billing:invoices'),
    )
    expect(sqlNext).toMatchObject({ schema: 'billing', table: 'invoices', filters: sql.filters, limit: 40 })

    const cql: QueryBuilderState = {
      kind: 'cql-partition',
      keyspace: 'commerce',
      table: 'orders',
      projectionFields: [],
      partitionKeys: [{ id: 'p1', field: 'tenant_id', operator: 'eq', value: '1', valueType: 'number' }],
      clusteringKeys: [],
      filters: [],
      allowFiltering: true,
      limit: 30,
    }
    const cqlNext = builderStateForQueryTarget(
      cql,
      engineConnection(base, 'cassandra', 'widecolumn'),
      target('table', 'events', ['audit', 'Tables'], 'table:audit.events'),
    )
    expect(cqlNext).toMatchObject({ keyspace: 'audit', table: 'events', partitionKeys: cql.partitionKeys, limit: 30 })

    const dynamo: QueryBuilderState = {
      kind: 'dynamodb-key-condition',
      table: 'orders',
      partitionKey: { id: 'p1', field: 'tenant', operator: 'eq', value: 'a', valueType: 'string' },
      filters: [],
      projectionFields: [{ id: 'f1', field: 'status' }],
      limit: 25,
    }
    const dynamoNext = builderStateForQueryTarget(
      dynamo,
      engineConnection(base, 'dynamodb', 'widecolumn'),
      target('global-secondary-index', 'by_status', ['Orders', 'Global Secondary Indexes'], ''),
    )
    expect(dynamoNext).toMatchObject({ table: 'Orders', indexName: 'by_status', projectionFields: dynamo.projectionFields })

    const search: QueryBuilderState = {
      kind: 'search-dsl',
      index: 'orders',
      queryMode: 'match-all',
      field: '',
      value: '',
      valueType: 'string',
      filters: [],
      sourceFields: [{ id: 'f1', field: 'status' }],
      sort: [],
      aggregations: [],
      size: 60,
    }
    const searchNext = builderStateForQueryTarget(
      search,
      engineConnection(base, 'elasticsearch', 'search'),
      target('index', 'audit-events', ['Indexes'], 'index:audit-events'),
    )
    expect(searchNext).toMatchObject({ index: 'audit-events', sourceFields: search.sourceFields, size: 60 })

    const cosmos: QueryBuilderState = {
      kind: 'cosmos-sql',
      database: 'catalog',
      container: 'products',
      projectionFields: [{ id: 'p1', field: 'name' }],
      filters: [{ id: 'f1', field: 'status', operator: 'eq', value: 'active', valueType: 'string' }],
      filterLogic: 'and',
      sort: [{ id: 's1', field: 'name', direction: 'asc' }],
      offset: 20,
      limit: 20,
      partitionKeyEnabled: true,
      partitionKeyValue: 'tenant-1',
      partitionKeyValueType: 'string',
    }
    const cosmosNext = builderStateForQueryTarget(
      cosmos,
      {
        ...engineConnection(base, 'cosmosdb', 'document'),
        cosmosDbOptions: { api: 'nosql', databaseName: 'catalog' },
      },
      target('container', 'orders', ['Cosmos DB', 'Databases', 'archive', 'Containers'], 'cosmos:container:archive:orders'),
    )
    expect(cosmosNext).toMatchObject({
      database: 'archive',
      container: 'orders',
      filters: cosmos.filters,
      projectionFields: cosmos.projectionFields,
      sort: cosmos.sort,
      offset: 20,
      limit: 20,
      partitionKeyValue: 'tenant-1',
    })

    const redis: QueryBuilderState = {
      kind: 'redis-key-browser',
      pattern: 'session:*',
      typeFilter: 'hash',
      databaseIndex: 0,
      cursor: '19',
      scannedCount: 200,
      filters: { ttl: 'expiring' },
    }
    const redisNext = builderStateForQueryTarget(
      redis,
      engineConnection(base, 'redis', 'keyvalue'),
      target('prefix', 'orders:', ['Session Redis', 'DB 4', 'Hashes'], 'prefix:orders:'),
    )
    expect(redisNext).toMatchObject({ databaseIndex: 4, pattern: 'orders:*', typeFilter: 'hash', cursor: '0', filters: redis.filters })
  })

  it('requires confirmation before replacing custom raw and script representations', () => {
    const snapshot = createSeedSnapshot()
    const connection = required(snapshot.connections.find((item) => item.id === 'conn-catalog'))
    const tab = required(snapshot.tabs.find((item) => item.id === 'tab-mongo-catalog'))
    tab.tabKind = 'query'
    tab.scopedTarget = {
      kind: 'collection',
      label: 'products',
      path: ['catalog', 'Collections'],
      scope: 'collection:catalog:products',
      queryTemplate: '{ "collection": "products" }',
      preferredBuilder: 'mongo-find',
    }
    tab.scriptText = 'print("custom")'

    const plan = buildQueryTargetChangePlan({
      connection,
      tab,
      snapshot,
      builderState: undefined,
      currentQueryText: 'db.products.find({ custom: true })',
      currentScriptText: tab.scriptText,
      mode: 'raw',
      target: {
        kind: 'collection',
        label: 'orders',
        path: ['catalog', 'Collections'],
        scope: 'collection:catalog:orders',
        queryTemplate: '{ "collection": "orders" }',
        preferredBuilder: 'mongo-find',
      },
    })

    expect(plan.customRepresentations).toEqual(['query', 'script'])
    expect(plan.request.queryText).toContain('orders')
    expect(plan.request.queryViewMode).toBe('raw')
  })
})

function explorerNode(
  kind: string,
  label: string,
  path: string[],
  scope: string,
  expandable = false,
): ExplorerNode {
  return {
    id: `${kind}:${label}`,
    family: 'document',
    kind,
    label,
    detail: '',
    path,
    scope,
    expandable,
    queryTemplate: kind === 'collection' ? `{ "collection": "${label}" }` : undefined,
  }
}

function required<T>(value: T | undefined): T {
  if (!value) throw new Error('Fixture value was not found.')
  return value
}

function engineConnection(
  connection: ConnectionProfile,
  engine: ConnectionProfile['engine'],
  family: ConnectionProfile['family'],
): ConnectionProfile {
  return { ...connection, engine, family }
}

function target(
  kind: string,
  label: string,
  path: string[],
  scope: string,
): ScopedQueryTarget {
  return { kind, label, path, scope: scope || undefined }
}
