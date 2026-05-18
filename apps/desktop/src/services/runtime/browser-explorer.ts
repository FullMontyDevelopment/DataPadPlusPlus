import type { ConnectionProfile, ExplorerInspectRequest, ExplorerInspectResponse, ExplorerNode, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { findConnection } from './browser-store'

export function createExplorerNodes(
  connection: ConnectionProfile,
  scope?: string,
): ExplorerNode[] {
  const sqlTableListQueryForSchema = (schema: string) =>
    connection.engine === 'sqlite'
      ? `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name;`
      : `select table_name from information_schema.tables where table_schema = '${schema}' order by table_name;`

  if (connection.family === 'document') {
    if (scope?.startsWith('collection:')) {
      const collection = scope.replace('collection:', '')

      return [
        {
          id: `${collection}:indexes`,
          family: 'document',
          label: 'Indexes',
          kind: 'indexes',
          detail: `Index definitions for ${collection}`,
          path: [connection.name, collection],
        },
      ]
    }

    return [
      {
        id: 'collection-products',
        family: 'document',
        label: 'products',
        kind: 'collection',
        detail: 'Documents, validators, and indexes',
        scope: 'collection:products',
        path: [connection.name],
        expandable: true,
        queryTemplate: '{\n  "collection": "products",\n  "filter": {},\n  "limit": 100\n}',
      },
      {
        id: 'collection-inventory',
        family: 'document',
        label: 'inventory',
        kind: 'collection',
        detail: 'Stock movements and reservation documents',
        scope: 'collection:inventory',
        path: [connection.name],
        expandable: true,
        queryTemplate: '{\n  "collection": "inventory",\n  "filter": { "reserved": { "$gt": 0 } },\n  "limit": 100\n}',
      },
    ]
  }

  if (connection.family === 'keyvalue') {
    if (scope?.startsWith('prefix:')) {
      const prefix = scope.replace('prefix:', '')

      return [
        {
          id: `${prefix}:session:9f2d7e1a`,
          family: 'keyvalue',
          label: `${prefix}9f2d7e1a`,
          kind: 'hash',
          detail: 'TTL 23m | 4.8 KB',
          path: [connection.name, prefix],
          queryTemplate: `HGETALL ${prefix}9f2d7e1a`,
        },
        {
          id: `${prefix}:session:7cc1a6f2`,
          family: 'keyvalue',
          label: `${prefix}7cc1a6f2`,
          kind: 'hash',
          detail: 'TTL 8m | 3.1 KB',
          path: [connection.name, prefix],
          queryTemplate: `HGETALL ${prefix}7cc1a6f2`,
        },
      ]
    }

    return [
      {
        id: 'prefix-session',
        family: 'keyvalue',
        label: 'session:*',
        kind: 'prefix',
        detail: 'Read-heavy session hashes',
        scope: 'prefix:session:',
        path: [connection.name],
        expandable: true,
        queryTemplate: 'SCAN 0 MATCH session:* COUNT 50',
      },
      {
        id: 'prefix-cache',
        family: 'keyvalue',
        label: 'cache:*',
        kind: 'prefix',
        detail: 'Transient cache keys',
        scope: 'prefix:cache:',
        path: [connection.name],
        expandable: true,
        queryTemplate: 'SCAN 0 MATCH cache:* COUNT 50',
      },
    ]
  }

  if (scope?.startsWith('schema:')) {
    const schema = scope.replace('schema:', '')

    return [
      {
        id: `${schema}.accounts`,
        family: 'sql',
        label: 'accounts',
        kind: 'table',
        detail: 'Open a query to verify this table exists.',
        scope: `table:${schema}.accounts`,
        path: [connection.name, schema],
        expandable: true,
      },
      {
        id: `${schema}.transactions`,
        family: 'sql',
        label: 'transactions',
        kind: 'table',
        detail: 'Open a query to verify this table exists.',
        scope: `table:${schema}.transactions`,
        path: [connection.name, schema],
        expandable: true,
      },
    ]
  }

  if (scope?.startsWith('table:')) {
    const table = scope.replace('table:', '')

    return [
      {
        id: `${table}:id`,
        family: 'sql',
        label: 'id',
        kind: 'column',
        detail: 'uuid / primary key',
        path: [connection.name, table],
      },
      {
        id: `${table}:updated_at`,
        family: 'sql',
        label: 'updated_at',
        kind: 'column',
        detail: 'timestamp with timezone',
        path: [connection.name, table],
      },
    ]
  }

  if (connection.engine === 'sqlite') {
    return [
      {
        id: 'schema-main',
        family: 'sql',
        label: 'main',
        kind: 'schema',
        detail: 'SQLite object tables and indexes',
        scope: 'schema:main',
        path: [connection.name],
        expandable: true,
        queryTemplate: sqlTableListQueryForSchema('main'),
      },
    ]
  }

  const sqlSchemaNodes: ExplorerNode[] = [
    {
      id: 'schema-public',
      family: 'sql',
      label: 'public',
      kind: 'schema',
      detail: 'Core application objects',
      scope: 'schema:public',
      path: [connection.name],
      expandable: true,
      queryTemplate: sqlTableListQueryForSchema('public'),
    },
    {
      id: 'schema-observability',
      family: 'sql',
      label: 'observability',
      kind: 'schema',
      detail: 'Health and support views',
      scope: 'schema:observability',
      path: [connection.name],
      expandable: true,
      queryTemplate: sqlTableListQueryForSchema('observability'),
    },
  ]

  if (connection.engine === 'sqlserver') {
    sqlSchemaNodes.push({
      id: 'schema-dbo',
      family: 'sql',
      label: 'dbo',
      kind: 'schema',
      detail: 'Default SQL Server schema',
      scope: 'schema:dbo',
      path: [connection.name],
      expandable: true,
      queryTemplate: sqlTableListQueryForSchema('dbo'),
    })
  }

  return [
    ...sqlSchemaNodes,
  ]
}



export function inspectExplorerNodeLocally(
  snapshot: WorkspaceSnapshot,
  request: ExplorerInspectRequest,
): ExplorerInspectResponse {
  const connection = findConnection(snapshot, request.connectionId)

  if (!connection) {
    return {
      nodeId: request.nodeId,
      summary: 'Explorer node is not available in the current workspace.',
    }
  }

  const queryTemplate = request.nodeId.includes('collection')
    ? '{\n  "collection": "products",\n  "filter": {},\n  "limit": 100\n}'
    : request.nodeId.includes('prefix') || request.nodeId.includes('session')
      ? 'SCAN 0 MATCH session:* COUNT 50'
      : 'select 1;'

  return {
    nodeId: request.nodeId,
    summary: `Inspection ready for ${request.nodeId} on ${connection.name}.`,
    queryTemplate,
    payload:
      connection.family === 'document'
        ? {
            collection: request.nodeId,
            fields: ['_id', 'sku', 'status'],
          }
        : connection.family === 'keyvalue'
          ? {
              key: request.nodeId,
              type: 'hash',
              ttl: '23m 11s',
              memoryUsage: '4.8 KB',
              preview: {
                userId: 'a1b2c3',
                region: 'eu-west-1',
              },
            }
          : {
              object: request.nodeId,
              columns: [
                { name: 'id', type: 'uuid' },
                { name: 'updated_at', type: 'timestamp with time zone' },
              ],
            },
  }
}
