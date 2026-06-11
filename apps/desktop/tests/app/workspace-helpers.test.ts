import { describe, expect, it } from 'vitest'
import type {
  ConnectionProfile,
  CqlPartitionBuilderState,
  DynamoDbKeyConditionBuilderState,
  MongoFindBuilderState,
  QueryTabState,
  ResultPayload,
  SearchDslBuilderState,
  SqlSelectBuilderState,
} from '@datapadplusplus/shared-types'
import { createSeedSnapshot } from '../fixtures/seed-workspace'
import {
  appendFieldToQueryText,
  builderStateForTab,
  deriveCapabilities,
  queryBuilderObjectOptions,
  selectPayload,
} from '../../src/app/workspace-helpers'
import {
  defaultQueryTextForConnection,
  defaultScriptTextForConnection,
} from '../../src/app/state/helpers'

function createTab(
  queryText: string,
  builderState?: MongoFindBuilderState | SqlSelectBuilderState | DynamoDbKeyConditionBuilderState | CqlPartitionBuilderState | SearchDslBuilderState,
): QueryTabState {
  return {
    id: 'tab-test',
    title: 'products.find',
    connectionId: 'conn-catalog',
    environmentId: 'env-dev',
    family: 'document',
    language: 'mongodb',
    editorLabel: 'Document query',
    queryText,
    builderState,
    status: 'idle',
    dirty: false,
    history: [],
  }
}

describe('workspace query helpers', () => {
  it('builds a default Mongo find builder from raw query text', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')
    const tab = createTab('{\n  "collection": "orders",\n  "limit": 37\n}')

    expect(connection).toBeDefined()

    const state = builderStateForTab(tab, connection!, {})

    expect(state).toMatchObject({
      kind: 'mongo-find',
      collection: 'orders',
      limit: 37,
    })
  })

  it('prefers draft builder state over persisted tab state', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')
    const persisted = createBuilderState('products', 20)
    const draft = createBuilderState('inventory', 50)
    const tab = createTab('{}', persisted)

    const state = builderStateForTab(tab, connection!, { [tab.id]: draft })

    expect(state).toBe(draft)
  })

  it('builds a SQL SELECT builder from table-shaped SQL query text', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.engine === 'postgresql')
    const tab = createTab('select account_id, status from public.accounts limit 25;')

    expect(builderStateForTab(tab, connection!, {})).toMatchObject({
      kind: 'sql-select',
      schema: 'public',
      table: 'accounts',
      projectionFields: [
        { field: 'account_id' },
        { field: 'status' },
      ],
      limit: 25,
    })
  })

  it('keeps scratch SQL tabs raw-only until a table target is present', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.engine === 'postgresql')
    const tab = createTab('select 1;')

    expect(builderStateForTab(tab, connection!, {})).toBeUndefined()
  })

  it('builds a DynamoDB key-condition builder from request JSON', () => {
    const connection = dynamoDbConnection()
    const tab = createTab(`{
      "operation": "Query",
      "tableName": "Orders",
      "keyConditionExpression": "#pk = :pk",
      "expressionAttributeNames": { "#pk": "pk" },
      "expressionAttributeValues": { ":pk": { "S": "CUSTOMER#123" } },
      "limit": 25
    }`)

    expect(builderStateForTab(tab, connection, {})).toMatchObject({
      kind: 'dynamodb-key-condition',
      table: 'Orders',
      partitionKey: { field: 'pk', value: 'CUSTOMER#123' },
      limit: 25,
    })
  })

  it('builds a Cassandra CQL partition builder from table-shaped CQL', () => {
    const connection = cassandraConnection()
    const tab = createTab(
      "select event_id, status from app.events_by_customer where customer_id = 'CUSTOMER#123' limit 25;",
    )

    expect(builderStateForTab(tab, connection, {})).toMatchObject({
      kind: 'cql-partition',
      keyspace: 'app',
      table: 'events_by_customer',
      projectionFields: [{ field: 'event_id' }, { field: 'status' }],
      partitionKeys: [{ field: 'customer_id', value: 'CUSTOMER#123' }],
      limit: 25,
    })
  })

  it('builds a Search Query DSL builder from wrapped JSON', () => {
    const tab = createTab(`{
      "index": "products",
      "body": {
        "query": { "term": { "status.keyword": "active" } },
        "size": 25
      }
    }`)

    expect(builderStateForTab(tab, searchConnection(), {})).toMatchObject({
      kind: 'search-dsl',
      index: 'products',
      queryMode: 'term',
      field: 'status.keyword',
      value: 'active',
      size: 25,
    })
  })

  it('derives editor capabilities from adapter manifests', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')

    const capabilities = deriveCapabilities(snapshot, connection!)

    expect(capabilities.editorLanguage).toBe('json')
    expect(capabilities.defaultRowLimit).toBe(100)
    expect(capabilities.supportsLiveMetadata).toBe(true)
  })

  it('dedupes Mongo collection options without inventing collections', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')

    const options = queryBuilderObjectOptions(connection, [
      { kind: 'collection', label: 'orders' },
      { kind: 'collection', label: 'orders' },
      { kind: 'database', label: 'catalog' },
    ])

    expect(options).toEqual(['orders'])
  })

  it('collects SQL table and view options for SQL builders', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.engine === 'postgresql')

    expect(
      queryBuilderObjectOptions(connection, [
        { kind: 'table', label: 'accounts' },
        { kind: 'view', label: 'active_accounts' },
        { kind: 'schema', label: 'public' },
      ]),
    ).toEqual(['accounts', 'active_accounts'])
  })

  it('collects DynamoDB table options without inventing tables', () => {
    expect(
      queryBuilderObjectOptions(dynamoDbConnection(), [
        { kind: 'table', label: 'Orders' },
        { kind: 'index', label: 'GSI1CustomerOrders' },
      ]),
    ).toEqual(['Orders'])
  })

  it('collects Cassandra table options without inventing tables', () => {
    expect(
      queryBuilderObjectOptions(cassandraConnection(), [
        { kind: 'table', label: 'events_by_customer' },
        { kind: 'index', label: 'events_type_idx' },
      ]),
    ).toEqual(['events_by_customer'])
  })

  it('collects search index and data-stream options without inventing indexes', () => {
    expect(
      queryBuilderObjectOptions(searchConnection(), [
        { kind: 'index', label: 'products' },
        { kind: 'data-stream', label: 'logs-app-default' },
      ]),
    ).toEqual(['products', 'logs-app-default'])
  })

  it('keeps connection-level starter queries free of fake datastore object names', () => {
    expect(defaultQueryTextForConnection(mongoConnection())).toContain('"collection": ""')
    expect(defaultScriptTextForConnection(mongoConnection())).toBe('')
    expect(defaultQueryTextForConnection(dynamoDbConnection())).toContain('"tableName": ""')
    expect(defaultQueryTextForConnection(searchConnection())).toContain('"index": ""')
    expect(defaultQueryTextForConnection(cassandraConnection())).toBe('')
  })

  it('selects the requested renderer payload with a safe fallback', () => {
    const tablePayload: ResultPayload = {
      renderer: 'table',
      columns: ['id'],
      rows: [['1']],
    }
    const jsonPayload: ResultPayload = { renderer: 'json', value: { ok: true } }

    expect(selectPayload([tablePayload, jsonPayload], 'json')).toBe(jsonPayload)
    expect(selectPayload([tablePayload, jsonPayload], 'raw')).toBe(tablePayload)
    expect(selectPayload([], 'json')).toBeUndefined()
  })

  it('appends dropped field paths without damaging the current query text', () => {
    expect(appendFieldToQueryText('', 'customer.email')).toBe('customer.email')
    expect(appendFieldToQueryText('select * from accounts;\n', 'customer.email')).toBe(
      'select * from accounts;\ncustomer.email',
    )
    expect(appendFieldToQueryText('select 1;', '   ')).toBe('select 1;')
  })
})

function dynamoDbConnection(): ConnectionProfile {
  return {
    id: 'conn-dynamodb',
    name: 'DynamoDB',
    engine: 'dynamodb',
    family: 'widecolumn',
    host: '127.0.0.1',
    port: 8000,
    database: '',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'dynamodb',
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function mongoConnection(): ConnectionProfile {
  return {
    id: 'conn-mongo',
    name: 'MongoDB',
    engine: 'mongodb',
    family: 'document',
    host: '127.0.0.1',
    port: 27017,
    database: '',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'mongodb',
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function cassandraConnection(): ConnectionProfile {
  return {
    id: 'conn-cassandra',
    name: 'Cassandra',
    engine: 'cassandra',
    family: 'widecolumn',
    host: '127.0.0.1',
    port: 9042,
    database: 'app',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'cassandra',
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
    host: '127.0.0.1',
    port: 9200,
    database: '',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'elasticsearch',
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function createBuilderState(collection: string, limit: number): MongoFindBuilderState {
  return {
    kind: 'mongo-find',
    collection,
    filters: [],
    filterGroups: [{ id: 'group-default', label: 'Default', logic: 'and' }],
    projectionMode: 'all',
    projectionFields: [],
    sort: [],
    skip: 0,
    limit,
    lastAppliedQueryText: '{}',
  }
}
