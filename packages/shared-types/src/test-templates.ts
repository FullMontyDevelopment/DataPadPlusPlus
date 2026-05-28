import type { DatastoreEngine, DatastoreFamily } from './connection'
import type {
  DatastoreTestAssertionKind,
  DatastoreTestSuiteDefinition,
  DatastoreTestTemplate,
  QueryLanguage,
} from './workspace'

export const DATASTORE_TEST_ASSERTIONS: DatastoreTestAssertionKind[] = [
  'row-count',
  'cell-value',
  'json-path',
  'document-count',
  'key-exists',
  'key-type',
  'key-ttl',
  'search-hit-count',
  'schema-exists',
  'no-error',
  'duration-under',
]

export function datastoreTestTemplatesForEngine(
  engine: DatastoreEngine,
  family: DatastoreFamily,
): DatastoreTestTemplate[] {
  const suite = suiteForEngine(engine, family)

  return suite
    ? [
        {
          id: `${engine}-smoke-suite`,
          label: `${suite.name}`,
          description: `Create a repeatable ${suite.name.toLowerCase()} suite with setup, execution assertions, and teardown.`,
          engine,
          family,
          suite,
        },
      ]
    : []
}

function suiteForEngine(
  engine: DatastoreEngine,
  family: DatastoreFamily,
): DatastoreTestSuiteDefinition | undefined {
  if (isSqlEngine(engine)) {
    return sqlSuiteForEngine(engine, family)
  }

  if (engine === 'mongodb') {
    return suite(engine, family, 'MongoDB document test', 'mongodb', {
      setup: JSON.stringify({
        collection: 'datapad_test_products',
        operation: 'insertOne',
        document: { _id: 'datapad-test-product', sku: 'luna-lamp' },
      }, null, 2),
      execute: JSON.stringify({
        collection: 'datapad_test_products',
        filter: { _id: 'datapad-test-product' },
        limit: 5,
      }, null, 2),
      teardown: JSON.stringify({
        collection: 'datapad_test_products',
        operation: 'deleteOne',
        filter: { _id: 'datapad-test-product' },
      }, null, 2),
      assertion: 'document-count',
      expected: 1,
    })
  }

  if (engine === 'redis' || engine === 'valkey') {
    return suite(engine, family, `${engine === 'valkey' ? 'Valkey' : 'Redis'} key test`, 'redis', {
      setup: 'SET datapad:test:sku luna-lamp EX 300',
      execute: 'GET datapad:test:sku',
      teardown: 'DEL datapad:test:sku',
      assertion: 'key-exists',
      expected: true,
    })
  }

  if (engine === 'elasticsearch' || engine === 'opensearch') {
    return suite(engine, family, `${engine === 'opensearch' ? 'OpenSearch' : 'Elasticsearch'} search test`, 'query-dsl', {
      setup: JSON.stringify({
        index: 'datapad-test-products',
        operation: 'index',
        id: 'luna-lamp',
        document: { sku: 'luna-lamp', category: 'lighting' },
      }, null, 2),
      execute: JSON.stringify({
        index: 'datapad-test-products',
        body: { query: { term: { sku: 'luna-lamp' } }, size: 5 },
      }, null, 2),
      teardown: JSON.stringify({
        index: 'datapad-test-products',
        operation: 'delete',
        id: 'luna-lamp',
      }, null, 2),
      assertion: 'search-hit-count',
      expected: 1,
    })
  }

  if (engine === 'dynamodb') {
    return suite(engine, family, 'DynamoDB item test', 'json', {
      setup: JSON.stringify({
        operation: 'PutItem',
        tableName: 'datapad-test-orders',
        item: { pk: { S: 'ORDER#1' }, sk: { S: 'META' }, total: { N: '42' } },
      }, null, 2),
      execute: JSON.stringify({
        operation: 'Query',
        tableName: 'datapad-test-orders',
        keyConditionExpression: '#pk = :pk',
        expressionAttributeNames: { '#pk': 'pk' },
        expressionAttributeValues: { ':pk': { S: 'ORDER#1' } },
      }, null, 2),
      teardown: JSON.stringify({
        operation: 'DeleteItem',
        tableName: 'datapad-test-orders',
        key: { pk: { S: 'ORDER#1' }, sk: { S: 'META' } },
      }, null, 2),
      assertion: 'row-count',
      expected: 1,
    })
  }

  if (engine === 'cassandra') {
    return suite(engine, family, 'Cassandra partition test', 'cql', {
      setup: "insert into datapad_test.orders (account_id, order_id, total) values ('acct-1', 'order-1', 42);",
      execute: "select * from datapad_test.orders where account_id = 'acct-1' and order_id = 'order-1';",
      teardown: "delete from datapad_test.orders where account_id = 'acct-1' and order_id = 'order-1';",
      assertion: 'row-count',
      expected: 1,
    })
  }

  if (engine === 'cosmosdb' || engine === 'litedb') {
    return suite(engine, family, `${engine === 'cosmosdb' ? 'Cosmos DB' : 'LiteDB'} document test`, 'json', {
      setup: JSON.stringify({
        operation: 'upsert',
        collection: 'datapad_test_products',
        document: { id: 'datapad-test-product', sku: 'luna-lamp' },
      }, null, 2),
      execute: JSON.stringify({
        operation: 'find',
        collection: 'datapad_test_products',
        filter: { id: 'datapad-test-product' },
        limit: 5,
      }, null, 2),
      teardown: JSON.stringify({
        operation: 'delete',
        collection: 'datapad_test_products',
        filter: { id: 'datapad-test-product' },
      }, null, 2),
      assertion: 'document-count',
      expected: 1,
    })
  }

  if (engine === 'memcached') {
    return suite(engine, family, 'Memcached key test', 'text', {
      setup: 'set datapad:test:sku 0 300 9\r\nluna-lamp',
      execute: 'get datapad:test:sku',
      teardown: 'delete datapad:test:sku',
      assertion: 'key-exists',
      expected: true,
    })
  }

  if (isGraphEngine(engine)) {
    return graphSuiteForEngine(engine, family)
  }

  if (isTimeSeriesEngine(engine)) {
    return timeSeriesSuiteForEngine(engine, family)
  }

  if (isWarehouseEngine(engine)) {
    return warehouseSuiteForEngine(engine, family)
  }

  return undefined
}

function sqlSuiteForEngine(
  engine: DatastoreEngine,
  family: DatastoreFamily,
): DatastoreTestSuiteDefinition {
  if (engine === 'oracle') {
    return suite(engine, family, 'Oracle SQL smoke test', 'sql', {
      setup: [
        [
          'begin',
          "  execute immediate 'create global temporary table datapad_test_accounts (id number primary key, name varchar2(100)) on commit preserve rows';",
          'exception',
          '  when others then',
          '    if sqlcode != -955 then raise; end if;',
          'end;',
        ].join('\n'),
        "merge into datapad_test_accounts target using (select 1 id, 'Ada' name from dual) source on (target.id = source.id) when not matched then insert (id, name) values (source.id, source.name)",
      ],
      execute: 'select id, name from datapad_test_accounts where id = 1',
      teardown: 'truncate table datapad_test_accounts',
      assertion: 'row-count',
      expected: 1,
    })
  }

  if (engine === 'sqlserver') {
    return suite(engine, family, 'SQL Server smoke test', 'sql', {
      setup: [
        "if object_id('tempdb..#datapad_test_accounts') is not null drop table #datapad_test_accounts;",
        'create table #datapad_test_accounts (id int not null primary key, name nvarchar(100) not null);',
        "insert into #datapad_test_accounts (id, name) values (1, N'Ada');",
      ],
      execute: 'select id, name from #datapad_test_accounts where id = 1;',
      teardown: "if object_id('tempdb..#datapad_test_accounts') is not null drop table #datapad_test_accounts;",
      assertion: 'row-count',
      expected: 1,
    })
  }

  if (engine === 'mysql' || engine === 'mariadb') {
    return suite(engine, family, `${engine === 'mariadb' ? 'MariaDB' : 'MySQL'} smoke test`, 'sql', {
      setup: [
        'create temporary table if not exists datapad_test_accounts (id int primary key, name varchar(100));',
        "insert into datapad_test_accounts (id, name) values (1, 'Ada') on duplicate key update name = values(name);",
      ],
      execute: 'select id, name from datapad_test_accounts where id = 1;',
      teardown: 'drop temporary table if exists datapad_test_accounts;',
      assertion: 'row-count',
      expected: 1,
    })
  }

  if (engine === 'sqlite') {
    return suite(engine, family, 'SQLite local table test', 'sql', {
      setup: [
        'create temporary table if not exists datapad_test_accounts (id integer primary key, name text);',
        "insert or replace into datapad_test_accounts (id, name) values (1, 'Ada');",
      ],
      execute: 'select id, name from datapad_test_accounts where id = 1;',
      teardown: 'drop table if exists datapad_test_accounts;',
      assertion: 'row-count',
      expected: 1,
    })
  }

  if (engine === 'duckdb') {
    return suite(engine, family, 'DuckDB local table test', 'sql', {
      setup: [
        'create temporary table if not exists datapad_test_accounts (id integer primary key, name text);',
        'delete from datapad_test_accounts where id = 1;',
        "insert into datapad_test_accounts (id, name) values (1, 'Ada');",
      ],
      execute: 'select id, name from datapad_test_accounts where id = 1;',
      teardown: 'drop table if exists datapad_test_accounts;',
      assertion: 'row-count',
      expected: 1,
    })
  }

  if (engine === 'clickhouse') {
    return suite(engine, family, 'ClickHouse query test', 'clickhouse-sql', {
      setup: [
        'drop table if exists datapad_test_accounts;',
        'create temporary table if not exists datapad_test_accounts (id UInt32, name String) engine = Memory;',
        "insert into datapad_test_accounts (id, name) values (1, 'Ada');",
      ],
      execute: 'select id, name from datapad_test_accounts where id = 1;',
      teardown: 'drop table if exists datapad_test_accounts;',
      assertion: 'row-count',
      expected: 1,
    })
  }

  return suite(engine, family, `${engine === 'timescaledb' ? 'TimescaleDB' : 'SQL'} smoke test`, 'sql', {
    setup: [
      'create temporary table if not exists datapad_test_accounts (id int primary key, name text);',
      "insert into datapad_test_accounts (id, name) values (1, 'Ada') on conflict (id) do update set name = excluded.name;",
    ],
    execute: 'select id, name from datapad_test_accounts where id = 1;',
    teardown: 'drop table if exists datapad_test_accounts;',
    assertion: 'row-count',
    expected: 1,
  })
}

function graphSuiteForEngine(
  engine: DatastoreEngine,
  family: DatastoreFamily,
): DatastoreTestSuiteDefinition {
  if (engine === 'neo4j') {
    return suite(engine, family, 'Neo4j graph test', 'cypher', {
      setup: "MERGE (:DatapadTest {id: 'datapad-test-node', name: 'Ada'})",
      execute: "MATCH (n:DatapadTest {id: 'datapad-test-node'}) RETURN n.name AS name",
      teardown: "MATCH (n:DatapadTest {id: 'datapad-test-node'}) DETACH DELETE n",
      assertion: 'row-count',
      expected: 1,
    })
  }

  if (engine === 'arango') {
    return suite(engine, family, 'ArangoDB AQL test', 'aql', {
      setup: 'UPSERT { _key: "datapad-test-node" } INSERT { _key: "datapad-test-node", name: "Ada" } UPDATE { name: "Ada" } IN datapad_test_vertices',
      execute: 'FOR doc IN datapad_test_vertices FILTER doc._key == "datapad-test-node" RETURN doc',
      teardown: 'REMOVE "datapad-test-node" IN datapad_test_vertices OPTIONS { ignoreErrors: true }',
      assertion: 'row-count',
      expected: 1,
    })
  }

  return suite(engine, family, `${engine === 'neptune' ? 'Neptune' : 'JanusGraph'} Gremlin test`, 'gremlin', {
    setup: "g.V().has('datapadTestId', 'datapad-test-node').fold().coalesce(unfold(), addV('DatapadTest').property('datapadTestId', 'datapad-test-node').property('name', 'Ada'))",
    execute: "g.V().has('datapadTestId', 'datapad-test-node').valueMap(true)",
    teardown: "g.V().has('datapadTestId', 'datapad-test-node').drop()",
    assertion: 'row-count',
    expected: 1,
  })
}

function timeSeriesSuiteForEngine(
  engine: DatastoreEngine,
  family: DatastoreFamily,
): DatastoreTestSuiteDefinition {
  if (engine === 'prometheus') {
    return suite(engine, family, 'Prometheus query test', 'promql', {
      setup: [],
      execute: 'up',
      teardown: [],
      assertion: 'no-error',
      expected: true,
    })
  }

  if (engine === 'opentsdb') {
    return suite(engine, family, 'OpenTSDB metric test', 'opentsdb', {
      setup: JSON.stringify({ metric: 'datapad.test.value', timestamp: 'now', value: 1, tags: { source: 'datapad' } }, null, 2),
      execute: JSON.stringify({ start: '1h-ago', queries: [{ metric: 'datapad.test.value', aggregator: 'avg', tags: { source: 'datapad' } }] }, null, 2),
      teardown: JSON.stringify({ operation: 'delete', metric: 'datapad.test.value', tags: { source: 'datapad' } }, null, 2),
      assertion: 'row-count',
      expected: 1,
    })
  }

  return suite(engine, family, 'InfluxDB time-series test', engine === 'influxdb' ? 'flux' : 'sql', {
    setup: 'datapad_test,source=datapad value=1',
    execute: 'from(bucket: "datapad-tests") |> range(start: -1h) |> filter(fn: (r) => r._measurement == "datapad_test") |> limit(n: 1)',
    teardown: 'delete from datapad_test where source = datapad',
    assertion: 'row-count',
    expected: 1,
  })
}

function warehouseSuiteForEngine(
  engine: DatastoreEngine,
  family: DatastoreFamily,
): DatastoreTestSuiteDefinition {
  const language: QueryLanguage = engine === 'bigquery'
    ? 'google-sql'
    : engine === 'snowflake'
      ? 'snowflake-sql'
      : engine === 'clickhouse'
        ? 'clickhouse-sql'
        : 'sql'

  return suite(engine, family, `${engineLabel(engine)} query test`, language, {
    setup: [],
    execute: 'select 1 as datapad_test_value',
    teardown: [],
    assertion: 'row-count',
    expected: 1,
  })
}

function suite(
  engine: DatastoreEngine,
  family: DatastoreFamily,
  name: string,
  language: QueryLanguage,
  definition: {
    setup: string | string[]
    execute: string
    teardown: string | string[]
    assertion: DatastoreTestAssertionKind
    expected: unknown
  },
): DatastoreTestSuiteDefinition {
  const setup = Array.isArray(definition.setup) ? definition.setup : [definition.setup]
  const teardown = Array.isArray(definition.teardown) ? definition.teardown : [definition.teardown]

  return {
    id: `${engine}-smoke-suite`,
    name,
    description: `Repeatable smoke test for ${engine}.`,
    engine,
    family,
    variables: {},
    cases: [
      {
        id: `${engine}-smoke-case`,
        name: 'returns expected fixture data',
        enabled: true,
        timeoutMs: 30000,
        setup: setup.map((queryText, index) => ({
          id: `${engine}-setup-${index + 1}`,
          label: `Setup ${index + 1}`,
          phase: 'setup',
          kind: 'query',
          enabled: true,
          language,
          queryText,
        })),
        execute: [
          {
            id: `${engine}-execute-1`,
            label: 'Execute read',
            phase: 'execute',
            kind: 'query',
            enabled: true,
            language,
            queryText: definition.execute,
          },
        ],
        assertions: [
          {
            id: `${engine}-assert-1`,
            label: 'Expected result',
            kind: definition.assertion,
            enabled: true,
            comparison: 'equals',
            expected: definition.expected,
          },
          {
            id: `${engine}-assert-no-error`,
            label: 'No execution errors',
            kind: 'no-error',
            enabled: true,
            expected: true,
          },
        ],
        teardown: teardown.map((queryText, index) => ({
          id: `${engine}-teardown-${index + 1}`,
          label: `Cleanup ${index + 1}`,
          phase: 'teardown',
          kind: 'query',
          enabled: true,
          language,
          queryText,
        })),
      },
    ],
  }
}

function isSqlEngine(engine: DatastoreEngine) {
  return (
    engine === 'postgresql' ||
    engine === 'timescaledb' ||
    engine === 'cockroachdb' ||
    engine === 'sqlserver' ||
    engine === 'mysql' ||
    engine === 'mariadb' ||
    engine === 'sqlite' ||
    engine === 'oracle' ||
    engine === 'duckdb' ||
    engine === 'clickhouse'
  )
}

function isGraphEngine(engine: DatastoreEngine) {
  return engine === 'neo4j' || engine === 'neptune' || engine === 'arango' || engine === 'janusgraph'
}

function isTimeSeriesEngine(engine: DatastoreEngine) {
  return engine === 'influxdb' || engine === 'prometheus' || engine === 'opentsdb'
}

function isWarehouseEngine(engine: DatastoreEngine) {
  return engine === 'snowflake' || engine === 'bigquery'
}

function engineLabel(engine: DatastoreEngine) {
  return engine
    .replace('bigquery', 'BigQuery')
    .replace('snowflake', 'Snowflake')
    .replace('clickhouse', 'ClickHouse')
}
