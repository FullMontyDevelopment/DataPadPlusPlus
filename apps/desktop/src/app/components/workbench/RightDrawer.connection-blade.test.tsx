import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ConnectionProfile, EnvironmentProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionBlade } from './RightDrawer.connection-blade'

describe('ConnectionBlade', () => {
  it('keeps typed credentials for testing but clears them after successful save and close actions', async () => {
    const onClose = vi.fn()
    const onSaveConnection = vi.fn(async () => true)
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={connection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={onClose}
        onSaveConnection={onSaveConnection}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    const credentialInput = screen.getByLabelText('Password / Credential')

    fireEvent.change(credentialInput, { target: { value: 'do-not-keep-me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: connection.id }),
      environment.id,
      'do-not-keep-me',
    )
    expect(credentialInput).toHaveValue('do-not-keep-me')

    fireEvent.change(credentialInput, { target: { value: 'do-not-keep-me-again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    expect(onSaveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: connection.id }),
      'do-not-keep-me-again',
    )
    await waitFor(() => {
      expect(credentialInput).toHaveValue('')
    })

    fireEvent.change(credentialInput, { target: { value: 'close-clears-too' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }))
    expect(onClose).toHaveBeenCalled()
    expect(credentialInput).toHaveValue('')
  })

  it('keeps typed credentials visible when save fails', async () => {
    const onSaveConnection = vi.fn(async () => false)

    render(
      <ConnectionBlade
        activeConnection={connection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={onSaveConnection}
        onTestConnection={vi.fn()}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    const credentialInput = screen.getByLabelText('Password / Credential')
    fireEvent.change(credentialInput, { target: { value: 'keep-this-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))

    await waitFor(() => {
      expect(onSaveConnection).toHaveBeenCalled()
    })
    expect(credentialInput).toHaveValue('keep-this-secret')
  })

  it('keeps stored credentials write-only when editing an existing connection', () => {
    render(
      <ConnectionBlade
        activeConnection={connectionWithStoredSecret}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={vi.fn()}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    const credentialInput = screen.getByLabelText('Password / Credential')

    expect(credentialInput).toHaveValue('')
    expect(credentialInput).toHaveAttribute('placeholder', 'Stored credential')
  })

  it('shows DynamoDB-native connection options and keeps secret access keys write-only', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={dynamoConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('DynamoDB connection mode'), {
      target: { value: 'access-keys' },
    })
    fireEvent.change(screen.getByLabelText('DynamoDB region'), {
      target: { value: 'us-west-2' },
    })
    fireEvent.change(screen.getByLabelText('DynamoDB access key ID'), {
      target: { value: '{{AWS_ACCESS_KEY_ID}}' },
    })
    fireEvent.change(screen.getByLabelText('DynamoDB credential'), {
      target: { value: 'secret-access-key' },
    })
    fireEvent.change(screen.getByLabelText('DynamoDB return consumed capacity'), {
      target: { value: 'indexes' },
    })
    fireEvent.change(screen.getByLabelText('DynamoDB scan page size'), {
      target: { value: '250' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: dynamoConnection.id,
        dynamoDbOptions: expect.objectContaining({
          connectMode: 'access-keys',
          credentialsProvider: 'static-keys',
          region: 'us-west-2',
          accessKeyId: '{{AWS_ACCESS_KEY_ID}}',
          returnConsumedCapacity: 'indexes',
          scanPageSize: 250,
        }),
      }),
      environment.id,
      'secret-access-key',
    )
  })

  it('shows Cassandra-native contact point and policy options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={cassandraConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Cassandra contact points'), {
      target: { value: 'node-a:9042\nnode-b:9042' },
    })
    fireEvent.change(screen.getByLabelText('Cassandra default keyspace'), {
      target: { value: 'catalog' },
    })
    fireEvent.change(screen.getByLabelText('Cassandra local datacenter'), {
      target: { value: 'dc1' },
    })
    fireEvent.change(screen.getByLabelText('Cassandra consistency level'), {
      target: { value: 'quorum' },
    })
    fireEvent.change(screen.getByLabelText('Cassandra page size'), {
      target: { value: '500' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: cassandraConnection.id,
        host: 'node-a',
        database: 'catalog',
        cassandraOptions: expect.objectContaining({
          contactPoints: ['node-a:9042', 'node-b:9042'],
          defaultKeyspace: 'catalog',
          localDatacenter: 'dc1',
          consistencyLevel: 'quorum',
          pageSize: 500,
        }),
      }),
      environment.id,
      '',
    )
  })

  it('shows Cosmos DB-native endpoint, auth, consistency, and region options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={cosmosConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Cosmos DB connection mode'), {
      target: { value: 'account-endpoint' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB account endpoint'), {
      target: { value: 'http://localhost:8081/cosmos' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB database name'), {
      target: { value: 'catalog' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB credential'), {
      target: { value: 'cosmos-key' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB consistency level'), {
      target: { value: 'bounded-staleness' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB preferred regions'), {
      target: { value: 'North Europe, West Europe' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB max item count'), {
      target: { value: '250' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: cosmosConnection.id,
        host: 'http://localhost:8081/cosmos',
        database: 'catalog',
        cosmosDbOptions: expect.objectContaining({
          connectMode: 'account-endpoint',
          authMode: 'account-key',
          accountEndpoint: 'http://localhost:8081/cosmos',
          databaseName: 'catalog',
          consistencyLevel: 'bounded-staleness',
          preferredRegions: ['North Europe', 'West Europe'],
          maxItemCount: 250,
        }),
      }),
      environment.id,
      'cosmos-key',
    )
  })

  it('shows Memcached-native server, protocol, SASL, and timeout options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={memcachedConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Memcached servers'), {
      target: { value: 'cache-a:11212\ncache-b:11211' },
    })
    fireEvent.change(screen.getByLabelText('Memcached protocol'), {
      target: { value: 'binary' },
    })
    fireEvent.change(screen.getByLabelText('Memcached auth mode'), {
      target: { value: 'sasl-plain' },
    })
    fireEvent.change(screen.getByLabelText('Memcached username'), {
      target: { value: '{{CACHE_USER}}' },
    })
    fireEvent.change(screen.getByLabelText('Memcached credential'), {
      target: { value: 'sasl-secret' },
    })
    fireEvent.change(screen.getByLabelText('Memcached namespace prefix'), {
      target: { value: 'catalog:' },
    })
    fireEvent.change(screen.getByLabelText('Memcached default TTL'), {
      target: { value: '120' },
    })
    fireEvent.change(screen.getByLabelText('Memcached connection timeout'), {
      target: { value: '2500' },
    })
    fireEvent.change(screen.getByLabelText('Memcached request timeout'), {
      target: { value: '5000' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: memcachedConnection.id,
        host: 'cache-a',
        port: 11212,
        memcachedOptions: expect.objectContaining({
          servers: ['cache-a:11212', 'cache-b:11211'],
          protocol: 'binary',
          authMode: 'sasl-plain',
          username: '{{CACHE_USER}}',
          namespacePrefix: 'catalog:',
          defaultTtlSeconds: 120,
          connectTimeoutMs: 2500,
          requestTimeoutMs: 5000,
        }),
      }),
      environment.id,
      'sasl-secret',
    )
  })

  it('shows Elasticsearch/OpenSearch-native endpoint, auth, index, and AWS options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={searchConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search connection mode'), {
      target: { value: 'aws-sigv4' },
    })
    fireEvent.change(screen.getByLabelText('Search endpoint URL'), {
      target: { value: 'http://localhost:9200/search' },
    })
    fireEvent.change(screen.getByLabelText('Search default index'), {
      target: { value: 'logs-*' },
    })
    fireEvent.change(screen.getByLabelText('Search AWS region'), {
      target: { value: 'us-west-2' },
    })
    fireEvent.change(screen.getByLabelText('Search AWS service'), {
      target: { value: 'aoss' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: searchConnection.id,
        host: 'http://localhost:9200/search',
        database: 'logs-*',
        searchOptions: expect.objectContaining({
          connectMode: 'aws-sigv4',
          authMode: 'aws-sigv4',
          endpointUrl: 'http://localhost:9200/search',
          defaultIndex: 'logs-*',
          awsRegion: 'us-west-2',
          awsService: 'aoss',
        }),
      }),
      environment.id,
      '',
    )
  })

  it('shows time-series-native endpoint, bucket, token, and query options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={timeSeriesConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Time-series connection mode'), {
      target: { value: 'influx-v2' },
    })
    fireEvent.change(screen.getByLabelText('Time-series endpoint URL'), {
      target: { value: 'http://localhost:8086/influx' },
    })
    fireEvent.change(screen.getByLabelText('InfluxDB organization'), {
      target: { value: 'qa-org' },
    })
    fireEvent.change(screen.getByLabelText('InfluxDB bucket'), {
      target: { value: 'telemetry' },
    })
    fireEvent.change(screen.getByLabelText('Time-series auth mode'), {
      target: { value: 'api-token' },
    })
    fireEvent.change(screen.getByLabelText('Time-series credential'), {
      target: { value: 'influx-token' },
    })
    fireEvent.change(screen.getByLabelText('Time-series query timeout'), {
      target: { value: '180000' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: timeSeriesConnection.id,
        host: 'http://localhost:8086/influx',
        database: 'telemetry',
        timeSeriesOptions: expect.objectContaining({
          connectMode: 'influx-v2',
          endpointUrl: 'http://localhost:8086/influx',
          organization: 'qa-org',
          bucket: 'telemetry',
          authMode: 'api-token',
          queryTimeoutMs: 180_000,
        }),
      }),
      environment.id,
      'influx-token',
    )
  })

  it('shows graph-native endpoint, database, auth, and traversal options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={graphConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Graph connection mode'), {
      target: { value: 'neo4j-http' },
    })
    fireEvent.change(screen.getByLabelText('Graph endpoint URL'), {
      target: { value: 'http://localhost:7474/proxy' },
    })
    fireEvent.change(screen.getByLabelText('Graph database'), {
      target: { value: 'analytics' },
    })
    fireEvent.change(screen.getByLabelText('Graph auth mode'), {
      target: { value: 'basic' },
    })
    fireEvent.change(screen.getByLabelText('Graph username'), {
      target: { value: '{{NEO4J_USER}}' },
    })
    fireEvent.change(screen.getByLabelText('Graph credential'), {
      target: { value: 'neo4j-password' },
    })
    fireEvent.change(screen.getByLabelText('Graph fetch size'), {
      target: { value: '500' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: graphConnection.id,
        host: 'http://localhost:7474/proxy',
        database: 'analytics',
        graphOptions: expect.objectContaining({
          connectMode: 'neo4j-http',
          endpointUrl: 'http://localhost:7474/proxy',
          databaseName: 'analytics',
          authMode: 'basic',
          username: '{{NEO4J_USER}}',
          fetchSize: 500,
        }),
      }),
      environment.id,
      'neo4j-password',
    )
  })

  it('shows warehouse-native endpoint, scope, auth, and cost options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={warehouseConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Warehouse connection mode'), {
      target: { value: 'snowflake-sql-api' },
    })
    fireEvent.change(screen.getByLabelText('Warehouse endpoint URL'), {
      target: { value: 'http://localhost:19100/snow' },
    })
    fireEvent.change(screen.getByLabelText('Warehouse database'), {
      target: { value: 'FINANCE' },
    })
    fireEvent.change(screen.getByLabelText('Warehouse auth mode'), {
      target: { value: 'oauth' },
    })
    fireEvent.change(screen.getByLabelText('Warehouse credential'), {
      target: { value: 'snowflake-token' },
    })
    fireEvent.change(screen.getByLabelText('Snowflake schema'), {
      target: { value: 'MART' },
    })
    fireEvent.change(screen.getByLabelText('Snowflake warehouse'), {
      target: { value: 'REPORTING_WH' },
    })
    fireEvent.change(screen.getByLabelText('Warehouse cost limit'), {
      target: { value: '25.5' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: warehouseConnection.id,
        host: 'http://localhost:19100/snow',
        database: 'FINANCE',
        warehouseOptions: expect.objectContaining({
          connectMode: 'snowflake-sql-api',
          endpointUrl: 'http://localhost:19100/snow',
          databaseName: 'FINANCE',
          authMode: 'oauth',
          schemaName: 'MART',
          warehouseName: 'REPORTING_WH',
          costLimitUsd: 25.5,
        }),
      }),
      environment.id,
      'snowflake-token',
    )
  })
})

const environment: EnvironmentProfile = {
  id: 'env-local',
  label: 'Local',
  color: '#5dd6b0',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  variableDefinitions: [],
  requiresConfirmation: false,
  safeMode: false,
  exportable: true,
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const connection: ConnectionProfile = {
  id: 'conn-postgres',
  name: 'PostgreSQL',
  engine: 'postgresql',
  family: 'sql',
  host: 'localhost',
  port: 5432,
  database: 'app',
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'PG',
  auth: {
    username: 'app',
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const connectionWithStoredSecret: ConnectionProfile = {
  ...connection,
  auth: {
    ...connection.auth,
    secretRef: {
      id: 'secret-connection-password',
      provider: 'os-keyring',
      service: 'datapadplusplus',
      account: 'conn-postgres',
      label: 'PostgreSQL credential',
    },
  },
}

const dynamoConnection: ConnectionProfile = {
  id: 'conn-dynamodb',
  name: 'DynamoDB',
  engine: 'dynamodb',
  family: 'widecolumn',
  host: 'https://dynamodb.us-east-1.amazonaws.com',
  database: 'us-east-1',
  connectionMode: 'cloud-sdk',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'dynamodb',
  auth: {
    cloudProvider: 'aws',
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  dynamoDbOptions: {
    connectMode: 'aws-profile',
    region: 'us-east-1',
    profileName: 'default',
    credentialsProvider: 'profile',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const cassandraConnection: ConnectionProfile = {
  id: 'conn-cassandra',
  name: 'Cassandra',
  engine: 'cassandra',
  family: 'widecolumn',
  host: 'node1',
  port: 9042,
  database: 'app',
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cassandra',
  auth: {
    username: 'cassandra',
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  cassandraOptions: {
    connectMode: 'contact-points',
    contactPoints: ['node1:9042'],
    defaultKeyspace: 'app',
    localDatacenter: 'datacenter1',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const cosmosConnection: ConnectionProfile = {
  id: 'conn-cosmos',
  name: 'Cosmos DB',
  engine: 'cosmosdb',
  family: 'document',
  host: 'http://localhost:8081',
  port: 8081,
  database: 'catalog',
  connectionMode: 'cloud-sdk',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cosmosdb',
  auth: {
    cloudProvider: 'azure',
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  cosmosDbOptions: {
    connectMode: 'emulator',
    api: 'nosql',
    accountEndpoint: 'http://localhost:8081',
    databaseName: 'catalog',
    authMode: 'emulator',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const memcachedConnection: ConnectionProfile = {
  id: 'conn-memcached',
  name: 'Memcached',
  engine: 'memcached',
  family: 'keyvalue',
  host: 'localhost',
  port: 11211,
  database: undefined,
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'memcached',
  auth: {
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  memcachedOptions: {
    servers: ['localhost:11211'],
    protocol: 'text',
    authMode: 'none',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const searchConnection: ConnectionProfile = {
  id: 'conn-search',
  name: 'Elasticsearch',
  engine: 'elasticsearch',
  family: 'search',
  host: 'localhost',
  port: 9200,
  database: 'catalog-*',
  connectionMode: 'cloud-iam',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'elasticsearch',
  auth: {
    cloudProvider: 'aws',
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  searchOptions: {
    connectMode: 'aws-sigv4',
    endpointUrl: 'http://localhost:9200',
    defaultIndex: 'catalog-*',
    authMode: 'aws-sigv4',
    awsRegion: 'us-east-1',
    awsService: 'es',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const timeSeriesConnection: ConnectionProfile = {
  id: 'conn-influx',
  name: 'InfluxDB',
  engine: 'influxdb',
  family: 'timeseries',
  host: 'localhost',
  port: 8086,
  database: 'telegraf',
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'influxdb',
  auth: {
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  timeSeriesOptions: {
    connectMode: 'influx-v1',
    endpointUrl: 'http://localhost:8086',
    bucket: 'telegraf',
    defaultQueryLanguage: 'influxql',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const graphConnection: ConnectionProfile = {
  id: 'conn-neo4j',
  name: 'Neo4j',
  engine: 'neo4j',
  family: 'graph',
  host: 'localhost',
  port: 7474,
  database: 'neo4j',
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'neo4j',
  auth: {
    username: 'neo4j',
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  graphOptions: {
    connectMode: 'neo4j-http',
    endpointUrl: 'http://localhost:7474',
    databaseName: 'neo4j',
    authMode: 'basic',
    defaultQueryLanguage: 'cypher',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const warehouseConnection: ConnectionProfile = {
  id: 'conn-snowflake',
  name: 'Snowflake',
  engine: 'snowflake',
  family: 'warehouse',
  host: 'account.snowflakecomputing.com',
  port: undefined,
  database: 'ANALYTICS',
  connectionMode: 'cloud-sdk',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'snowflake',
  auth: {
    cloudProvider: 'snowflake',
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  warehouseOptions: {
    connectMode: 'snowflake-sql-api',
    endpointUrl: 'http://localhost:19100',
    databaseName: 'ANALYTICS',
    schemaName: 'PUBLIC',
    authMode: 'oauth',
    defaultQueryLanguage: 'snowflake-sql',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}
