import { describe, expect, it } from 'vitest'
import {
  validateCreateLibraryFolderRequest,
  validateCreateObjectViewTabRequest,
  validateConnectionProfile,
  validateConnectionTestRequest,
  validateDataEditPlanRequest,
  validateEnvironmentProfile,
  validateExecutionRequest,
  validateExplorerRequest,
  validateOperationExecutionRequest,
  validateOperationPlanRequest,
  validateRedisKeyScanRequest,
  validateResultPageRequest,
  validateSaveQueryTabToLibraryRequest,
  validateSaveQueryTabToLocalFileRequest,
  validateSetLibraryNodeEnvironmentRequest,
  validateUpdateQueryBuilderStateRequest,
} from './request-validation'

describe('runtime request validation', () => {
  it('clamps metadata and Redis scan limits before command execution', () => {
    expect(
      validateExplorerRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        limit: 999_999,
      }).limit,
    ).toBe(500)
    expect(
      validateRedisKeyScanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        databaseIndex: 999_999,
        count: 999_999,
        pageSize: 999_999,
      }),
    ).toMatchObject({
      databaseIndex: 1024,
      count: 1000,
      pageSize: 1000,
    })
  })

  it('rejects invalid IDs, operation IDs, and control characters', () => {
    expect(() =>
      validateExplorerRequest({
        connectionId: '',
        environmentId: 'env-1',
      }),
    ).toThrow(/Connection id is required/)
    expect(() =>
      validateOperationPlanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        operationId: '../drop',
      }),
    ).toThrow(/Operation id contains unsupported characters/)
    expect(() =>
      validateRedisKeyScanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        pattern: 'orders\u0000*',
      }),
    ).toThrow(/control characters/)
  })

  it('validates object-view requests without allowing arbitrary node identifiers', () => {
    expect(
      validateCreateObjectViewTabRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        nodeId: 'mongodb:catalog:users',
        label: 'Users',
        kind: 'mongo-users',
        path: ['catalog', 'Users'],
      }),
    ).toMatchObject({
      nodeId: 'mongodb:catalog:users',
      kind: 'mongo-users',
    })
    expect(() =>
      validateCreateObjectViewTabRequest({
        connectionId: 'conn-1',
        nodeId: '../catalog',
        label: 'Users',
        kind: 'mongo-users',
      }),
    ).toThrow(/Object view node id contains unsupported characters/)
  })

  it('rejects oversized command payloads and too many edit changes', () => {
    expect(() =>
      validateOperationPlanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        operationId: 'mongodb.index.create',
        parameters: { payload: 'x'.repeat(70 * 1024) },
      }),
    ).toThrow(/too large/)
    expect(() =>
      validateDataEditPlanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        editKind: 'set-field',
        target: {
          objectKind: 'document',
          path: ['catalog', 'users'],
          collection: 'users',
          documentId: 'user-1',
        },
        changes: Array.from({ length: 101 }, (_, index) => ({
          field: `field_${index}`,
          value: index,
        })),
      }),
    ).toThrow(/at most 100 changes/)
  })

  it('rejects unknown edit kinds and path segments that are too deep or empty', () => {
    expect(() =>
      validateDataEditPlanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        editKind: 'drop-everything' as never,
        target: { objectKind: 'document', path: [] },
        changes: [],
      }),
    ).toThrow(/Unsupported data edit kind/)
    expect(() =>
      validateDataEditPlanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        editKind: 'set-field',
        target: {
          objectKind: 'document',
          path: [''],
          collection: 'users',
          documentId: 'user-1',
        },
        changes: [{ field: 'name', value: 'Ada' }],
      }),
    ).toThrow(/path segment is required/)
  })

  it('clamps operation row limits and validates local save paths', () => {
    expect(
      validateOperationExecutionRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        operationId: 'mongodb.diagnostics.metrics',
        rowLimit: 999_999,
      }).rowLimit,
    ).toBe(10_000)
    expect(
      validateSaveQueryTabToLocalFileRequest({
        tabId: 'tab-1',
        path: 'C:\\temp\\orders.sql',
      }),
    ).toMatchObject({ path: 'C:\\temp\\orders.sql' })
    expect(() =>
      validateSaveQueryTabToLocalFileRequest({
        tabId: 'tab-1',
        path: '..\\orders.sql',
      }),
    ).toThrow(/absolute file path/)
  })

  it('normalizes and validates library mutation requests', () => {
    expect(
      validateCreateLibraryFolderRequest({
        name: '  Queries  ',
        parentId: '',
        environmentId: ' env-qa ',
      }),
    ).toMatchObject({
      name: 'Queries',
      parentId: undefined,
      environmentId: 'env-qa',
    })

    expect(
      validateSetLibraryNodeEnvironmentRequest({
        nodeId: 'node-1',
        environmentId: ' ',
      }),
    ).toMatchObject({ environmentId: undefined })

    expect(
      validateSaveQueryTabToLibraryRequest({
        tabId: 'tab-1',
        name: '  Report  ',
        kind: 'query',
        tags: ['  sql  ', ''],
      }),
    ).toMatchObject({
      name: 'Report',
      kind: 'query',
      tags: ['sql'],
    })

    expect(() =>
      validateSaveQueryTabToLibraryRequest({
        tabId: 'tab-1',
        name: 'Report',
        kind: 'folder' as never,
        tags: [],
      }),
    ).toThrow(/Unsupported Library item kind/)
  })

  it('clamps execution and result paging limits while rejecting null-byte text', () => {
    expect(
      validateExecutionRequest({
        tabId: 'tab-1',
        connectionId: 'conn-1',
        environmentId: 'env-1',
        language: 'sql',
        queryText: 'select 1',
        rowLimit: 999_999,
      }).rowLimit,
    ).toBe(10_000)
    expect(
      validateResultPageRequest({
        tabId: 'tab-1',
        connectionId: 'conn-1',
        environmentId: 'env-1',
        language: 'sql',
        queryText: 'select 1',
        renderer: 'table',
        pageSize: 999_999,
        pageIndex: 999_999,
      }),
    ).toMatchObject({
      pageSize: 1000,
      pageIndex: 100000,
    })
    expect(() =>
      validateResultPageRequest({
        tabId: 'tab-1',
        connectionId: 'conn-1',
        environmentId: 'env-1',
        language: 'sql',
        queryText: 'select 1',
        renderer: 'iframe',
      }),
    ).toThrow(/Unsupported result renderer/)
    expect(() =>
      validateExecutionRequest({
        tabId: 'tab-1',
        connectionId: 'conn-1',
        environmentId: 'env-1',
        language: 'sql',
        queryText: 'select\u0000 1',
      }),
    ).toThrow(/null bytes/)
  })

  it('rejects plaintext connection-string secrets and normalizes profile tags', () => {
    expect(
      validateConnectionProfile({
        id: 'conn-1',
        name: '  Reporting  ',
        engine: 'postgresql',
        family: 'sql',
        host: 'localhost',
        environmentIds: [' env-qa '],
        tags: ['  finance  ', ''],
        favorite: false,
        readOnly: false,
        icon: 'database',
        auth: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({
      name: 'Reporting',
      environmentIds: ['env-qa'],
      tags: ['finance'],
    })

    expect(() =>
      validateConnectionProfile({
        id: 'conn-1',
        name: 'Reporting',
        engine: 'postgresql',
        family: 'sql',
        host: 'localhost',
        connectionString: 'postgres://user:secret@localhost/catalog',
        environmentIds: ['env-qa'],
        tags: [],
        favorite: false,
        readOnly: false,
        icon: 'database',
        auth: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/embedded passwords/)
  })

  it('normalizes nullable connection profile fields without raw runtime crashes', () => {
    const profile = validateConnectionProfile({
      id: 'conn-1',
      name: '  Reporting  ',
      engine: 'postgresql',
      family: 'sql',
      host: null,
      port: null,
      database: null,
      connectionMode: null,
      environmentIds: null,
      tags: null,
      favorite: false,
      readOnly: false,
      icon: null,
      auth: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never)

    expect(profile).toMatchObject({
      name: 'Reporting',
      host: '',
      database: undefined,
      environmentIds: [],
      tags: [],
      icon: 'database',
      auth: {},
    })

    expect(() =>
      validateConnectionTestRequest({
        environmentId: 'env-qa',
        profile: {
          ...profile,
          tags: 'oops',
        } as never,
      }),
    ).toThrow(/Profile tags must be an array/)

    expect(
      validateConnectionTestRequest({
        environmentId: 'env-qa',
        profile,
        secret: null,
      } as never).secret,
    ).toBeUndefined()
  })

  it('normalizes DynamoDB connection options and rejects unsafe limits', () => {
    const profile = validateConnectionProfile({
      id: 'conn-dynamo',
      name: 'DynamoDB',
      engine: 'dynamodb',
      family: 'widecolumn',
      host: 'https://dynamodb.us-east-1.amazonaws.com',
      database: 'us-east-1',
      connectionMode: 'cloud-sdk',
      environmentIds: ['env-qa'],
      tags: [],
      favorite: false,
      readOnly: false,
      icon: 'dynamodb',
      auth: {},
      dynamoDbOptions: {
        connectMode: 'access-keys',
        credentialsProvider: 'static-keys',
        region: ' us-east-1 ',
        endpointUrl: ' http://localhost:8000 ',
        accessKeyId: '{{AWS_ACCESS_KEY_ID}}',
        returnConsumedCapacity: 'indexes',
        retryMode: 'adaptive',
        maxAttempts: 4,
        scanPageSize: 250,
        consistentReadDefault: true,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(profile.dynamoDbOptions).toMatchObject({
      connectMode: 'access-keys',
      credentialsProvider: 'static-keys',
      region: 'us-east-1',
      endpointUrl: 'http://localhost:8000',
      returnConsumedCapacity: 'indexes',
      retryMode: 'adaptive',
      maxAttempts: 4,
      scanPageSize: 250,
      consistentReadDefault: true,
    })

    expect(() =>
      validateConnectionProfile({
        ...profile,
        dynamoDbOptions: {
          connectMode: 'magic-runtime',
          scanPageSize: 250_000,
        },
      } as never),
    ).toThrow(/Unsupported DynamoDB connection mode/)

    expect(() =>
      validateConnectionProfile({
        ...profile,
        dynamoDbOptions: {
          connectMode: 'aws-profile',
          scanPageSize: 250_000,
        },
      } as never),
    ).toThrow(/DynamoDB scan page size/)
  })

  it('normalizes Cassandra connection options and rejects invalid policies', () => {
    const profile = validateConnectionProfile({
      id: 'conn-cassandra',
      name: 'Cassandra',
      engine: 'cassandra',
      family: 'widecolumn',
      host: 'node1',
      port: 9042,
      database: 'app',
      connectionMode: 'native',
      environmentIds: ['env-qa'],
      tags: [],
      favorite: false,
      readOnly: false,
      icon: 'cassandra',
      auth: {},
      cassandraOptions: {
        connectMode: 'contact-points',
        contactPoints: [' node1:9042 ', 'node2:9042'],
        defaultKeyspace: ' catalog ',
        localDatacenter: ' dc1 ',
        consistencyLevel: 'local-quorum',
        loadBalancingPolicy: 'token-aware',
        pageSize: 500,
        useTls: true,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(profile.cassandraOptions).toMatchObject({
      connectMode: 'contact-points',
      contactPoints: ['node1:9042', 'node2:9042'],
      defaultKeyspace: 'catalog',
      localDatacenter: 'dc1',
      consistencyLevel: 'local-quorum',
      loadBalancingPolicy: 'token-aware',
      pageSize: 500,
      useTls: true,
    })

    expect(() =>
      validateConnectionProfile({
        ...profile,
        cassandraOptions: {
          connectMode: 'contact-points',
          consistencyLevel: 'eventual',
        },
      } as never),
    ).toThrow(/Unsupported Cassandra consistency level/)

    expect(() =>
      validateConnectionProfile({
        ...profile,
        cassandraOptions: {
          connectMode: 'contact-points',
          pageSize: 50_000,
        },
      } as never),
    ).toThrow(/Cassandra page size/)
  })

  it('normalizes Cosmos DB connection options and rejects unsafe item counts', () => {
    const profile = validateConnectionProfile({
      id: 'conn-cosmos',
      name: 'Cosmos DB',
      engine: 'cosmosdb',
      family: 'document',
      host: 'localhost',
      port: 8081,
      database: 'catalog',
      connectionMode: 'cloud-sdk',
      environmentIds: ['env-qa'],
      tags: [],
      favorite: false,
      readOnly: false,
      icon: 'cosmosdb',
      auth: {},
      cosmosDbOptions: {
        connectMode: 'account-endpoint',
        api: 'nosql',
        accountEndpoint: ' http://localhost:8081/cosmos ',
        databaseName: ' catalog ',
        authMode: 'account-key',
        preferredRegions: [' North Europe ', 'West Europe'],
        consistencyLevel: 'session',
        enableCrossPartitionQueries: true,
        maxItemCount: 250,
        returnRequestCharge: true,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(profile.cosmosDbOptions).toMatchObject({
      connectMode: 'account-endpoint',
      api: 'nosql',
      accountEndpoint: 'http://localhost:8081/cosmos',
      databaseName: 'catalog',
      authMode: 'account-key',
      preferredRegions: ['North Europe', 'West Europe'],
      consistencyLevel: 'session',
      enableCrossPartitionQueries: true,
      maxItemCount: 250,
      returnRequestCharge: true,
    })

    expect(() =>
      validateConnectionProfile({
        ...profile,
        cosmosDbOptions: {
          connectMode: 'account-endpoint',
          api: 'sql-api',
        },
      } as never),
    ).toThrow(/Unsupported Cosmos DB API/)

    expect(() =>
      validateConnectionProfile({
        ...profile,
        cosmosDbOptions: {
          connectMode: 'account-endpoint',
          maxItemCount: 50_000,
        },
      } as never),
    ).toThrow(/Cosmos DB max item count/)
  })

  it('normalizes search connection options and rejects unsupported auth modes', () => {
    const profile = validateConnectionProfile({
      id: 'conn-search',
      name: 'Elasticsearch',
      engine: 'elasticsearch',
      family: 'search',
      host: 'localhost',
      port: 9200,
      database: 'logs-*',
      connectionMode: 'cloud-iam',
      environmentIds: ['env-qa'],
      tags: [],
      favorite: false,
      readOnly: false,
      icon: 'elasticsearch',
      auth: {},
      searchOptions: {
        connectMode: 'aws-sigv4',
        endpointUrl: ' http://localhost:9200/elastic ',
        defaultIndex: ' logs-* ',
        pathPrefix: 'elastic',
        authMode: 'aws-sigv4',
        awsRegion: ' us-west-2 ',
        awsService: 'aoss',
        requestTimeoutMs: 120_000,
        compression: true,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(profile.searchOptions).toMatchObject({
      connectMode: 'aws-sigv4',
      endpointUrl: 'http://localhost:9200/elastic',
      defaultIndex: 'logs-*',
      pathPrefix: '/elastic',
      authMode: 'aws-sigv4',
      awsRegion: 'us-west-2',
      awsService: 'aoss',
      requestTimeoutMs: 120_000,
      compression: true,
    })

    expect(() =>
      validateConnectionProfile({
        ...profile,
        searchOptions: {
          connectMode: 'http',
          authMode: 'magic-token',
        },
      } as never),
    ).toThrow(/Unsupported Search auth mode/)

    expect(() =>
      validateConnectionProfile({
        ...profile,
        searchOptions: {
          connectMode: 'http',
          maxRetries: 100,
        },
      } as never),
    ).toThrow(/Search max retries/)
  })

  it('normalizes time-series connection options and rejects unsafe query limits', () => {
    const profile = validateConnectionProfile({
      id: 'conn-influx',
      name: 'InfluxDB',
      engine: 'influxdb',
      family: 'timeseries',
      host: 'localhost',
      port: 8086,
      database: 'telegraf',
      connectionMode: 'native',
      environmentIds: ['env-qa'],
      tags: [],
      favorite: false,
      readOnly: false,
      icon: 'influxdb',
      auth: {},
      timeSeriesOptions: {
        connectMode: 'influx-v2',
        endpointUrl: ' http://localhost:8086/influx ',
        pathPrefix: 'influx',
        organization: ' qa-org ',
        bucket: ' telemetry ',
        authMode: 'api-token',
        defaultQueryLanguage: 'flux',
        queryTimeoutMs: 120_000,
        maxSeries: 5_000,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(profile.timeSeriesOptions).toMatchObject({
      connectMode: 'influx-v2',
      endpointUrl: 'http://localhost:8086/influx',
      pathPrefix: '/influx',
      organization: 'qa-org',
      bucket: 'telemetry',
      authMode: 'api-token',
      defaultQueryLanguage: 'flux',
      queryTimeoutMs: 120_000,
      maxSeries: 5_000,
    })

    expect(() =>
      validateConnectionProfile({
        ...profile,
        timeSeriesOptions: {
          connectMode: 'telnet',
        },
      } as never),
    ).toThrow(/Unsupported time-series connection mode/)

    expect(() =>
      validateConnectionProfile({
        ...profile,
        timeSeriesOptions: {
          connectMode: 'http',
          maxSeries: 2_000_000,
        },
      } as never),
    ).toThrow(/time-series max series/)
  })

  it('normalizes graph connection options and rejects invalid modes', () => {
    const profile = validateConnectionProfile({
      id: 'conn-neo4j',
      name: 'Neo4j',
      engine: 'neo4j',
      family: 'graph',
      host: 'localhost',
      port: 7474,
      database: 'neo4j',
      connectionMode: 'native',
      environmentIds: ['env-qa'],
      tags: [],
      favorite: false,
      readOnly: false,
      icon: 'neo4j',
      auth: {},
      graphOptions: {
        connectMode: 'neo4j-http',
        endpointUrl: ' http://localhost:7474/neo4j ',
        pathPrefix: 'neo4j',
        databaseName: ' analytics ',
        defaultQueryLanguage: 'cypher',
        authMode: 'basic',
        username: ' {{NEO4J_USER}} ',
        fetchSize: 500,
        explainByDefault: true,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(profile.graphOptions).toMatchObject({
      connectMode: 'neo4j-http',
      endpointUrl: 'http://localhost:7474/neo4j',
      pathPrefix: '/neo4j',
      databaseName: 'analytics',
      defaultQueryLanguage: 'cypher',
      authMode: 'basic',
      username: '{{NEO4J_USER}}',
      fetchSize: 500,
      explainByDefault: true,
    })

    expect(() =>
      validateConnectionProfile({
        ...profile,
        graphOptions: {
          connectMode: 'graph-magic',
        },
      } as never),
    ).toThrow(/Unsupported Graph connection mode/)

    expect(() =>
      validateConnectionProfile({
        ...profile,
        graphOptions: {
          connectMode: 'neo4j-http',
          fetchSize: 250_000,
        },
      } as never),
    ).toThrow(/Graph fetch size/)
  })

  it('normalizes warehouse connection options and rejects invalid limits', () => {
    const profile = validateConnectionProfile({
      id: 'conn-snowflake',
      name: 'Snowflake',
      engine: 'snowflake',
      family: 'warehouse',
      host: 'account.snowflakecomputing.com',
      database: 'ANALYTICS',
      connectionMode: 'cloud-sdk',
      environmentIds: ['env-qa'],
      tags: [],
      favorite: false,
      readOnly: false,
      icon: 'snowflake',
      auth: {},
      warehouseOptions: {
        connectMode: 'snowflake-sql-api',
        endpointUrl: ' http://localhost:19100/snow ',
        pathPrefix: 'snowflake',
        databaseName: ' FINANCE ',
        schemaName: ' MART ',
        warehouseName: ' REPORTING_WH ',
        authMode: 'oauth',
        defaultQueryLanguage: 'snowflake-sql',
        maxRows: 10_000,
        costLimitUsd: 25.5,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(profile.warehouseOptions).toMatchObject({
      connectMode: 'snowflake-sql-api',
      endpointUrl: 'http://localhost:19100/snow',
      pathPrefix: '/snowflake',
      databaseName: 'FINANCE',
      schemaName: 'MART',
      warehouseName: 'REPORTING_WH',
      authMode: 'oauth',
      defaultQueryLanguage: 'snowflake-sql',
      maxRows: 10_000,
      costLimitUsd: 25.5,
    })

    expect(() =>
      validateConnectionProfile({
        ...profile,
        warehouseOptions: {
          connectMode: 'warehouse-magic',
        },
      } as never),
    ).toThrow(/Unsupported Warehouse connection mode/)

    expect(() =>
      validateConnectionProfile({
        ...profile,
        warehouseOptions: {
          connectMode: 'snowflake-sql-api',
          maxRows: 2_000_000,
        },
      } as never),
    ).toThrow(/Warehouse max rows/)
  })

  it('rejects plaintext secret environment variables and duplicate names', () => {
    expect(() =>
      validateEnvironmentProfile({
        id: 'env-qa',
        label: 'QA',
        color: '#8ab4f8',
        risk: 'medium',
        variables: {},
        sensitiveKeys: [],
        variableDefinitions: [
          {
            key: 'API_TOKEN',
            kind: 'secret',
            value: 'plain-secret',
          },
        ],
        requiresConfirmation: false,
        safeMode: false,
        exportable: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/cannot store plaintext/)

    expect(() =>
      validateEnvironmentProfile({
        id: 'env-qa',
        label: 'QA',
        color: '#8ab4f8',
        risk: 'medium',
        variables: {},
        sensitiveKeys: [],
        variableDefinitions: [
          { key: 'db_host', kind: 'text', value: 'localhost' },
          { key: 'DB_HOST', kind: 'text', value: '127.0.0.1' },
        ],
        requiresConfirmation: false,
        safeMode: false,
        exportable: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/duplicated/)
  })

  it('validates query builder state size and unsupported view modes', () => {
    expect(() =>
      validateUpdateQueryBuilderStateRequest({
        tabId: 'tab-1',
        builderState: { payload: 'x'.repeat(70 * 1024) } as never,
      }),
    ).toThrow(/too large/)

    expect(() =>
      validateUpdateQueryBuilderStateRequest({
        tabId: 'tab-1',
        builderState: { kind: 'mongo-find' } as never,
        queryViewMode: 'both' as never,
      }),
    ).toThrow(/Unsupported query view mode/)
  })
})
