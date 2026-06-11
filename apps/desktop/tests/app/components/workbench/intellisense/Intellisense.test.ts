import { describe, expect, it } from 'vitest'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  StructureResponse,
} from '@datapadplusplus/shared-types'
import { buildCompletionCatalog } from '../../../../../src/app/components/workbench/intellisense/catalog'
import {
  ENVIRONMENT_VARIABLE_COMPLETION_PROVIDER,
  completionProvidersForConnection,
  DEFAULT_COMPLETION_PROVIDERS,
} from '../../../../../src/app/components/workbench/intellisense/providers'
import type { EditorCompletionContext } from '../../../../../src/app/components/workbench/intellisense/types'

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
        explorerNode('public.accounts', 'accounts', 'table', [
          'Fixture',
          'public',
        ]),
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
    const context = completionContext(
      sqlServer,
      'select a. from [dbo].[accounts] a',
      {
        objects: [{ name: 'accounts', kind: 'table', schema: 'dbo' }],
        fields: [
          {
            name: 'id',
            objectName: 'accounts',
            schema: 'dbo',
            dataType: 'uniqueidentifier',
          },
          {
            name: 'name',
            objectName: 'accounts',
            schema: 'dbo',
            dataType: 'nvarchar',
          },
        ],
      },
    )
    const provider = completionProvidersForConnection(sqlServer, 'sql')[0]
    const suggestions =
      provider?.buildItems({
        ...context,
        cursorOffset: context.queryText.length,
      }) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'dbo.accounts',
          insertText: '[dbo].[accounts]',
        }),
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
        completionContext(
          connection,
          'select a. from public.accounts a',
          catalog,
        ),
      ) ?? []

    expect(catalog.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'accounts',
          kind: 'table',
          schema: 'public',
        }),
      ]),
    )
    expect(catalog.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'name',
          objectName: 'accounts',
          schema: 'public',
        }),
      ]),
    )
    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'public.accounts',
          insertText: 'public.accounts',
        }),
        expect.objectContaining({ label: 'name', kind: 'field' }),
      ]),
    )
  })

  it('suggests PostgreSQL catalog helpers, routine workflows, and native identifier quoting', () => {
    const connection = connectionProfile('postgresql', 'sql')
    const provider = completionProvidersForConnection(connection, 'sql')[0]
    const suggestions =
      provider?.buildItems(
        completionContext(connection, 'select * from ', {
          objects: [
            { name: 'accounts', kind: 'table', schema: 'public' },
            { name: 'Order Items', kind: 'table', schema: 'Sales' },
            {
              name: 'account_score',
              kind: 'function',
              schema: 'public',
              detail: 'sql / account_id uuid',
            },
            {
              name: 'refresh_accounts',
              kind: 'procedure',
              schema: 'public',
              detail: 'plpgsql / batch_id bigint',
            },
          ],
        }),
      ) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'pg_catalog.pg_stat_activity',
          insertText: 'pg_catalog.pg_stat_activity',
          kind: 'view',
        }),
        expect.objectContaining({
          label: 'Sales.Order Items',
          insertText: '"Sales"."Order Items"',
          kind: 'table',
        }),
        expect.objectContaining({
          label: 'call public.account_score',
          insertText: 'select public.account_score(/* account_id uuid */);',
          kind: 'function',
        }),
        expect.objectContaining({
          label: 'call public.refresh_accounts',
          insertText: 'call public.refresh_accounts(/* batch_id bigint */);',
          kind: 'function',
        }),
        expect.objectContaining({
          label: 'define public.account_score',
          insertText: expect.stringContaining('pg_get_functiondef'),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'explain analyze json',
          insertText: expect.stringContaining(
            'explain (analyze true, buffers true, verbose true, format json)',
          ),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'session wait profile',
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'routine inventory',
          kind: 'snippet',
        }),
      ]),
    )
  })

  it('suggests CockroachDB distributed SQL helpers and crdb_internal diagnostics', () => {
    const connection = connectionProfile('cockroachdb', 'sql')
    const provider = completionProvidersForConnection(connection, 'sql')[0]
    const suggestions =
      provider?.buildItems(
        completionContext(connection, 'select * from ', {
          objects: [
            { name: 'accounts', kind: 'table', schema: 'public' },
            { name: 'Order Items', kind: 'table', schema: 'Sales' },
          ],
        }),
      ) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'crdb_internal.ranges_no_leases',
          insertText: 'crdb_internal.ranges_no_leases',
          kind: 'view',
        }),
        expect.objectContaining({
          label: 'distributed explain',
          insertText: expect.stringContaining('explain (distsql)'),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'contention dashboard',
          insertText: expect.stringContaining('cluster_contention_events'),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'zone configuration review',
          insertText: 'show zone configuration for table public.accounts;',
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'show jobs',
          insertText: 'show jobs',
          kind: 'keyword',
        }),
        expect.objectContaining({
          label: 'Sales.Order Items',
          insertText: '"Sales"."Order Items"',
          kind: 'table',
        }),
      ]),
    )
    expect(suggestions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'pg_catalog.pg_stat_activity' }),
      ]),
    )
  })

  it('suggests MySQL catalog helpers, routine workflows, and backtick-aware aliases', () => {
    const connection = connectionProfile('mysql', 'sql')
    const provider = completionProvidersForConnection(connection, 'sql')[0]
    const suggestions =
      provider?.buildItems(
        completionContext(
          connection,
          'select oi. from `Sales DB`.`Order Items` oi',
          {
            objects: [
              { name: 'orders', kind: 'table', schema: 'commerce' },
              { name: 'Order Items', kind: 'table', schema: 'Sales DB' },
              {
                name: 'compute_discount',
                kind: 'function',
                schema: 'commerce',
                detail: 'sql / account_id int',
              },
              {
                name: 'refresh_order_rollups',
                kind: 'procedure',
                schema: 'commerce',
                detail: 'sql / batch_id bigint',
              },
            ],
            fields: [
              {
                name: 'line total',
                objectName: 'Order Items',
                schema: 'Sales DB',
                dataType: 'decimal',
              },
            ],
          },
        ),
      ) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'performance_schema.events_statements_summary_by_digest',
          insertText: 'performance_schema.events_statements_summary_by_digest',
          kind: 'view',
        }),
        expect.objectContaining({
          label: 'Sales DB.Order Items',
          insertText: '`Sales DB`.`Order Items`',
          kind: 'table',
        }),
        expect.objectContaining({
          label: 'line total',
          insertText: '`line total`',
          kind: 'field',
        }),
        expect.objectContaining({
          label: 'call commerce.compute_discount',
          insertText: 'select commerce.compute_discount(/* account_id int */);',
          kind: 'function',
        }),
        expect.objectContaining({
          label: 'call commerce.refresh_order_rollups',
          insertText: 'call commerce.refresh_order_rollups(/* batch_id bigint */);',
          kind: 'function',
        }),
        expect.objectContaining({
          label: 'define commerce.compute_discount',
          insertText: expect.stringContaining('information_schema.routines'),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'explain format json',
          insertText: expect.stringContaining('explain format=json'),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'optimizer trace',
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'metadata locks',
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'routine inventory',
          kind: 'snippet',
        }),
      ]),
    )
  })

  it('suggests MariaDB profile, role, and status helpers without MySQL optimizer trace snippets', () => {
    const connection = connectionProfile('mariadb', 'sql')
    const provider = completionProvidersForConnection(connection, 'sql')[0]
    const suggestions =
      provider?.buildItems(
        completionContext(connection, 'select * from ', {
          objects: [
            { name: 'orders', kind: 'table', schema: 'commerce' },
            {
              name: 'refresh_order_rollups',
              kind: 'procedure',
              schema: 'commerce',
              detail: 'sql / batch_id bigint',
            },
          ],
        }),
      ) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'commerce.orders',
          insertText: 'commerce.orders',
          kind: 'table',
        }),
        expect.objectContaining({
          label: 'mysql.roles_mapping',
          insertText: 'mysql.roles_mapping',
          kind: 'table',
        }),
        expect.objectContaining({
          label: 'analyze format json',
          insertText: expect.stringContaining('analyze format=json'),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'mariadb status variables',
          insertText: expect.stringContaining("show global status like 'Aria_%'"),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'mariadb roles',
          insertText: expect.stringContaining('mysql.roles_mapping'),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'call commerce.refresh_order_rollups',
          insertText: 'call commerce.refresh_order_rollups(/* batch_id bigint */);',
          kind: 'function',
        }),
      ]),
    )
    expect(suggestions.map((item) => item.label)).not.toContain('optimizer trace')
  })

  it('suggests Oracle plan, dictionary, PL/SQL, and safe identifier helpers', () => {
    const connection = connectionProfile('oracle', 'sql')
    const provider = completionProvidersForConnection(connection, 'sql')[0]
    const suggestions =
      provider?.buildItems(
        completionContext(connection, 'select * from ', {
          objects: [
            { name: 'ACCOUNTS', kind: 'table', schema: 'APP' },
            { name: 'Order Items', kind: 'table', schema: 'APP' },
            {
              name: 'ORDER_LABEL',
              kind: 'function',
              schema: 'APP',
              detail: 'Oracle function / input_order_id number',
            },
            {
              name: 'REFRESH_ORDER_CACHE',
              kind: 'procedure',
              schema: 'APP',
              detail: 'Oracle procedure / account_id number',
            },
            {
              name: 'ORDER_API',
              kind: 'package',
              schema: 'APP',
              detail: 'Oracle package',
            },
          ],
          fields: [
            { name: 'ORDER_ID', objectName: 'ACCOUNTS', schema: 'APP' },
            { name: 'line total', objectName: 'Order Items', schema: 'APP' },
          ],
        }),
      ) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'APP.ACCOUNTS',
          insertText: 'APP.ACCOUNTS',
          kind: 'table',
        }),
        expect.objectContaining({
          label: 'APP.Order Items',
          insertText: 'APP."Order Items"',
          kind: 'table',
        }),
        expect.objectContaining({
          label: 'line total',
          insertText: '"line total"',
          kind: 'field',
        }),
        expect.objectContaining({
          label: 'select APP.ORDER_LABEL',
          insertText: 'select APP.ORDER_LABEL(/* parameters */) from dual;',
          kind: 'function',
        }),
        expect.objectContaining({
          label: 'execute APP.REFRESH_ORDER_CACHE',
          insertText: expect.stringContaining('APP.REFRESH_ORDER_CACHE(/* parameters */);'),
          kind: 'function',
        }),
        expect.objectContaining({
          label: 'package APP.ORDER_API',
          insertText: expect.stringContaining('all_source'),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'dbms_xplan display',
          insertText: expect.stringContaining('dbms_xplan.display'),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'sql monitor',
          insertText: expect.stringContaining('v$sql_monitor'),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'compile errors',
          insertText: expect.stringContaining('user_errors'),
          kind: 'snippet',
        }),
        expect.objectContaining({
          label: 'fetch first',
          kind: 'keyword',
        }),
        expect.objectContaining({
          label: 'nvl',
          kind: 'function',
        }),
      ]),
    )
  })

  it('suggests MongoDB collections, JSON keys, operators, and document field paths', () => {
    const connection = connectionProfile('mongodb', 'document')
    const provider = completionProvidersForConnection(connection, 'json')[0]
    const suggestions =
      provider?.buildItems(
        completionContext(connection, '{ "filter": {  } }', {
          objects: [{ name: 'products', kind: 'collection' }],
          fields: [
            { name: 'sku', path: 'sku', dataType: 'string' },
            {
              name: 'available',
              path: 'inventory.available',
              dataType: 'number',
            },
          ],
        }),
      ) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'collection',
          insertText: '"collection": ',
        }),
        expect.objectContaining({ label: '$gt', insertText: '"$gt": ' }),
        expect.objectContaining({
          label: 'products',
          insertText: '"products"',
        }),
        expect.objectContaining({
          label: 'inventory.available',
          insertText: '"inventory.available": ',
        }),
      ]),
    )
  })

  it('suggests MongoDB aggregation stages, expressions, and field references inside pipelines', () => {
    const connection = connectionProfile('mongodb', 'document')
    const provider = completionProvidersForConnection(connection, 'json')[0]
    const context = completionContext(
      connection,
      '{ "collection": "products", "pipeline": [ {  } ] }',
      {
        objects: [{ name: 'products', kind: 'collection' }],
        fields: [
          { name: 'status', path: 'status', dataType: 'string' },
          {
            name: 'available',
            path: 'inventory.available',
            dataType: 'number',
          },
        ],
      },
    )
    const suggestions =
      provider?.buildItems({
        ...context,
        cursorOffset: '{ "collection": "products", "pipeline": [ {  '.length,
      }) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '$match',
          insertText: '{ "$match": { } }',
        }),
        expect.objectContaining({ label: '$lookup', kind: 'operator' }),
        expect.objectContaining({ label: '$sum', insertText: '"$sum": ' }),
        expect.objectContaining({
          label: '$inventory.available',
          insertText: '"$inventory.available"',
        }),
        expect.objectContaining({
          label: 'aggregation group count',
          kind: 'snippet',
        }),
      ]),
    )
  })

  it('suggests Redis commands, known keys, and namespace prefixes', () => {
    const connection = connectionProfile('redis', 'keyvalue')
    const provider = completionProvidersForConnection(
      connection,
      'plaintext',
    )[0]
    const suggestions =
      provider?.buildItems(
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
    expect(suggestions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'SET' }),
        expect.objectContaining({ label: 'DEL' }),
      ]),
    )
  })

  it('suggests Redis command arguments from syntax and command metadata', () => {
    const connection = connectionProfile('redis', 'keyvalue')
    const provider = completionProvidersForConnection(
      connection,
      'plaintext',
    )[0]
    const catalog = {
      objects: [
        { name: 'session:0001', kind: 'hash', detail: 'hash / 4 field(s)' },
        { name: 'orders:recent', kind: 'list', detail: 'list / 20 item(s)' },
      ],
      commands: [
        { name: 'LATENCY', detail: 'Live COMMAND metadata' },
        {
          name: 'CUSTOM.READ',
          detail: 'arity -2 / readonly / @read',
          syntax: 'CUSTOM.READ <arg> [arg ...]',
          firstKeyPosition: 1,
          lastKeyPosition: 1,
          keyStep: 1,
          readOnly: true,
        },
        {
          name: 'CUSTOM.WRITE',
          detail: 'arity -3 / write / @write',
          readOnly: false,
        },
      ],
    }

    const hgetallSuggestions =
      provider?.buildItems(
        completionContext(connection, 'HGETALL ', catalog),
      ) ?? []
    const scanOptionSuggestions =
      provider?.buildItems(completionContext(connection, 'SCAN 0 ', catalog)) ??
      []
    const scanPatternSuggestions =
      provider?.buildItems(
        completionContext(connection, 'SCAN 0 MATCH ', catalog),
      ) ?? []
    const xinfoSuggestions =
      provider?.buildItems(completionContext(connection, 'XINFO ', catalog)) ??
      []
    const liveKeySuggestions =
      provider?.buildItems(
        completionContext(connection, 'CUSTOM.READ ', catalog),
      ) ?? []

    expect(hgetallSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'session:0001',
          detail: 'hash / 4 field(s)',
        }),
        expect.objectContaining({
          label: 'session:*',
          detail: 'HGETALL key argument',
        }),
        expect.objectContaining({ label: 'LATENCY', detail: 'LATENCY' }),
        expect.objectContaining({
          label: 'CUSTOM.READ',
          detail: 'CUSTOM.READ <arg> [arg ...]',
        }),
      ]),
    )
    expect(hgetallSuggestions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'CUSTOM.WRITE' }),
      ]),
    )
    expect(liveKeySuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'session:0001',
          detail: 'hash / 4 field(s)',
        }),
        expect.objectContaining({
          label: 'orders:recent',
          detail: 'list / 20 item(s)',
        }),
      ]),
    )
    expect(scanOptionSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'MATCH', kind: 'keyword' }),
        expect.objectContaining({ label: 'COUNT', kind: 'keyword' }),
        expect.objectContaining({ label: 'TYPE', kind: 'keyword' }),
      ]),
    )
    expect(scanPatternSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'session:*',
          detail: 'SCAN MATCH pattern',
        }),
        expect.objectContaining({
          label: 'orders:*',
          detail: 'SCAN MATCH pattern',
        }),
      ]),
    )
    expect(xinfoSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'STREAM',
          detail: 'XINFO subcommand',
        }),
        expect.objectContaining({
          label: 'GROUPS',
          detail: 'XINFO subcommand',
        }),
      ]),
    )
  })

  it('ingests Redis COMMAND INFO payloads into the completion catalog', () => {
    const connection = connectionProfile('redis', 'keyvalue')
    const catalog = buildCompletionCatalog({
      connection,
      environment,
      explorerNodes: [],
      resultPayloads: [
        {
          renderer: 'json',
          value: {
            command: 'COMMAND INFO GET CUSTOM.READ CUSTOM.WRITE',
            value: [
              [
                'get',
                2,
                ['readonly', 'fast'],
                1,
                1,
                1,
                ['@read', '@string', '@fast'],
                [],
                [],
                [],
              ],
              ['custom.read', -2, ['readonly'], 1, 1, 1, ['@read'], [], [], []],
              ['custom.write', -3, ['write'], 1, 1, 1, ['@write'], [], [], []],
            ],
          },
        },
      ],
    })

    expect(catalog.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'GET',
          syntax: 'GET <arg1>',
          firstKeyPosition: 1,
          readOnly: true,
        }),
        expect.objectContaining({
          name: 'CUSTOM.READ',
          syntax: 'CUSTOM.READ <arg> [arg ...]',
          firstKeyPosition: 1,
          readOnly: true,
        }),
        expect.objectContaining({
          name: 'CUSTOM.WRITE',
          readOnly: false,
        }),
      ]),
    )
    expect(catalog.sources).toEqual(['results'])
  })

  it('suggests Redis Stack module commands and module-aware targets', () => {
    const connection = connectionProfile('redis', 'keyvalue')
    const provider = completionProvidersForConnection(
      connection,
      'plaintext',
    )[0]
    const catalog = buildCompletionCatalog({
      connection,
      environment,
      explorerNodes: [
        explorerNode('json:profile:1', 'profile:1', 'json', [
          connection.name,
          'DB 0',
          'JSON',
        ]),
        explorerNode('ts:metric:cpu', 'metric:cpu', 'timeseries', [
          connection.name,
          'DB 0',
          'Time Series',
        ]),
        explorerNode('bloom:filters:seen', 'filters:seen', 'bloom', [
          connection.name,
          'DB 0',
          'Bloom',
        ]),
        explorerNode('search:idx:profiles', 'idx:profiles', 'search-index', [
          connection.name,
          'Search Indexes',
        ]),
        explorerNode(
          'vector:embeddings:products',
          'embeddings:products',
          'vectorset',
          [connection.name, 'Vector Indexes'],
        ),
      ],
    })

    const commandSuggestions =
      provider?.buildItems(completionContext(connection, '', catalog)) ?? []
    const jsonSuggestions =
      provider?.buildItems(
        completionContext(connection, 'JSON.GET ', catalog),
      ) ?? []
    const jsonPathSuggestions =
      provider?.buildItems(
        completionContext(connection, 'JSON.GET profile:1 ', catalog),
      ) ?? []
    const tsFilterSuggestions =
      provider?.buildItems(
        completionContext(connection, 'TS.MRANGE - + FILTER ', catalog),
      ) ?? []
    const searchIndexSuggestions =
      provider?.buildItems(
        completionContext(connection, 'FT.SEARCH ', catalog),
      ) ?? []
    const searchQuerySuggestions =
      provider?.buildItems(
        completionContext(connection, 'FT.SEARCH idx:profiles ', catalog),
      ) ?? []
    const vectorModeSuggestions =
      provider?.buildItems(
        completionContext(connection, 'VSIM embeddings:products ', catalog),
      ) ?? []

    expect(catalog.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'profile:1', kind: 'json' }),
        expect.objectContaining({ name: 'idx:profiles', kind: 'search-index' }),
        expect.objectContaining({
          name: 'embeddings:products',
          kind: 'vectorset',
        }),
      ]),
    )
    expect(commandSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'JSON.OBJLEN',
          detail: 'JSON.OBJLEN key [path]',
        }),
        expect.objectContaining({
          label: 'TS.MRANGE',
          detail: 'TS.MRANGE fromTimestamp toTimestamp FILTER filterExpr...',
        }),
        expect.objectContaining({
          label: 'FT.PROFILE',
          detail: 'FT.PROFILE index SEARCH|AGGREGATE QUERY query [LIMITED]',
        }),
        expect.objectContaining({
          label: 'VSIM',
          detail: 'VSIM key ELE|FP32|VALUES query [options]',
        }),
      ]),
    )
    expect(jsonSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'profile:1',
          detail: 'JSON.GET JSON key',
        }),
      ]),
    )
    expect(jsonPathSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '$', detail: 'RedisJSON path' }),
        expect.objectContaining({
          label: '$.<field>',
          detail: 'RedisJSON path',
        }),
      ]),
    )
    expect(tsFilterSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'metric=<value>',
          detail: 'TimeSeries label filter',
        }),
      ]),
    )
    expect(searchIndexSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'idx:profiles',
          detail: 'FT.SEARCH RediSearch index',
        }),
      ]),
    )
    expect(searchQuerySuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '*', detail: 'RediSearch query' }),
        expect.objectContaining({
          label: '@field:{value}',
          detail: 'RediSearch query',
        }),
      ]),
    )
    expect(vectorModeSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'ELE', detail: 'VSIM input mode' }),
        expect.objectContaining({ label: 'VALUES', detail: 'VSIM input mode' }),
      ]),
    )
  })

  it('hides Redis Stack static hints for Valkey unless live command metadata proves support', () => {
    const connection = connectionProfile('valkey', 'keyvalue')
    const provider = completionProvidersForConnection(
      connection,
      'plaintext',
    )[0]
    const staticSuggestions =
      provider?.buildItems(
        completionContext(connection, '', { objects: [], commands: [] }),
      ) ?? []
    const liveSuggestions =
      provider?.buildItems(
        completionContext(connection, '', {
          commands: [
            {
              name: 'JSON.GET',
              syntax: 'JSON.GET key [path]',
              detail: 'Live RedisJSON command from COMMAND INFO',
              firstKeyPosition: 1,
              lastKeyPosition: 1,
              keyStep: 1,
              readOnly: true,
            },
          ],
        }),
      ) ?? []

    expect(staticSuggestions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'JSON.GET' }),
        expect.objectContaining({ label: 'VSIM' }),
      ]),
    )
    expect(liveSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'JSON.GET',
          detail: 'JSON.GET key [path]',
        }),
      ]),
    )
  })

  it('has native provider coverage for search, DynamoDB, and Cassandra', () => {
    expect(
      completionProvidersForConnection(
        connectionProfile('elasticsearch', 'search'),
        'json',
      ),
    ).toHaveLength(1)
    expect(
      completionProvidersForConnection(
        connectionProfile('dynamodb', 'widecolumn'),
        'json',
      ),
    ).toHaveLength(1)
    expect(
      completionProvidersForConnection(
        connectionProfile('cassandra', 'widecolumn'),
        'sql',
      ),
    ).toHaveLength(1)
    expect(DEFAULT_COMPLETION_PROVIDERS.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(['search', 'dynamodb', 'cassandra']),
    )
  })

  it('suggests DynamoDB PartiQL and consumed-capacity request helpers', () => {
    const connection = connectionProfile('dynamodb', 'widecolumn')
    const provider = completionProvidersForConnection(connection, 'json')[0]
    const suggestions =
      provider?.buildItems(
        {
          ...completionContext(connection, '{\n  ', {
            objects: [
              {
                name: 'Orders',
                kind: 'table',
                detail: 'DynamoDB table',
              },
            ],
            fields: [
              {
                name: 'pk',
                path: 'pk',
                objectName: 'Orders',
                dataType: 'S',
                primary: true,
              },
            ],
          }),
          language: 'json',
        },
      ) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'statement' }),
        expect.objectContaining({ label: 'parameters' }),
        expect.objectContaining({ label: 'nextToken' }),
        expect.objectContaining({ label: 'returnConsumedCapacity' }),
        expect.objectContaining({
          label: 'ExecuteStatement SELECT',
          insertText: expect.stringContaining('"operation": "ExecuteStatement"'),
        }),
        expect.objectContaining({
          label: 'Query with consumed capacity',
          insertText: expect.stringContaining('"returnConsumedCapacity": "TOTAL"'),
        }),
      ]),
    )
  })

  it('has deterministic provider coverage for Wave 4 and Wave 5 secondary engines', () => {
    const providerCases = [
      ['cosmosdb', 'document', 'sql', 'document-secondary'],
      ['litedb', 'document', 'json', 'document-secondary'],
      ['memcached', 'keyvalue', 'plaintext', 'memcached'],
      ['prometheus', 'timeseries', 'plaintext', 'timeseries'],
      ['influxdb', 'timeseries', 'plaintext', 'timeseries'],
      ['opentsdb', 'timeseries', 'plaintext', 'timeseries'],
      ['neo4j', 'graph', 'plaintext', 'graph'],
      ['arango', 'graph', 'plaintext', 'graph'],
      ['janusgraph', 'graph', 'plaintext', 'graph'],
      ['neptune', 'graph', 'plaintext', 'graph'],
    ] as const

    for (const [engine, family, language, providerId] of providerCases) {
      expect(
        completionProvidersForConnection(
          connectionProfile(engine, family),
          language,
        ).map((provider) => provider.id),
        engine,
      ).toContain(providerId)
    }
  })

  it('suggests Cosmos SQL containers and LiteDB document query fields', () => {
    const cosmos = connectionProfile('cosmosdb', 'document')
    const cosmosProvider = completionProvidersForConnection(cosmos, 'sql')[0]
    const cosmosSuggestions =
      cosmosProvider?.buildItems({
        ...completionContext(cosmos, 'SELECT * FROM ', {
          schemas: [{ name: 'commerce' }],
          objects: [{ name: 'orders', kind: 'container', schema: 'commerce' }],
          fields: [{ name: 'status', path: 'status', objectName: 'orders' }],
        }),
        language: 'sql',
      }) ?? []

    expect(cosmosSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'select', kind: 'keyword' }),
        expect.objectContaining({ label: 'commerce.orders', kind: 'table' }),
        expect.objectContaining({
          label: 'partition key filter',
          kind: 'snippet',
        }),
      ]),
    )

    const litedb = connectionProfile('litedb', 'document')
    const liteProvider = completionProvidersForConnection(litedb, 'json')[0]
    const liteSuggestions =
      liteProvider?.buildItems(
        completionContext(litedb, '{ ', {
          objects: [{ name: 'products', kind: 'collection' }],
          fields: [
            {
              name: 'available',
              path: 'inventory.available',
              dataType: 'number',
            },
          ],
        }),
      ) ?? []

    expect(liteSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'operation',
          insertText: '"operation": ',
        }),
        expect.objectContaining({
          label: 'products',
          insertText: '"products"',
        }),
        expect.objectContaining({
          label: 'inventory.available',
          insertText: '"inventory.available": ',
        }),
      ]),
    )
  })

  it('suggests Memcached commands and known-key targets', () => {
    const connection = connectionProfile('memcached', 'keyvalue')
    const provider = completionProvidersForConnection(
      connection,
      'plaintext',
    )[0]
    const suggestions =
      provider?.buildItems({
        ...completionContext(connection, 'get ', {
          objects: [
            { name: 'session:0001', kind: 'known-key' },
            { name: 'Class 1', kind: 'slab' },
          ],
        }),
        language: 'plaintext',
      }) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'get', kind: 'command' }),
        expect.objectContaining({ label: 'stats slabs', kind: 'command' }),
        expect.objectContaining({ label: 'session:0001', kind: 'value' }),
        expect.objectContaining({ label: 'safe set preview', kind: 'snippet' }),
      ]),
    )
  })

  it('suggests time-series metrics, dimensions, and bounded snippets', () => {
    const connection = connectionProfile('prometheus', 'timeseries')
    const provider = completionProvidersForConnection(
      connection,
      'plaintext',
    )[0]
    const suggestions =
      provider?.buildItems({
        ...completionContext(connection, 'rate(', {
          objects: [
            { name: 'http_requests_total', kind: 'metric' },
            { name: 'job', kind: 'label' },
          ],
        }),
        language: 'plaintext',
      }) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'rate', kind: 'keyword' }),
        expect.objectContaining({
          label: 'http_requests_total',
          kind: 'field',
        }),
        expect.objectContaining({ label: 'job', kind: 'field' }),
        expect.objectContaining({
          label: 'rate over 5m',
          insertText: 'rate(http_requests_total[5m])',
        }),
      ]),
    )
  })

  it('suggests graph labels, relationships, properties, and native snippets', () => {
    const connection = connectionProfile('neo4j', 'graph')
    const provider = completionProvidersForConnection(
      connection,
      'plaintext',
    )[0]
    const suggestions =
      provider?.buildItems({
        ...completionContext(connection, 'MATCH (n', {
          objects: [
            { name: 'fraud', kind: 'graph' },
            { name: 'Person', kind: 'node-label' },
            { name: 'PURCHASED', kind: 'relationship' },
            { name: 'email', kind: 'property-key' },
          ],
        }),
        language: 'plaintext',
      }) ?? []

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'match', kind: 'keyword' }),
        expect.objectContaining({ label: 'fraud', kind: 'schema' }),
        expect.objectContaining({ label: 'Person', insertText: ':`Person`' }),
        expect.objectContaining({
          label: 'PURCHASED',
          insertText: ':`PURCHASED`',
        }),
        expect.objectContaining({ label: 'email', kind: 'field' }),
        expect.objectContaining({
          label: 'bounded Cypher match',
          kind: 'snippet',
        }),
      ]),
    )
  })

  it('suggests environment variables only inside brace tokens', () => {
    const connection = connectionProfile('postgresql', 'sql')
    const context = completionContext(connection, 'select * from {{', {
      objects: [],
      fields: [],
    })
    context.environment = {
      ...environment,
      variableDefinitions: [
        {
          key: 'DB_SCHEMA',
          kind: 'text',
          value: 'public',
          updatedAt: '2026-05-17T00:00:00.000Z',
        },
        {
          key: 'API_TOKEN',
          kind: 'secret',
          secretRef: {
            id: 'secret-env-local-api-token',
            provider: 'os-keyring',
            service: 'DataPadPlusPlus.Environment',
            account: 'env-local:API_TOKEN',
            label: 'Environment Local variable API_TOKEN',
          },
          updatedAt: '2026-05-17T00:00:00.000Z',
        },
      ],
    }

    expect(
      ENVIRONMENT_VARIABLE_COMPLETION_PROVIDER.buildItems({
        ...context,
        cursorOffset: context.queryText.length,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'DB_SCHEMA',
          insertText: 'DB_SCHEMA}}',
          kind: 'variable',
          detail: 'environment variable',
        }),
        expect.objectContaining({
          label: 'API_TOKEN',
          insertText: 'API_TOKEN}}',
          kind: 'variable',
          detail: 'secret environment variable',
        }),
      ]),
    )

    expect(
      ENVIRONMENT_VARIABLE_COMPLETION_PROVIDER.buildItems({
        ...context,
        queryText: 'select * from accounts',
        cursorOffset: 'select * from accounts'.length,
      }),
    ).toEqual([])
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
    language:
      connection.family === 'document' || connection.family === 'search'
        ? 'json'
        : 'sql',
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
