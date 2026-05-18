import { describe, expect, it } from 'vitest'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  StructureResponse,
} from '@datapadplusplus/shared-types'
import { buildCompletionCatalog } from './catalog'
import {
  completionProvidersForConnection,
  DEFAULT_COMPLETION_PROVIDERS,
} from './providers'
import type { EditorCompletionContext } from './types'

const environment: EnvironmentProfile = {
  id: 'env-local',
  label: 'Local',
  color: '#2dbf9b',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: false,
  safeMode: false,
  exportable: true,
  createdAt: '2026-05-17T00:00:00.000Z',
  updatedAt: '2026-05-17T00:00:00.000Z',
}

describe('query intellisense', () => {
  it('builds a catalog from explorer, structure, and recent result fields', () => {
    const connection = connectionProfile('postgresql', 'sql')
    const catalog = buildCompletionCatalog({
      connection,
      environment,
      explorerNodes: [
        explorerNode('schema-public', 'public', 'schema'),
        explorerNode('public.accounts', 'accounts', 'table', ['Fixture', 'public']),
      ],
      structure: structureResponse(connection, [
        {
          id: 'public.accounts',
          family: 'sql',
          label: 'accounts',
          kind: 'table',
          groupId: 'public',
          fields: [
            { name: 'id', dataType: 'uuid', primary: true },
            { name: 'name', dataType: 'text' },
          ],
        },
      ]),
      resultPayloads: [
        {
          renderer: 'table',
          columns: ['runtime_column'],
          rows: [['value']],
        },
      ],
    })

    expect(catalog.schemas.map((schema) => schema.name)).toContain('public')
    expect(catalog.objects.map((object) => object.name)).toContain('accounts')
    expect(catalog.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['id', 'name', 'runtime_column']),
    )
    expect(catalog.sources).toEqual(['explorer', 'results', 'structure'])
  })

  it('suggests SQL objects, columns, aliases, and SQL Server bracket identifiers', () => {
    const sqlServer = connectionProfile('sqlserver', 'sql')
    const context = completionContext(sqlServer, 'select a. from [dbo].[accounts] a', {
      objects: [{ name: 'accounts', kind: 'table', schema: 'dbo' }],
      fields: [
        { name: 'id', objectName: 'accounts', schema: 'dbo', dataType: 'uniqueidentifier' },
        { name: 'name', objectName: 'accounts', schema: 'dbo', dataType: 'nvarchar' },
      ],
    })
    const provider = completionProvidersForConnection(sqlServer, 'sql')[0]
    const suggestions = provider?.buildItems({
      ...context,
      cursorOffset: context.queryText.length,
    }) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'dbo.accounts', insertText: '[dbo].[accounts]' }),
        expect.objectContaining({ label: 'id', kind: 'field' }),
        expect.objectContaining({ label: 'select', kind: 'keyword' }),
      ]),
    )
  })

  it('maps SQL explorer category paths to real schemas, objects, and columns', () => {
    const connection = connectionProfile('postgresql', 'sql')
    const catalog = buildCompletionCatalog({
      connection,
      environment,
      explorerNodes: [
        explorerNode('schema-public', 'public', 'schema', [connection.name]),
        explorerNode('public.accounts', 'accounts', 'BASE TABLE', [
          connection.name,
          'public',
        ]),
        explorerNode('public.accounts.name', 'name', 'column', [
          connection.name,
          'User Schemas',
          'public',
          'Tables',
          'accounts',
        ]),
      ],
    })
    const provider = completionProvidersForConnection(connection, 'sql')[0]
    const suggestions =
      provider?.buildItems(
        completionContext(connection, 'select a. from public.accounts a', catalog),
      ) ?? []

    expect(catalog.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'accounts', kind: 'table', schema: 'public' }),
      ]),
    )
    expect(catalog.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'name', objectName: 'accounts', schema: 'public' }),
      ]),
    )
    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'public.accounts', insertText: 'public.accounts' }),
        expect.objectContaining({ label: 'name', kind: 'field' }),
      ]),
    )
  })

  it('suggests MongoDB collections, JSON keys, operators, and document field paths', () => {
    const connection = connectionProfile('mongodb', 'document')
    const provider = completionProvidersForConnection(connection, 'json')[0]
    const suggestions = provider?.buildItems(
      completionContext(connection, '{ "filter": {  } }', {
        objects: [{ name: 'products', kind: 'collection' }],
        fields: [
          { name: 'sku', path: 'sku', dataType: 'string' },
          { name: 'available', path: 'inventory.available', dataType: 'number' },
        ],
      }),
    ) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'collection', insertText: '"collection": ' }),
        expect.objectContaining({ label: '$gt', insertText: '"$gt": ' }),
        expect.objectContaining({ label: 'products', insertText: '"products"' }),
        expect.objectContaining({
          label: 'inventory.available',
          insertText: '"inventory.available": ',
        }),
      ]),
    )
  })

  it('suggests Redis commands, sampled keys, and prefixes', () => {
    const connection = connectionProfile('redis', 'keyvalue')
    const provider = completionProvidersForConnection(connection, 'plaintext')[0]
    const suggestions = provider?.buildItems(
      completionContext(connection, 'HGETALL ', {
        objects: [
          { name: 'session:0001', kind: 'hash' },
          { name: 'cache:products', kind: 'string' },
        ],
      }),
    ) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'HGETALL', kind: 'command' }),
        expect.objectContaining({ label: 'session:0001', kind: 'value' }),
        expect.objectContaining({ label: 'session:*', kind: 'value' }),
      ]),
    )
  })

  it('has native provider coverage for search, DynamoDB, and Cassandra', () => {
    expect(
      completionProvidersForConnection(connectionProfile('elasticsearch', 'search'), 'json'),
    ).toHaveLength(1)
    expect(
      completionProvidersForConnection(connectionProfile('dynamodb', 'widecolumn'), 'json'),
    ).toHaveLength(1)
    expect(
      completionProvidersForConnection(connectionProfile('cassandra', 'widecolumn'), 'sql'),
    ).toHaveLength(1)
    expect(DEFAULT_COMPLETION_PROVIDERS.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(['search', 'dynamodb', 'cassandra']),
    )
  })
})

function completionContext(
  connection: ConnectionProfile,
  queryText: string,
  overrides: Partial<EditorCompletionContext['catalog']>,
): EditorCompletionContext {
  return {
    connection,
    environment,
    language: connection.family === 'document' || connection.family === 'search' ? 'json' : 'sql',
    queryText,
    catalog: {
      connectionId: connection.id,
      environmentId: environment.id,
      engine: connection.engine,
      family: connection.family,
      schemas: [],
      objects: [],
      fields: [],
      commands: [],
      operators: [],
      functions: [],
      snippets: [],
      loadedAt: '2026-05-17T00:00:00.000Z',
      stale: false,
      sources: ['test'],
      ...overrides,
    },
  }
}

function connectionProfile(
  engine: ConnectionProfile['engine'],
  family: ConnectionProfile['family'],
): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine,
    engine,
    family,
    host: 'localhost',
    environmentIds: [environment.id],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: '',
    auth: {},
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
  }
}

function explorerNode(
  id: string,
  label: string,
  kind: string,
  path: string[] = ['Fixture'],
): ExplorerNode {
  return {
    id,
    family: kind === 'collection' ? 'document' : 'sql',
    label,
    kind,
    detail: '',
    path,
  }
}

function structureResponse(
  connection: ConnectionProfile,
  nodes: StructureResponse['nodes'],
): StructureResponse {
  return {
    connectionId: connection.id,
    environmentId: environment.id,
    engine: connection.engine,
    summary: 'Loaded test structure.',
    groups: [{ id: 'public', label: 'public', kind: 'schema' }],
    nodes,
    edges: [],
    metrics: [],
  }
}
