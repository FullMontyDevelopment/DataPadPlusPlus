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
    return suite(engine, family, 'SQL smoke test', 'sql', {
      setup: [
        'create temporary table if not exists datapad_test_accounts (id int primary key, name text);',
        "insert into datapad_test_accounts (id, name) values (1, 'Ada') on conflict do nothing;",
      ],
      execute: 'select id, name from datapad_test_accounts where id = 1;',
      teardown: 'drop table if exists datapad_test_accounts;',
      assertion: 'row-count',
      expected: 1,
    })
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

  return undefined
}

function suite(
  engine: DatastoreEngine,
  family: DatastoreFamily,
  name: string,
  language: QueryLanguage,
  definition: {
    setup: string | string[]
    execute: string
    teardown: string
    assertion: DatastoreTestAssertionKind
    expected: unknown
  },
): DatastoreTestSuiteDefinition {
  const setup = Array.isArray(definition.setup) ? definition.setup : [definition.setup]

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
        teardown: [
          {
            id: `${engine}-teardown-1`,
            label: 'Cleanup fixture data',
            phase: 'teardown',
            kind: 'query',
            enabled: true,
            language,
            queryText: definition.teardown,
          },
        ],
      },
    ],
  }
}

function isSqlEngine(engine: DatastoreEngine) {
  return (
    engine === 'postgresql' ||
    engine === 'cockroachdb' ||
    engine === 'sqlserver' ||
    engine === 'mysql' ||
    engine === 'mariadb' ||
    engine === 'sqlite'
  )
}
