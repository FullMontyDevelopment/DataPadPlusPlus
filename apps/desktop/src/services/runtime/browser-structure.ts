import type { ResultPageRequest, ResultPageResponse, StructureRequest, StructureResponse, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { findConnection } from './browser-store'

export function createStructureResponseLocally(
  snapshot: WorkspaceSnapshot,
  request: StructureRequest,
): StructureResponse {
  const connection = findConnection(snapshot, request.connectionId)

  if (!connection) {
    throw new Error('Connection was not found.')
  }

  if (connection.family === 'document') {
    const collections = ['products', 'inventory', 'orders']

    return {
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      engine: connection.engine,
      summary: `Preview structure loaded ${collections.length} collection(s).`,
      groups: [
        {
          id: connection.database || connection.name,
          label: connection.database || connection.name,
          kind: 'database',
        },
      ],
      nodes: collections.map((collection) => ({
        id: collection,
        family: 'document',
        label: collection,
        kind: 'collection',
        groupId: connection.database || connection.name,
        detail: 'Preview collection shape',
        metrics: [
          { label: 'Documents', value: collection === 'products' ? '42' : '12' },
          { label: 'Indexes', value: '2' },
        ],
        fields: [
          { name: '_id', dataType: 'objectId', primary: true },
          { name: 'name', dataType: 'string' },
          { name: 'updatedAt', dataType: 'dateTime' },
        ],
      })),
      edges: [
        {
          id: 'orders-productId-products',
          from: 'orders',
          to: 'products',
          label: 'productId may reference products',
          kind: 'inferred-reference',
          inferred: true,
        },
      ],
      metrics: [{ label: 'Collections', value: String(collections.length) }],
    }
  }

  if (connection.family === 'keyvalue') {
    const database = connection.database || '0'
    const typeSummaries = [
      { id: 'hash', label: 'Hashes', kind: 'hash', count: '39,992', examples: ['perf:session:000143', 'perf:session:000561'] },
      { id: 'zset', label: 'Sorted Sets', kind: 'zset', count: '1', examples: ['products:inventory'] },
      { id: 'string', label: 'Strings', kind: 'string', count: '17', examples: ['account:1'] },
    ]

    return {
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      engine: connection.engine,
      summary: 'Preview structure loaded Redis keyspace overview.',
      groups: [
        { id: `db:${database}`, label: `DB ${database}`, kind: 'database', detail: 'Logical Redis database' },
      ],
      nodes: typeSummaries.map((summary) => ({
        id: `db:${database}:${summary.id}`,
        family: 'keyvalue',
        label: summary.label,
        kind: summary.kind,
        groupId: `db:${database}`,
        detail: 'Bounded keyspace type summary',
        metrics: [
          { label: 'Keys', value: summary.count },
          { label: 'Examples', value: summary.examples.join(', ') },
        ],
        fields: summary.examples.map((example) => ({
          name: example,
          dataType: summary.kind,
          detail: 'Example key from bounded metadata',
        })),
      })),
      edges: [],
      metrics: [
        { label: 'Database', value: `DB ${database}` },
        { label: 'Loaded types', value: String(typeSummaries.length) },
        { label: 'Loaded keys', value: '100' },
      ],
    }
  }

  const schema = connection.engine === 'sqlite' ? 'main' : 'public'
  const tables = [
    {
      id: `${schema}.accounts`,
      label: 'accounts',
      fields: [
        { name: 'id', dataType: 'uuid', primary: true },
        { name: 'name', dataType: 'text', nullable: false },
      ],
    },
    {
      id: `${schema}.transactions`,
      label: 'transactions',
      fields: [
        { name: 'id', dataType: 'uuid', primary: true },
        { name: 'account_id', dataType: 'uuid' },
        { name: 'amount', dataType: 'numeric' },
      ],
    },
  ]

  return {
    connectionId: request.connectionId,
    environmentId: request.environmentId,
    engine: connection.engine,
    summary: `Preview structure loaded ${tables.length} table(s).`,
    groups: [{ id: schema, label: schema, kind: 'schema' }],
    nodes: tables.map((table) => ({
      id: table.id,
      family: 'sql',
      label: table.label,
      kind: 'table',
      groupId: schema,
      detail: table.id,
      metrics: [{ label: 'Columns', value: String(table.fields.length) }],
      fields: table.fields,
    })),
    edges: [
      {
        id: `${schema}.transactions-account_id-${schema}.accounts`,
        from: `${schema}.transactions`,
        to: `${schema}.accounts`,
        label: 'account_id -> id',
        kind: 'foreign-key',
        inferred: false,
      },
    ],
    metrics: [{ label: 'Objects', value: String(tables.length) }],
  }
}



export function fetchResultPageLocally(
  snapshot: WorkspaceSnapshot,
  request: ResultPageRequest,
): ResultPageResponse {
  const connection = findConnection(snapshot, request.connectionId)
  const pageSize = request.pageSize ?? 500
  const pageIndex = request.pageIndex ?? 1
  const offset = pageIndex * pageSize

  if (connection?.family === 'document') {
    const documents = Array.from({ length: Math.min(pageSize, 500) }, (_, index) => ({
      _id: `preview-${offset + index + 1}`,
      name: `Preview document ${offset + index + 1}`,
      page: pageIndex,
    }))

    return {
      tabId: request.tabId,
      payload: { renderer: 'document', documents },
      pageInfo: {
        pageSize,
        pageIndex,
        bufferedRows: documents.length,
        hasMore: pageIndex < 2,
      },
      notices: [],
    }
  }

  const rows = Array.from({ length: Math.min(pageSize, 500) }, (_, index) => [
    String(offset + index + 1),
    `Buffered row ${offset + index + 1}`,
  ])

  return {
    tabId: request.tabId,
    payload: { renderer: 'table', columns: ['id', 'name'], rows },
    pageInfo: {
      pageSize,
      pageIndex,
      bufferedRows: rows.length,
      hasMore: pageIndex < 2,
      nextCursor: connection?.family === 'keyvalue' && pageIndex < 2 ? String(pageIndex + 1) : undefined,
    },
    notices: [],
  }
}
