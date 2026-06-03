import { describe, expect, it } from 'vitest'
import type {
  ConnectionProfile,
  DataEditPlanRequest,
  DatastoreTreeNodeManifest,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import {
  buildDatastoreExperiences,
  executeDataEditLocally,
  planDataEditLocally,
} from './browser-datastore-platform'

describe('browser datastore platform contracts', () => {
  it('describes core-popular datastore experiences for builders and edits', () => {
    const experiences = buildDatastoreExperiences()
    const mongodb = experiences.find((item) => item.engine === 'mongodb')
    const postgres = experiences.find((item) => item.engine === 'postgresql')
    const redis = experiences.find((item) => item.engine === 'redis')
    const valkey = experiences.find((item) => item.engine === 'valkey')
    const timescale = experiences.find((item) => item.engine === 'timescaledb')

    expect(mongodb?.queryBuilders.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['mongo-find', 'mongo-aggregation']),
    )
    expect(mongodb?.editableScopes[0]?.editKinds).toContain('rename-field')
    expect(mongodb?.completeness).toMatchObject({
      readiness: 'near-native',
      completionClaim: 'contract-complete',
      targetPhase: 1,
    })
    expect(
      mongodb?.completeness?.criteria.find((item) => item.criterion === 'object-views')?.status,
    ).toBe('strong')
    expect(mongodb?.tree?.roots.map((item) => item.label)).toContain('{{database}}')
    expect(
      mongodb?.tree?.roots
        .find((item) => item.id === 'selected-database')
        ?.children?.map((item) => item.label),
    ).toContain('Time Series Collections')
    expect(postgres?.queryBuilders.map((item) => item.kind)).toContain('sql-select')
    expect(postgres?.queryBuilders.find((item) => item.kind === 'sql-select')?.defaultMode).toBe(
      'raw',
    )
    expect(postgres?.tree?.roots.map((item) => item.label)).toContain('User Schemas')
    expect(timescale?.queryBuilders.map((item) => item.kind)).toContain('sql-select')
    expect(timescale?.editableScopes[0]).toMatchObject({
      scope: 'table',
      editKinds: ['insert-row', 'update-row', 'delete-row'],
      liveExecution: false,
    })
    expect(redis?.editableScopes[0]?.editKinds).toContain('set-ttl')
    expect(redis?.tree?.roots.map((item) => item.label)).toContain('Databases')
    expect(redis?.tree?.roots.map((item) => item.label)).toContain('ACL / Security')
    for (const referenceExperience of [mongodb, redis, valkey]) {
      expect(referenceExperience?.editableScopes.every((scope) => !scope.liveExecution)).toBe(true)
    }
  })

  it('covers every core-popular engine with actions, renderers, diagnostics, and safety rules', () => {
    const experiences = buildDatastoreExperiences()

    for (const engine of [
      'postgresql',
      'cockroachdb',
      'sqlserver',
      'mysql',
      'mariadb',
      'sqlite',
      'mongodb',
      'redis',
      'valkey',
      'elasticsearch',
      'opensearch',
      'dynamodb',
      'cassandra',
    ]) {
      const experience = experiences.find((item) => item.engine === engine)

      expect(experience, `${engine} experience`).toBeDefined()
      expect(experience?.objectKinds.length, `${engine} object kinds`).toBeGreaterThan(0)
      expect(experience?.contextActions.map((item) => item.id), `${engine} actions`).toContain(
        'open-query',
      )
      expect(experience?.diagnosticsTabs.length, `${engine} diagnostics`).toBeGreaterThan(0)
      expect(experience?.resultRenderers.length, `${engine} renderers`).toBeGreaterThan(0)
      expect(experience?.safetyRules.join(' '), `${engine} safety`).toContain('Read-only')
      expect(experience?.tree?.emptyState, `${engine} tree empty state`).toBe('structural-folders')
      expect(experience?.tree?.roots.length, `${engine} tree roots`).toBeGreaterThan(0)
      expect(experience?.completeness?.criteria.length, `${engine} completeness`).toBeGreaterThan(0)
    }
  })

  it('keeps search and wide-column browser edit scopes plan-only while preserving native edit kinds', () => {
    const experiences = buildDatastoreExperiences()
    const elasticsearch = experiences.find((item) => item.engine === 'elasticsearch')
    const opensearch = experiences.find((item) => item.engine === 'opensearch')
    const dynamodb = experiences.find((item) => item.engine === 'dynamodb')
    const cassandra = experiences.find((item) => item.engine === 'cassandra')

    for (const searchExperience of [elasticsearch, opensearch]) {
      expect(searchExperience?.editableScopes[0]).toMatchObject({
        scope: 'index',
        editKinds: ['index-document', 'update-document', 'delete-document'],
        requiresPrimaryKey: true,
        liveExecution: false,
      })
    }

    expect(dynamodb?.editableScopes[0]).toMatchObject({
      scope: 'table',
      label: 'Items',
      editKinds: ['put-item', 'update-item', 'delete-item'],
      requiresPrimaryKey: true,
      liveExecution: false,
    })
    expect(cassandra?.editableScopes[0]).toMatchObject({
      scope: 'table',
      label: 'Rows',
      editKinds: ['update-row'],
      requiresPrimaryKey: true,
      liveExecution: false,
    })
  })

  it('exposes analytics SQL builders in browser preview without editable scopes', () => {
    const experiences = buildDatastoreExperiences()

    for (const engine of ['duckdb', 'clickhouse', 'snowflake', 'bigquery']) {
      const experience = experiences.find((item) => item.engine === engine)

      expect(experience?.queryBuilders).toContainEqual(
        expect.objectContaining({
          kind: 'sql-select',
          scope: 'table',
          defaultMode: 'raw',
        }),
      )
      expect(experience?.editableScopes, `${engine} edit scopes`).toEqual([])
    }
  })

  it('exposes time-series and graph query builders in browser preview without editable scopes', () => {
    const experiences = buildDatastoreExperiences()
    const expected = [
      ['prometheus', 'timeseries-query'],
      ['influxdb', 'timeseries-query'],
      ['opentsdb', 'timeseries-query'],
      ['neo4j', 'graph-query'],
      ['arango', 'graph-query'],
      ['janusgraph', 'graph-query'],
      ['neptune', 'graph-query'],
    ] as const

    for (const [engine, kind] of expected) {
      const experience = experiences.find((item) => item.engine === engine)

      expect(experience?.queryBuilders, `${engine} query builders`).toContainEqual(
        expect.objectContaining({
          kind,
          scope: 'query',
          defaultMode: 'split',
        }),
      )
      expect(experience?.editableScopes, `${engine} edit scopes`).toEqual([])
    }
  })

  it('keeps every datastore experience native, scoped, and free of fake sample placeholders', () => {
    const experiences = buildDatastoreExperiences()
    const engines = new Set<string>()

    for (const experience of experiences) {
      expect(engines.has(experience.engine), `${experience.engine} duplicate manifest`).toBe(false)
      engines.add(experience.engine)
      expect(experience.objectKinds.length, `${experience.engine} object kinds`).toBeGreaterThan(0)
      expect(experience.contextActions.length, `${experience.engine} context actions`).toBeGreaterThan(0)
      expect(experience.resultRenderers.length, `${experience.engine} renderers`).toBeGreaterThan(0)
      expect(experience.diagnosticsTabs.length, `${experience.engine} diagnostics`).toBeGreaterThan(0)
      expect(experience.safetyRules.join(' '), `${experience.engine} safety`).toContain('Read-only')
      expect(experience.testTemplates.length, `${experience.engine} test templates`).toBeGreaterThan(0)
      expect(experience.testAssertions.length, `${experience.engine} test assertions`).toBeGreaterThan(0)
      expect(experience.completeness?.criteria.length, `${experience.engine} completeness`).toBeGreaterThan(0)
      expect(experience.tree?.roots.length, `${experience.engine} tree roots`).toBeGreaterThan(0)

      for (const node of flattenTree(experience.tree?.roots ?? [])) {
        expect(node.id, `${experience.engine} node id`).toBeTruthy()
        expect(node.kind, `${experience.engine} node kind`).toBeTruthy()
        expect(node.label, `${experience.engine} node label`).toBeTruthy()
        expect(`${node.label} ${node.detail ?? ''}`, `${experience.engine} ${node.id}`).not.toMatch(
          /\b(sample_collection|sample_table|sample_object|sample:key|sample-index|sample_measurement|SampleLabel|placeholder)\b/i,
        )
      }
    }
  })

  it('plans MongoDB document field edits without mutating in preview mode', () => {
    const connection = connectionProfile('mongodb', 'document')
    const request: DataEditPlanRequest = {
      connectionId: connection.id,
      environmentId: 'env-dev',
      editKind: 'rename-field',
      target: {
        objectKind: 'document',
        path: ['products', 'item-1'],
        collection: 'products',
        documentId: 'item-1',
      },
      changes: [{ field: 'sku', newName: 'stockKeepingUnit' }],
    }

    const plan = planDataEditLocally(connection, request)

    expect(plan.executionSupport).toBe('plan-only')
    expect(plan.plan.requestLanguage).toBe('mongodb')
    expect(plan.plan.generatedRequest).toContain('"collection": "products"')
    expect(plan.plan.generatedRequest).toContain('"$rename"')
    expect(plan.plan.confirmationText).toBeUndefined()
  })

  it('plans MongoDB unset edits with nested paths and stable document-id filters', () => {
    const connection = connectionProfile('mongodb', 'document')
    const request: DataEditPlanRequest = {
      connectionId: connection.id,
      environmentId: 'env-dev',
      editKind: 'unset-field',
      target: {
        objectKind: 'document',
        path: ['products', 'item-1'],
        collection: 'products',
        documentId: { $oid: '507f1f77bcf86cd799439011' },
      },
      changes: [{ path: ['metadata', 'legacyFlag'] }],
    }

    const plan = planDataEditLocally(connection, request)
    const generated = JSON.parse(plan.plan.generatedRequest)

    expect(generated.filter._id).toEqual({ $oid: '507f1f77bcf86cd799439011' })
    expect(generated.update.$unset).toEqual({ 'metadata.legacyFlag': '' })
    expect(plan.plan.warnings.join(' ')).not.toContain('stable document id')
  })

  it('plans keyed SQL row updates with scan-impact guidance', () => {
    const connection = connectionProfile('postgresql', 'sql')
    const request: DataEditPlanRequest = {
      connectionId: connection.id,
      environmentId: 'env-dev',
      editKind: 'update-row',
      target: {
        objectKind: 'row',
        path: ['public', 'accounts', '1'],
        schema: 'public',
        table: 'accounts',
        primaryKey: { id: 1 },
      },
      changes: [{ field: 'name', value: 'DataPad++ Labs' }],
    }

    const plan = planDataEditLocally(connection, request)

    expect(plan.plan.requestLanguage).toBe('sql')
    expect(plan.plan.generatedRequest).toContain('update "public"."accounts"')
    expect(plan.plan.estimatedScanImpact).toContain('Single object')
  })

  it('emits SQL dialect-specific edit previews for SQL Server and MySQL-family engines', () => {
    const request: DataEditPlanRequest = {
      connectionId: 'conn-sqlserver',
      environmentId: 'env-dev',
      editKind: 'update-row',
      target: {
        objectKind: 'row',
        path: ['dbo', 'accounts', '1'],
        schema: 'dbo',
        table: 'accounts',
        primaryKey: { account_id: 1 },
      },
      changes: [{ field: 'display_name', value: 'DataPad++ Labs' }],
    }

    const sqlServerPlan = planDataEditLocally(connectionProfile('sqlserver', 'sql'), request)
    const mysqlPlan = planDataEditLocally(connectionProfile('mysql', 'sql'), {
      ...request,
      connectionId: 'conn-mysql',
      target: { ...request.target, schema: 'commerce' },
    })

    expect(sqlServerPlan.plan.generatedRequest).toContain(
      'update [dbo].[accounts] set [display_name] = @p1 where [account_id] = @p2;',
    )
    expect(mysqlPlan.plan.generatedRequest).toContain(
      'update `commerce`.`accounts` set `display_name` = ? where `account_id` = ?;',
    )
  })

  it('plans TimescaleDB row edits with SQL-shaped preview guardrails', () => {
    const plan = planDataEditLocally(connectionProfile('timescaledb', 'timeseries'), {
      connectionId: 'conn-timescaledb',
      environmentId: 'env-dev',
      editKind: 'update-row',
      target: {
        objectKind: 'row',
        path: ['metrics', 'conditions', '1'],
        schema: 'metrics',
        table: 'conditions',
        primaryKey: { id: 1 },
      },
      changes: [{ field: 'temperature', value: 72.5 }],
    })

    expect(plan.executionSupport).toBe('plan-only')
    expect(plan.plan.requestLanguage).toBe('sql')
    expect(plan.plan.requiredPermissions).toContain('update-row on table')
    expect(plan.plan.generatedRequest).toContain('update "metrics"."conditions"')
    expect(plan.plan.warnings.join(' ')).toContain('Preview mode')
    expect(plan.plan.warnings.join(' ')).not.toContain('Wide-column')
  })

  it('warns before unsafe or incomplete edit targets can be executed', () => {
    const sqlPlan = planDataEditLocally(connectionProfile('postgresql', 'sql'), {
      connectionId: 'conn-postgresql',
      environmentId: 'env-dev',
      editKind: 'update-row',
      target: { objectKind: 'row', path: [] },
      changes: [],
    })
    const redisPlan = planDataEditLocally(connectionProfile('redis', 'keyvalue'), {
      connectionId: 'conn-redis',
      environmentId: 'env-dev',
      editKind: 'set-key-value',
      target: { objectKind: 'key', path: [] },
      changes: [],
    })
    const cassandraPlan = planDataEditLocally(connectionProfile('cassandra', 'widecolumn'), {
      connectionId: 'conn-cassandra',
      environmentId: 'env-dev',
      editKind: 'update-row',
      target: { objectKind: 'row', path: ['commerce', 'orders'], table: 'orders' },
      changes: [{ field: 'status', value: 'paid' }],
    })

    expect(sqlPlan.plan.warnings.join(' ')).toContain('target table')
    expect(sqlPlan.plan.warnings.join(' ')).toContain('complete primary key')
    expect(sqlPlan.plan.warnings.join(' ')).toContain('at least one change')
    expect(redisPlan.plan.warnings.join(' ')).toContain('single concrete key')
    expect(cassandraPlan.plan.warnings.join(' ')).toContain('complete key conditions')
  })

  it('plans Redis, DynamoDB, and Cassandra native request shapes', () => {
    const redisPlan = planDataEditLocally(connectionProfile('redis', 'keyvalue'), {
      connectionId: 'conn-redis',
      environmentId: 'env-dev',
      editKind: 'set-ttl',
      target: { objectKind: 'key', path: ['session:1'], key: 'session:1' },
      changes: [{ value: 300 }],
    })
    const redisPersistPlan = planDataEditLocally(connectionProfile('redis', 'keyvalue'), {
      connectionId: 'conn-redis',
      environmentId: 'env-dev',
      editKind: 'persist-ttl',
      target: { objectKind: 'key', path: ['session:1'], key: 'session:1' },
      changes: [],
    })
    const redisRenamePlan = planDataEditLocally(connectionProfile('redis', 'keyvalue'), {
      connectionId: 'conn-redis',
      environmentId: 'env-dev',
      editKind: 'rename-key',
      target: { objectKind: 'key', path: ['session:1'], key: 'session:1' },
      changes: [{ field: 'session:1', newName: 'session:renamed' }],
    })
    const dynamoPlan = planDataEditLocally(connectionProfile('dynamodb', 'widecolumn'), {
      connectionId: 'conn-dynamodb',
      environmentId: 'env-dev',
      editKind: 'update-item',
      target: {
        objectKind: 'item',
        path: ['orders', 'order-1'],
        table: 'orders',
        itemKey: { pk: 'ORDER#1', sk: 'META' },
      },
      changes: [{ field: 'status', value: 'paid' }],
    })
    const cassandraPlan = planDataEditLocally(connectionProfile('cassandra', 'widecolumn'), {
      connectionId: 'conn-cassandra',
      environmentId: 'env-dev',
      editKind: 'update-row',
      target: {
        objectKind: 'row',
        path: ['commerce', 'orders'],
        schema: 'commerce',
        table: 'orders',
        primaryKey: { account_id: 'acct-1', order_id: 'order-1' },
      },
      changes: [{ field: 'status', value: 'paid' }],
    })

    expect(redisPlan.plan.generatedRequest).toBe('EXPIRE session:1 300')
    expect(redisPersistPlan.plan.generatedRequest).toBe('PERSIST session:1')
    expect(redisPersistPlan.plan.warnings).not.toContain('Data edits need at least one change.')
    expect(redisRenamePlan.plan.generatedRequest).toBe('RENAME session:1 session:renamed')
    expect(JSON.parse(dynamoPlan.plan.generatedRequest)).toMatchObject({
      TableName: 'orders',
      Key: { pk: 'ORDER#1', sk: 'META' },
      UpdateExpression: 'SET #field = :value',
    })
    expect(cassandraPlan.plan.generatedRequest).toContain(
      'update commerce.orders set status = ? where account_id = ? and order_id = ?;',
    )
  })

  it('plans search explicit-id document edits with HTTP-shaped preview guardrails', () => {
    const updatePlan = planDataEditLocally(connectionProfile('elasticsearch', 'search'), {
      connectionId: 'conn-elasticsearch',
      environmentId: 'env-dev',
      editKind: 'update-document',
      target: {
        objectKind: 'document',
        path: ['orders', '101'],
        table: 'orders',
        documentId: '101',
      },
      changes: [{ field: 'status', value: 'fulfilled' }],
    })
    const deletePlan = planDataEditLocally(connectionProfile('opensearch', 'search'), {
      connectionId: 'conn-opensearch',
      environmentId: 'env-dev',
      editKind: 'delete-document',
      target: {
        objectKind: 'document',
        path: ['orders', '101'],
        table: 'orders',
        documentId: '101',
      },
      changes: [],
    })

    expect(updatePlan.executionSupport).toBe('plan-only')
    expect(updatePlan.plan.requestLanguage).toBe('query-dsl')
    expect(updatePlan.plan.requiredPermissions).toContain('adapter-specific write permission')
    expect(updatePlan.plan.generatedRequest).toContain('"method": "POST"')
    expect(updatePlan.plan.generatedRequest).toContain('/orders/_update/101?refresh=true')
    expect(deletePlan.plan.destructive).toBe(true)
    expect(deletePlan.plan.confirmationText).toBe('CONFIRM OPENSEARCH DELETE-DOCUMENT')
  })

  it('never executes browser-preview data edits and reports confirmation/read-only blockers', () => {
    const connection = {
      ...connectionProfile('redis', 'keyvalue'),
      readOnly: true,
    }
    const response = executeDataEditLocally(connection, {
      connectionId: connection.id,
      environmentId: 'env-dev',
      editKind: 'delete-key',
      target: { objectKind: 'key', path: ['session:1'], key: 'session:1' },
      changes: [],
    })

    expect(response.executed).toBe(false)
    expect(response.plan.destructive).toBe(true)
    expect(response.warnings.join(' ')).toContain('read-only')
    expect(response.warnings.join(' ')).toContain(
      'This data edit needs confirmation before it can run',
    )
  })

  it('plans Mongo document uploads without requiring an existing document id', () => {
    const connection = connectionProfile('mongodb', 'document')
    const response = planDataEditLocally(connection, {
      connectionId: connection.id,
      environmentId: 'env-dev',
      editKind: 'insert-document',
      target: {
        objectKind: 'document',
        path: ['catalog', 'products'],
        database: 'catalog',
        collection: 'products',
      },
      changes: [{ value: { sku: 'nova', name: 'Nova Chair' }, valueType: 'json' }],
    })

    expect(response.plan.warnings.join(' ')).not.toContain('stable document id')
    expect(response.plan.requiredPermissions).toEqual(['insert collection document'])
    expect(JSON.parse(response.plan.generatedRequest)).toMatchObject({
      database: 'catalog',
      collection: 'products',
      operation: 'insertOne',
      document: { sku: 'nova', name: 'Nova Chair' },
    })
  })

  it('redacts secret-shaped values from browser data-edit previews', () => {
    const mongoPlan = planDataEditLocally(connectionProfile('mongodb', 'document'), {
      connectionId: 'conn-mongodb',
      environmentId: 'env-dev',
      editKind: 'insert-document',
      target: {
        objectKind: 'document',
        path: ['catalog', 'users'],
        collection: 'users',
      },
      changes: [{
        value: { username: 'testuser', password: 'open-sesame', token: 'abc123' },
        valueType: 'json',
      }],
    })
    const redisPlan = planDataEditLocally(connectionProfile('redis', 'keyvalue'), {
      connectionId: 'conn-redis',
      environmentId: 'env-dev',
      editKind: 'hash-set-field',
      target: {
        objectKind: 'key',
        path: ['account:1'],
        key: 'account:1',
      },
      changes: [{ field: 'password', value: 'open-sesame' }],
    })
    const dynamoPlan = planDataEditLocally(connectionProfile('dynamodb', 'widecolumn'), {
      connectionId: 'conn-dynamodb',
      environmentId: 'env-dev',
      editKind: 'update-item',
      target: {
        objectKind: 'item',
        path: ['users', 'user-1'],
        table: 'users',
        itemKey: { pk: 'USER#1' },
      },
      changes: [{ field: 'accessToken', value: 'abc123' }],
    })

    expect(mongoPlan.plan.generatedRequest).not.toContain('open-sesame')
    expect(mongoPlan.plan.generatedRequest).not.toContain('abc123')
    expect(JSON.parse(mongoPlan.plan.generatedRequest).document).toMatchObject({
      username: 'testuser',
      password: '********',
      token: '********',
    })
    expect(redisPlan.plan.generatedRequest).toBe('HSET account:1 password ********')
    expect(JSON.parse(dynamoPlan.plan.generatedRequest).ExpressionAttributeValues).toEqual({
      ':value': '********',
    })
  })

  it('warns instead of resolving secret variables in browser data-edit previews', () => {
    const connection = connectionProfile('mongodb', 'document')
    const snapshot = {
      connections: [connection],
      environments: [{
        id: 'env-dev',
        label: 'Dev',
        color: '#2dbf9b',
        risk: 'low',
        variables: {},
        sensitiveKeys: ['API_TOKEN'],
        variableDefinitions: [{
          key: 'API_TOKEN',
          kind: 'secret',
          secretRef: {
            id: 'secret-env-dev-api-token',
            provider: 'os-keyring',
            service: 'DataPad++',
            account: 'environment:env-dev:API_TOKEN',
            label: 'API token',
          },
        }],
        requiresConfirmation: false,
        safeMode: false,
        exportable: true,
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:00.000Z',
      }],
      preferences: {
        theme: 'dark',
        telemetry: 'opt-in',
        lockAfterMinutes: 15,
        safeModeEnabled: false,
      },
    } as unknown as WorkspaceSnapshot
    const request: DataEditPlanRequest = {
      connectionId: connection.id,
      environmentId: 'env-dev',
      editKind: 'insert-document',
      target: {
        objectKind: 'document',
        path: ['catalog', 'products'],
        collection: 'products',
      },
      changes: [{ value: { apiToken: '{{API_TOKEN}}' }, valueType: 'json' }],
    }

    const plan = planDataEditLocally(connection, request, snapshot)
    const response = executeDataEditLocally(connection, request, snapshot)

    expect(plan.plan.warnings).toContain(
      'Secret variable API_TOKEN is resolved only by the desktop secret store.',
    )
    expect(response.executed).toBe(false)
    expect(response.warnings).toContain(
      'Secret variable API_TOKEN cannot be resolved in browser preview.',
    )
    expect(JSON.parse(response.plan.generatedRequest).document.apiToken).toBe('{{API_TOKEN}}')
  })
})

function flattenTree(nodes: DatastoreTreeNodeManifest[]): DatastoreTreeNodeManifest[] {
  return nodes.flatMap((node) => [
    node,
    ...flattenTree(node.children ?? []),
  ])
}

function connectionProfile(
  engine: ConnectionProfile['engine'],
  family: ConnectionProfile['family'],
): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: `Fixture ${engine}`,
    engine,
    family,
    host: 'localhost',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    auth: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}
