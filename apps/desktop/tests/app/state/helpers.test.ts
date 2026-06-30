import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../../fixtures/seed-workspace'
import { createBlankBootstrapPayload } from '../../../src/app/data/workspace-factory'
import {
  evaluateGuardrails,
  migrateWorkspaceSnapshot,
  normalizeUiState,
  resolveEnvironment,
} from '../../../src/app/state/helpers'

describe('resolveEnvironment', () => {
  it('resolves inherited variables for prod', () => {
    const snapshot = createSeedSnapshot()
    const resolved = resolveEnvironment(snapshot.environments, 'env-prod')

    expect(resolved.variables.DB_HOST).toBe('analytics-prod.internal')
    expect(resolved.variables.DB_NAME).toBe('datapadplusplus_dev')
    expect(resolved.inheritedChain).toEqual(['Dev', 'Prod'])
  })

  it('resolves no environment without inheriting fallback variables', () => {
    const snapshot = createSeedSnapshot()
    const resolved = resolveEnvironment(snapshot.environments, '')

    expect(resolved.environmentId).toBe('')
    expect(resolved.label).toBe('No environment')
    expect(resolved.variables).toEqual({})
    expect(resolved.inheritedChain).toEqual([])
  })
})

describe('evaluateGuardrails', () => {
  it('blocks writes on read-only connections', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-orders')
    const environment = snapshot.environments.find((item) => item.id === 'env-uat')
    const resolved = resolveEnvironment(snapshot.environments, 'env-uat')

    expect(connection).toBeDefined()
    expect(environment).toBeDefined()

    const decision = evaluateGuardrails(
      connection!,
      environment!,
      resolved,
      'delete from dbo.orders where order_id = 1;',
      true,
    )

    expect(decision.status).toBe('block')
  })

  it('requires confirmation for critical production work before execution', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-analytics')
    const environment = snapshot.environments.find((item) => item.id === 'env-prod')
    const resolved = resolveEnvironment(snapshot.environments, 'env-prod')

    expect(connection).toBeDefined()
    expect(environment).toBeDefined()

    const decision = evaluateGuardrails(
      connection!,
      environment!,
      resolved,
      'select * from observability.table_health;',
      true,
    )

    expect(decision.status).toBe('confirm')
    expect(decision.requiredConfirmationText).toBe('CONFIRM Prod')
  })

  it('requires confirmation for risky writes when safe mode is enabled', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-analytics')
    const environment = snapshot.environments.find((item) => item.id === 'env-dev')
    const resolved = resolveEnvironment(snapshot.environments, 'env-dev')

    expect(connection).toBeDefined()
    expect(environment).toBeDefined()

    const decision = evaluateGuardrails(
      connection!,
      environment!,
      resolved,
      'update accounts set status = "inactive" where id = 1;',
      true,
    )

    expect(decision.status).toBe('confirm')
    expect(decision.reasons).toContain(
      'Global safe mode requires confirmation for risky work.',
    )
  })
})

describe('migrateWorkspaceSnapshot', () => {
  it('defaults first install guide preferences to unseen', () => {
    const snapshot = createBlankBootstrapPayload().snapshot

    expect(snapshot.preferences.firstInstallGuide).toEqual({ status: 'unseen' })
  })

  it('normalizes first install guide preferences during migration', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      preferences: {
        ...snapshot.preferences,
        firstInstallGuide: {
          status: 'bogus',
          updatedAt: '2026-06-30T00:00:00.000Z',
          completedAt: '2026-06-30T00:00:00.000Z',
        },
      },
    } as unknown as typeof snapshot)

    expect(migrated.preferences.firstInstallGuide).toEqual({
      status: 'unseen',
      updatedAt: '2026-06-30T00:00:00.000Z',
      completedAt: undefined,
    })

    const completed = migrateWorkspaceSnapshot({
      ...snapshot,
      preferences: {
        ...snapshot.preferences,
        firstInstallGuide: {
          status: 'completed',
          updatedAt: '2026-06-30T01:00:00.000Z',
          completedAt: '2026-06-30T01:01:00.000Z',
        },
      },
    }).preferences.firstInstallGuide

    expect(completed).toEqual({
      status: 'completed',
      updatedAt: '2026-06-30T01:00:00.000Z',
      completedAt: '2026-06-30T01:01:00.000Z',
    })
  })

  it('maps legacy ui state into ADS workbench defaults', () => {
    const snapshot = createSeedSnapshot()
    const legacy = {
      ...snapshot,
      schemaVersion: 1,
      ui: {
        activeConnectionId: snapshot.ui.activeConnectionId,
        activeEnvironmentId: snapshot.ui.activeEnvironmentId,
        activeTabId: snapshot.ui.activeTabId,
        explorerFilter: 'orders',
        commandPaletteOpen: true,
        diagnosticsOpen: true,
      },
    } as unknown as typeof snapshot

    const migrated = migrateWorkspaceSnapshot(legacy)

    expect(migrated.schemaVersion).toBe(10)
    expect(migrated.ui.activeActivity).toBe('library')
    expect(migrated.ui.activeSidebarPane).toBe('library')
    expect(migrated.ui.sidebarWidth).toBe(280)
    expect(migrated.ui.bottomPanelVisible).toBe(false)
    expect(migrated.ui.activeBottomPanelTab).toBe('results')
    expect(migrated.ui.rightDrawer).toBe('none')
    expect(migrated.ui.rightDrawerWidth).toBe(360)
    expect(migrated.ui.explorerFilter).toBe('orders')
    expect(migrated.ui.connectionGroupMode).toBe('none')
    expect(migrated.ui.sidebarSectionStates).toEqual({})
    expect(migrated.libraryNodes.some((node) => node.id === 'library-root-tests')).toBe(false)
  })

  it('normalizes experimental API server preferences', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      preferences: {
        ...snapshot.preferences,
        datastoreApiServer: {
          enabled: true,
          host: '0.0.0.0',
          port: 80,
          autoStart: true,
          connectionId: 123,
          environmentId: 'env-dev',
        },
      },
    } as unknown as typeof snapshot)

    expect(migrated.preferences.datastoreApiServer).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 1024,
      autoStart: true,
      connectionId: undefined,
      environmentId: 'env-dev',
      activeServerId: 'api-server-default',
      servers: [{
        id: 'api-server-default',
        name: 'Local API Server',
        description: undefined,
        host: '127.0.0.1',
        port: 1024,
        autoStart: true,
        protocol: 'rest',
        basePath: '',
        connectionId: undefined,
        environmentId: 'env-dev',
        resources: [],
        customEndpoints: [],
      }],
    })
  })

  it('migrates legacy saved work into Library nodes and maps saved-work UI state', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      connections: [],
      environments: snapshot.environments,
      tabs: [
        {
          ...snapshot.tabs[0]!,
          id: 'tab-custom',
          savedQueryId: 'saved-query',
          saveTarget: undefined,
        },
      ],
      savedWork: [
        {
          id: 'saved-query',
          kind: 'query',
          name: 'Daily orders',
          summary: 'Orders by day',
          tags: ['orders'],
          updatedAt: '2026-05-14T00:00:00.000Z',
          folder: 'Reports/Daily',
          environmentId: 'env-prod',
          language: 'sql',
          queryText: 'select 1;',
        },
      ],
      ui: {
        ...snapshot.ui,
        activeActivity: 'saved-work',
        activeSidebarPane: 'saved-work',
      },
    } as unknown as typeof snapshot)

    expect(migrated.ui.activeActivity).toBe('library')
    expect(migrated.ui.activeSidebarPane).toBe('library')
    expect(migrated.libraryNodes.some((node) => node.name === 'Reports')).toBe(true)
    expect(migrated.libraryNodes.some((node) => node.name === 'Daily orders')).toBe(true)
    expect(migrated.tabs[0]?.saveTarget).toEqual({
      kind: 'library',
      libraryItemId: migrated.tabs[0]?.savedQueryId,
    })
  })

  it('migrates connection strings into the connection-string method', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      connections: [
        {
          ...snapshot.connections[0]!,
          id: 'conn-string-profile',
          connectionString: 'postgresql://user:${PASSWORD}@localhost:5432/app',
          connectionMode: undefined,
        },
      ],
      tabs: [],
      closedTabs: [],
    } as unknown as typeof snapshot)

    expect(migrated.connections[0]?.connectionMode).toBe('connection-string')
    expect(migrated.connections[0]?.connectionString).toBe(
      'postgresql://user:{{PASSWORD}}@localhost:5432/app',
    )
    expect(
      migrated.libraryNodes.some(
        (node) =>
          node.kind === 'connection' && node.connectionId === 'conn-string-profile',
      ),
    ).toBe(true)
  })

  it('migrates legacy environment variables and query tokens without persisting secret values', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      environments: [
        {
          ...snapshot.environments[0]!,
          variables: {
            DB_HOST: 'localhost',
            API_TOKEN: 'plaintext-token',
          },
          sensitiveKeys: ['API_TOKEN'],
          variableDefinitions: undefined,
        },
      ],
      tabs: [
        {
          ...snapshot.tabs[0]!,
          id: 'tab-variable-migration',
          queryText: 'select * from ${DB_SCHEMA}.accounts where token = ${API_TOKEN}',
          scriptText: 'db.${COLLECTION}.find({})',
        },
      ],
      closedTabs: [
        {
          ...snapshot.tabs[0]!,
          id: 'closed-token-tab',
          queryText: 'select * from ${DB_SCHEMA}.accounts',
          closedAt: '2026-05-21T00:00:00.000Z',
          closeReason: 'user',
        },
      ],
      libraryNodes: [
        {
          id: 'library-query-token',
          kind: 'query',
          name: 'Token query',
          parentId: undefined,
          connectionId: snapshot.connections[0]?.id,
          environmentId: snapshot.environments[0]?.id,
          queryText: 'select ${VALUE};',
          tags: [],
          favorite: false,
          createdAt: '2026-05-21T00:00:00.000Z',
          updatedAt: '2026-05-21T00:00:00.000Z',
        },
      ],
    } as unknown as typeof snapshot)

    expect(migrated.tabs[0]?.queryText).toContain('{{DB_SCHEMA}}')
    expect(migrated.tabs[0]?.queryText).toContain('{{API_TOKEN}}')
    expect(migrated.tabs[0]?.scriptText).toBe('db.{{COLLECTION}}.find({})')
    expect(migrated.closedTabs[0]?.queryText).toBe('select * from {{DB_SCHEMA}}.accounts')
    expect(migrated.libraryNodes[0]?.queryText).toBe('select {{VALUE}};')
    expect(JSON.stringify(migrated.environments[0])).not.toContain('plaintext-token')
    expect(migrated.environments[0]?.variableDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'API_TOKEN', kind: 'secret', value: undefined }),
      ]),
    )
  })

  it('preserves typed connection options and migrates variable tokens inside option fields', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      connections: [
        {
          ...snapshot.connections[0]!,
          id: 'conn-dynamo-options',
          engine: 'dynamodb',
          family: 'widecolumn',
          connectionMode: 'cloud-iam',
          host: 'dynamodb.${AWS_REGION}.amazonaws.com',
          dynamoDbOptions: {
            connectMode: 'assume-role',
            region: '${AWS_REGION}',
            endpointUrl: 'http://${LOCALSTACK_HOST}:4566',
            profileName: '${AWS_PROFILE}',
            roleArn: 'arn:aws:iam::${AWS_ACCOUNT}:role/DataPadReadOnly',
            returnConsumedCapacity: 'indexes',
            scanPageSize: 100,
          },
        },
        {
          ...snapshot.connections[0]!,
          id: 'conn-cassandra-options',
          engine: 'cassandra',
          family: 'widecolumn',
          connectionMode: 'native',
          host: '${CASSANDRA_HOST}',
          cassandraOptions: {
            connectMode: 'contact-points',
            contactPoints: ['${CASSANDRA_HOST}:9042', 'node2:9042'],
            defaultKeyspace: '${CASSANDRA_KEYSPACE}',
            localDatacenter: '${CASSANDRA_DC}',
            secureConnectBundlePath: 'C:/bundles/${CASSANDRA_BUNDLE}.zip',
          },
        },
        {
          ...snapshot.connections[0]!,
          id: 'conn-search-options',
          engine: 'elasticsearch',
          family: 'search',
          connectionMode: 'cloud-iam',
          host: '${SEARCH_HOST}',
          searchOptions: {
            connectMode: 'elastic-cloud',
            endpointUrl: 'https://${SEARCH_CLUSTER}.es.example.com',
            defaultIndex: '${SEARCH_INDEX}-*',
            apiKeyId: '${SEARCH_KEY_ID}',
            awsRegion: '${AWS_REGION}',
          },
        },
        {
          ...snapshot.connections[0]!,
          id: 'conn-timeseries-options',
          engine: 'influxdb',
          family: 'timeseries',
          connectionMode: 'native',
          host: '${INFLUX_HOST}',
          timeSeriesOptions: {
            connectMode: 'influx-v2',
            endpointUrl: 'http://${INFLUX_HOST}:8086',
            organization: '${INFLUX_ORG}',
            bucket: '${INFLUX_BUCKET}',
            defaultQueryLanguage: 'flux',
          },
        },
        {
          ...snapshot.connections[0]!,
          id: 'conn-graph-options',
          engine: 'neo4j',
          family: 'graph',
          connectionMode: 'native',
          host: '${NEO4J_HOST}',
          graphOptions: {
            connectMode: 'neo4j-http',
            endpointUrl: 'http://${NEO4J_HOST}:7474',
            databaseName: '${NEO4J_DATABASE}',
            username: '${NEO4J_USER}',
            defaultQueryLanguage: 'cypher',
          },
        },
        {
          ...snapshot.connections[0]!,
          id: 'conn-warehouse-options',
          engine: 'snowflake',
          family: 'warehouse',
          connectionMode: 'cloud-sdk',
          host: '${SNOWFLAKE_HOST}',
          warehouseOptions: {
            connectMode: 'snowflake-sql-api',
            endpointUrl: 'http://${SNOWFLAKE_HOST}:19100',
            databaseName: '${SNOWFLAKE_DATABASE}',
            schemaName: '${SNOWFLAKE_SCHEMA}',
            warehouseName: '${SNOWFLAKE_WAREHOUSE}',
            defaultQueryLanguage: 'snowflake-sql',
          },
        },
      ],
      tabs: [],
      closedTabs: [],
    } as unknown as typeof snapshot)

    expect(migrated.connections[0]?.host).toBe('dynamodb.{{AWS_REGION}}.amazonaws.com')
    expect(migrated.connections[0]?.connectionMode).toBe('cloud-iam')
    expect(migrated.connections[0]?.dynamoDbOptions).toMatchObject({
      connectMode: 'assume-role',
      region: '{{AWS_REGION}}',
      endpointUrl: 'http://{{LOCALSTACK_HOST}}:4566',
      profileName: '{{AWS_PROFILE}}',
      roleArn: 'arn:aws:iam::{{AWS_ACCOUNT}}:role/DataPadReadOnly',
      returnConsumedCapacity: 'indexes',
      scanPageSize: 100,
    })
    expect(migrated.connections[1]?.host).toBe('{{CASSANDRA_HOST}}')
    expect(migrated.connections[1]?.cassandraOptions).toMatchObject({
      connectMode: 'contact-points',
      contactPoints: ['{{CASSANDRA_HOST}}:9042', 'node2:9042'],
      defaultKeyspace: '{{CASSANDRA_KEYSPACE}}',
      localDatacenter: '{{CASSANDRA_DC}}',
      secureConnectBundlePath: 'C:/bundles/{{CASSANDRA_BUNDLE}}.zip',
    })
    expect(migrated.connections[2]?.host).toBe('{{SEARCH_HOST}}')
    expect(migrated.connections[2]?.searchOptions).toMatchObject({
      connectMode: 'elastic-cloud',
      endpointUrl: 'https://{{SEARCH_CLUSTER}}.es.example.com',
      defaultIndex: '{{SEARCH_INDEX}}-*',
      apiKeyId: '{{SEARCH_KEY_ID}}',
      awsRegion: '{{AWS_REGION}}',
    })
    expect(migrated.connections[3]?.host).toBe('{{INFLUX_HOST}}')
    expect(migrated.connections[3]?.timeSeriesOptions).toMatchObject({
      connectMode: 'influx-v2',
      endpointUrl: 'http://{{INFLUX_HOST}}:8086',
      organization: '{{INFLUX_ORG}}',
      bucket: '{{INFLUX_BUCKET}}',
      defaultQueryLanguage: 'flux',
    })
    expect(migrated.connections[4]?.host).toBe('{{NEO4J_HOST}}')
    expect(migrated.connections[4]?.graphOptions).toMatchObject({
      connectMode: 'neo4j-http',
      endpointUrl: 'http://{{NEO4J_HOST}}:7474',
      databaseName: '{{NEO4J_DATABASE}}',
      username: '{{NEO4J_USER}}',
      defaultQueryLanguage: 'cypher',
    })
    expect(migrated.connections[5]?.host).toBe('{{SNOWFLAKE_HOST}}')
    expect(migrated.connections[5]?.warehouseOptions).toMatchObject({
      connectMode: 'snowflake-sql-api',
      endpointUrl: 'http://{{SNOWFLAKE_HOST}}:19100',
      databaseName: '{{SNOWFLAKE_DATABASE}}',
      schemaName: '{{SNOWFLAKE_SCHEMA}}',
      warehouseName: '{{SNOWFLAKE_WAREHOUSE}}',
      defaultQueryLanguage: 'snowflake-sql',
    })
  })

  it('preserves persisted sidebar display state when migrating workspace state', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      ui: {
        ...snapshot.ui,
        connectionGroupMode: 'database-type',
        sidebarSectionStates: {
          'connections:database-type:sql': false,
          'search:commands': true,
        },
      },
    })

    expect(migrated.ui.connectionGroupMode).toBe('database-type')
    expect(migrated.ui.sidebarSectionStates).toEqual({
      'connections:database-type:sql': false,
      'search:commands': true,
    })
  })

  it('unlocks legacy snapshots so the removed lock UI cannot strand the workspace', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      lockState: {
        isLocked: true,
        lockedAt: '2026-05-16T10:00:00.000Z',
      },
    })

    expect(migrated.lockState).toEqual({ isLocked: false, lockedAt: undefined })
  })

  it('strips known demo records from untouched seeded snapshots', () => {
    const migrated = migrateWorkspaceSnapshot(createSeedSnapshot())

    expect(migrated.connections).toHaveLength(0)
    expect(migrated.environments).toHaveLength(0)
    expect(migrated.tabs).toHaveLength(0)
    expect(migrated.closedTabs).toHaveLength(0)
    expect(migrated.savedWork).toHaveLength(0)
    expect(migrated.libraryNodes).toHaveLength(0)
    expect(migrated.explorerNodes).toHaveLength(0)
    expect(migrated.guardrails).toHaveLength(0)
    expect(migrated.ui.activeConnectionId).toBe('')
    expect(migrated.ui.activeEnvironmentId).toBe('')
    expect(migrated.ui.activeTabId).toBe('')
    expect(migrated.ui.bottomPanelVisible).toBe(false)
  })
})

describe('normalizeUiState', () => {
  it('clamps layout inputs and rejects unknown persisted UI values', () => {
    const snapshot = createSeedSnapshot()
    const normalized = normalizeUiState({
      ...snapshot,
      ui: {
        ...snapshot.ui,
        activeActivity: 'invalid-activity',
        activeSidebarPane: 'invalid-pane',
        activeBottomPanelTab: 'invalid-tab',
        bottomPanelHeight: Number.NaN,
        sidebarWidth: 9999,
        rightDrawer: 'surprise-drawer',
        rightDrawerWidth: 12,
        connectionGroupMode: 'cluster-by-mood',
        sidebarSectionStates: {
          'connections:none:all': true,
          'connections:none:bad': 'open',
        },
      },
    } as unknown as typeof snapshot)

    expect(normalized.activeActivity).toBe('library')
    expect(normalized.activeSidebarPane).toBe('library')
    expect(normalized.activeBottomPanelTab).toBe('results')
    expect(normalized.bottomPanelHeight).toBe(260)
    expect(normalized.sidebarWidth).toBe(420)
    expect(normalized.rightDrawer).toBe('none')
    expect(normalized.rightDrawerWidth).toBe(320)
    expect(normalized.connectionGroupMode).toBe('none')
    expect(normalized.sidebarSectionStates).toEqual({ 'connections:none:all': true })
  })

  it('preserves query history as a first-class bottom panel tab', () => {
    const snapshot = createSeedSnapshot()
    const normalized = normalizeUiState({
      ...snapshot,
      ui: {
        ...snapshot.ui,
        activeBottomPanelTab: 'history',
        bottomPanelVisible: true,
      },
    })

    expect(normalized.activeBottomPanelTab).toBe('history')
    expect(normalized.bottomPanelVisible).toBe(true)
  })
})
