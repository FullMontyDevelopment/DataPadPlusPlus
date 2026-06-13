import type { ConnectionProfile, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { buildOperationManifestsForConnection, executeOperationLocally, planOperationLocally } from '../../../src/services/runtime/browser-operations'

describe('browser operation runtime', () => {
  it('keeps risky and plan-only operation manifests explicit', () => {
    const connections = [mongoConnection, redisConnection, valkeyConnection, sqlServerConnection, postgresConnection, mysqlConnection, mariaDbConnection, searchConnection, dynamoConnection, cassandraConnection, prometheusConnection, influxConnection, openTsdbConnection, neo4jConnection, neptuneConnection, snowflakeConnection, bigQueryConnection, clickHouseConnection, cosmosConnection, liteDbConnection, memcachedConnection]

    for (const connection of connections) {
      const operations = buildOperationManifestsForConnection(connection)

      for (const operation of operations) {
        if (['write', 'destructive', 'costly'].includes(operation.risk)) {
          expect(operation.requiresConfirmation, `${operation.id} must require confirmation`).toBe(true)
        }

        if (operation.executionSupport !== 'live') {
          expect(operation.disabledReason?.trim(), `${operation.id} must explain why it is not live`).toBeTruthy()
        }
      }
    }
  })

  it('exposes guarded index visibility operations for MongoDB-capable profiles', () => {
    const operations = buildOperationManifestsForConnection(mongoConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mongodb.index.hide',
          label: 'Hide Index',
          risk: 'write',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.index.unhide',
          label: 'Unhide Index',
          risk: 'write',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.validation.update',
          label: 'Update Validation Rules',
          risk: 'write',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.database.create',
          label: 'Create Database',
          risk: 'write',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.database.drop',
          label: 'Drop Database',
          risk: 'destructive',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.collection.create',
          label: 'Create Collection',
          risk: 'write',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.collection.rename',
          label: 'Rename Collection',
          risk: 'write',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.collection.validate',
          label: 'Validate Collection',
          risk: 'costly',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.user.create',
          label: 'Create User',
          risk: 'write',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.user.drop',
          label: 'Drop User',
          risk: 'destructive',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.role.create',
          label: 'Create Role',
          risk: 'write',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.role.drop',
          label: 'Drop Role',
          risk: 'destructive',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.collection.export',
          label: 'Export Collection',
          risk: 'costly',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.collection.import',
          label: 'Import Documents',
          risk: 'write',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.gridfs.export',
          label: 'Export GridFS Files',
          risk: 'costly',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.gridfs.upload',
          label: 'Upload GridFS File',
          risk: 'write',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'mongodb.gridfs.validate',
          label: 'Validate GridFS Chunks',
          risk: 'costly',
          executionSupport: 'plan-only',
        }),
      ]),
    )
  })

  it('exposes Memcached known-key operation manifests without key browsing capabilities', () => {
    const operations = buildOperationManifestsForConnection(memcachedConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'memcached.stats.reset',
          label: 'Reset Stats',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'memcached.cache.flush',
          label: 'Flush Cache',
          risk: 'destructive',
        }),
        expect.objectContaining({
          id: 'memcached.key.get',
          label: 'Get Key',
          risk: 'read',
        }),
        expect.objectContaining({
          id: 'memcached.key.gets',
          label: 'Get Key With CAS',
          risk: 'read',
        }),
        expect.objectContaining({
          id: 'memcached.key.set',
          label: 'Set Key',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'memcached.key.touch',
          label: 'Touch Key',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'memcached.key.increment',
          label: 'Increment Key',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'memcached.key.decrement',
          label: 'Decrement Key',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'memcached.key.delete',
          label: 'Delete Key',
          risk: 'destructive',
        }),
      ]),
    )
    expect(operations.map((operation) => operation.id).join(' ')).not.toContain('key.browser')
  })

  it('generates MongoDB collMod previews for index hide and unhide requests', () => {
    const snapshot = {
      connections: [mongoConnection],
      environments: [
        {
          id: 'env-local',
          name: 'Local',
          label: 'Local',
          risk: 'low',
          variables: {},
          sensitiveKeys: [],
        },
      ],
      activeEnvironmentId: 'env-local',
      preferences: {
        theme: 'dark',
        telemetry: 'opt-in',
        lockAfterMinutes: 15,
        safeModeEnabled: false,
      },
    } as unknown as WorkspaceSnapshot

    const hidePlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.index.hide',
      objectName: 'products',
      parameters: {
        database: 'catalog',
        collection: 'products',
        indexName: 'sku_1',
      },
    })

    expect(JSON.parse(hidePlan.plan.generatedRequest)).toMatchObject({
      database: 'catalog',
      collMod: 'products',
      index: {
        name: 'sku_1',
        hidden: true,
      },
    })

    const unhidePlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.index.unhide',
      objectName: 'products',
      parameters: {
        database: 'catalog',
        collection: 'products',
        indexName: 'sku_1',
      },
    })

    expect(JSON.parse(unhidePlan.plan.generatedRequest)).toMatchObject({
      index: {
        hidden: false,
      },
    })
  })

  it('generates MongoDB security and validation previews without exposing secrets', () => {
    const snapshot = {
      connections: [mongoConnection],
      environments: [
        {
          id: 'env-local',
          name: 'Local',
          label: 'Local',
          risk: 'low',
          variables: {},
          sensitiveKeys: [],
        },
      ],
      activeEnvironmentId: 'env-local',
      preferences: {
        theme: 'dark',
        telemetry: 'opt-in',
        lockAfterMinutes: 15,
        safeModeEnabled: false,
      },
    } as unknown as WorkspaceSnapshot

    const validatorPlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.validation.update',
      objectName: 'products',
      parameters: {
        database: 'catalog',
        collection: 'products',
        validator: { $jsonSchema: { required: ['sku'] } },
      },
    })

    expect(JSON.parse(validatorPlan.plan.generatedRequest)).toMatchObject({
      database: 'catalog',
      collMod: 'products',
      validator: { $jsonSchema: { required: ['sku'] } },
    })

    const userPlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.user.create',
      objectName: 'reporting',
      parameters: {
        database: 'catalog',
        name: 'reporting',
        password: '{{MONGO_USER_PASSWORD}}',
        roles: [{ role: 'read', db: 'catalog' }],
      },
    })

    expect(JSON.parse(userPlan.plan.generatedRequest)).toMatchObject({
      database: 'catalog',
      createUser: 'reporting',
      pwd: '********',
      roles: [{ role: 'read', db: 'catalog' }],
    })
    expect(userPlan.plan.generatedRequest).not.toContain('{{MONGO_USER_PASSWORD}}')
    expect(userPlan.plan.generatedRequest).not.toContain('password')
  })

  it('generates MongoDB database and collection management command previews', () => {
    const snapshot = snapshotWith(mongoConnection)

    const createDatabasePlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.database.create',
      objectName: 'analytics',
      parameters: {
        database: 'analytics',
        collection: 'events',
        options: { capped: true, size: 1024 },
      },
    })
    expect(JSON.parse(createDatabasePlan.plan.generatedRequest)).toMatchObject({
      database: 'analytics',
      create: 'events',
      capped: true,
      size: 1024,
    })

    const renamePlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.collection.rename',
      objectName: 'products',
      parameters: {
        database: 'catalog',
        collection: 'products',
        newCollection: 'archived_products',
        targetDatabase: 'archive',
        dropTarget: true,
      },
    })
    expect(JSON.parse(renamePlan.plan.generatedRequest)).toMatchObject({
      database: 'admin',
      renameCollection: 'catalog.products',
      to: 'archive.archived_products',
      dropTarget: true,
    })

    const validatePlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.collection.validate',
      objectName: 'products',
      parameters: {
        database: 'catalog',
        collection: 'products',
        full: true,
      },
    })
    expect(JSON.parse(validatePlan.plan.generatedRequest)).toMatchObject({
      database: 'catalog',
      validate: 'products',
      full: true,
    })
    expect(validatePlan.plan.requiredPermissions).toEqual(['read metadata/query privilege'])
  })

  it('generates MongoDB collection import and export previews', () => {
    const snapshot = {
      connections: [mongoConnection],
      environments: [
        {
          id: 'env-local',
          name: 'Local',
          label: 'Local',
          risk: 'low',
          variables: {},
          sensitiveKeys: [],
        },
      ],
      activeEnvironmentId: 'env-local',
      preferences: {
        theme: 'dark',
        telemetry: 'opt-in',
        lockAfterMinutes: 15,
        safeModeEnabled: false,
      },
    } as unknown as WorkspaceSnapshot

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.collection.export',
      objectName: 'products',
      parameters: {
        database: 'catalog',
        collection: 'products',
        format: 'extended-json',
        filter: { active: true },
        projection: { sku: 1 },
        sort: { sku: 1 },
        batchSize: 500,
      },
    })
    expect(JSON.parse(exportPlan.plan.generatedRequest)).toMatchObject({
      database: 'catalog',
      collection: 'products',
      operation: 'export',
      workflow: 'mongodb.collection.export',
      format: 'extended-json',
      target: {
        kind: 'file',
        path: '<selected-file>.json',
      },
      filter: { active: true },
      projection: { sku: 1 },
      sort: { sku: 1 },
      batchSize: 500,
      serializer: {
        supportedFormats: ['json', 'extended-json', 'ndjson', 'csv', 'bson'],
      },
      executionGate: {
        owner: 'mongodb-adapter',
        defaultSupport: 'plan-only',
      },
    })

    const importPlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.collection.import',
      objectName: 'products',
      parameters: {
        database: 'catalog',
        collection: 'products',
        format: 'ndjson',
        mode: 'insertMany',
        validation: 'validate-before-write',
      },
    })
    expect(JSON.parse(importPlan.plan.generatedRequest)).toMatchObject({
      database: 'catalog',
      collection: 'products',
      operation: 'import',
      workflow: 'mongodb.collection.import',
      format: 'ndjson',
      source: {
        kind: 'file',
        path: '<selected-file>.ndjson',
      },
      mode: 'insertMany',
      validation: 'validate-before-write',
      parser: {
        supportedFormats: ['json', 'extended-json', 'ndjson', 'csv', 'bson'],
      },
      checks: ['file-readable', 'format-detected', 'document-shape', 'validator-compatible', 'duplicate-key-policy'],
      executionGate: {
        owner: 'mongodb-adapter',
        defaultSupport: 'plan-only',
      },
    })
    expect(importPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])
  })

  it('returns MongoDB-specific diagnostic preview payloads for metrics execution', () => {
    const execution = executeOperationLocally(snapshotWith(mongoConnection), {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.diagnostics.metrics',
      objectName: 'collection:catalog.products',
      confirmationText: 'CONFIRM MONGODB',
    })

    expect(execution.executed).toBe(true)
    expect(execution.diagnostics?.profiles).toEqual(expect.arrayContaining([expect.objectContaining({ summary: 'MongoDB current operations' }), expect.objectContaining({ summary: 'MongoDB replica set status' }), expect.objectContaining({ summary: 'MongoDB sharding state' })]))
    expect(execution.diagnostics?.metrics[0]).toMatchObject({
      renderer: 'metrics',
      metrics: expect.arrayContaining([
        expect.objectContaining({
          name: 'mongodb.current_operations',
          labels: { source: 'currentOp' },
        }),
        expect.objectContaining({
          name: 'mongodb.replica_state',
          labels: { source: 'replSetGetStatus' },
        }),
        expect.objectContaining({
          name: 'mongodb.sharding_enabled',
          labels: { source: 'shardingState' },
        }),
      ]),
    })
  })

  it('returns MySQL performance schema diagnostic preview payloads for metrics execution', () => {
    const execution = executeOperationLocally(snapshotWith(mysqlConnection), {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.diagnostics.metrics',
      objectName: 'mysql:diagnostics',
      confirmationText: 'CONFIRM MYSQL',
    })

    expect(execution.executed).toBe(true)
    expect(execution.plan.generatedRequest).toContain('performance_schema.events_statements_summary_by_digest')
    expect(execution.plan.generatedRequest).toContain('@@optimizer_trace')
    expect(execution.diagnostics?.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ summary: 'MySQL sessions, waits, and active statements' }),
      expect.objectContaining({ summary: 'MySQL performance_schema statement digests' }),
      expect.objectContaining({ summary: 'MySQL table and index I/O waits' }),
      expect.objectContaining({ summary: 'MySQL optimizer trace availability' }),
    ]))
    expect(execution.diagnostics?.metrics[0]).toMatchObject({
      renderer: 'metrics',
      metrics: expect.arrayContaining([
        expect.objectContaining({
          name: 'mysql.statement_digests_sampled',
          labels: { source: 'performance_schema.events_statements_summary_by_digest' },
        }),
        expect.objectContaining({
          name: 'mysql.table_io_operations',
          labels: expect.objectContaining({ source: 'performance_schema.table_io_waits_summary_by_index_usage' }),
        }),
      ]),
    })
  })

  it('returns MariaDB status, role, and ANALYZE diagnostic preview payloads for metrics execution', () => {
    const execution = executeOperationLocally(snapshotWith(mariaDbConnection), {
      connectionId: mariaDbConnection.id,
      environmentId: 'env-local',
      operationId: 'mariadb.diagnostics.metrics',
      objectName: 'mariadb:diagnostics',
      confirmationText: 'CONFIRM MARIADB',
    })

    expect(execution.executed).toBe(true)
    expect(execution.plan.generatedRequest).toContain("show variables like 'version%'")
    expect(execution.plan.generatedRequest).toContain('show engines')
    expect(execution.plan.generatedRequest).toContain('mysql.roles_mapping')
    expect(execution.plan.generatedRequest).toContain('analyze format=json select 1;')
    expect(execution.plan.generatedRequest).not.toContain('@@optimizer_trace')
    expect(execution.diagnostics?.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ summary: 'MariaDB sessions, waits, and active statements' }),
      expect.objectContaining({ summary: 'MariaDB performance_schema statement digests' }),
      expect.objectContaining({ summary: 'MariaDB table and index I/O waits' }),
      expect.objectContaining({ summary: 'MariaDB status variables and storage engines' }),
      expect.objectContaining({ summary: 'MariaDB ANALYZE FORMAT=JSON profile request' }),
    ]))
    expect(execution.diagnostics?.metrics[0]).toMatchObject({
      renderer: 'metrics',
      metrics: expect.arrayContaining([
        expect.objectContaining({
          name: 'mariadb.threads_running',
          labels: { source: 'SHOW GLOBAL STATUS' },
        }),
        expect.objectContaining({
          name: 'mariadb.aria_pagecache_reads',
          labels: { source: 'SHOW GLOBAL STATUS' },
        }),
        expect.objectContaining({
          name: 'mariadb.statement_digests_sampled',
          labels: { source: 'performance_schema.events_statements_summary_by_digest' },
        }),
      ]),
    })
  })

  it('generates MongoDB GridFS export, upload, and validation previews', () => {
    const snapshot = {
      connections: [mongoConnection],
      environments: [
        {
          id: 'env-local',
          name: 'Local',
          label: 'Local',
          risk: 'low',
          variables: {},
          sensitiveKeys: [],
        },
      ],
      activeEnvironmentId: 'env-local',
      preferences: {
        theme: 'dark',
        telemetry: 'opt-in',
        lockAfterMinutes: 15,
        safeModeEnabled: false,
      },
    } as unknown as WorkspaceSnapshot

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.gridfs.export',
      objectName: 'fs.files',
      parameters: {
        database: 'catalog',
        bucket: 'fs',
        filename: 'invoice.pdf',
        filesCollection: 'fs.files',
        chunksCollection: 'fs.chunks',
        format: 'binary',
      },
    })
    expect(JSON.parse(exportPlan.plan.generatedRequest)).toMatchObject({
      database: 'catalog',
      bucket: 'fs',
      operation: 'gridfs.export',
      filename: 'invoice.pdf',
      filesCollection: 'fs.files',
      chunksCollection: 'fs.chunks',
      format: 'binary',
      checks: ['file-metadata', 'chunk-sequence', 'missing-chunks'],
    })

    const uploadPlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.gridfs.upload',
      objectName: 'fs.files',
      parameters: {
        database: 'catalog',
        bucket: 'fs',
        source: '<selected-file>',
        filename: 'invoice.pdf',
        metadata: { tenant: 'qa' },
        validation: 'validate-before-write',
      },
    })
    expect(JSON.parse(uploadPlan.plan.generatedRequest)).toMatchObject({
      database: 'catalog',
      bucket: 'fs',
      operation: 'gridfs.upload',
      source: '<selected-file>',
      filename: 'invoice.pdf',
      metadata: { tenant: 'qa' },
      validation: 'validate-before-write',
    })
    expect(uploadPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const validatePlan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.gridfs.validate',
      objectName: 'fs.files',
      parameters: {
        database: 'catalog',
        bucket: 'fs',
      },
    })
    expect(JSON.parse(validatePlan.plan.generatedRequest)).toMatchObject({
      database: 'catalog',
      bucket: 'fs',
      operation: 'gridfs.validate',
      filesCollection: 'fs.files',
      chunksCollection: 'fs.chunks',
      checks: ['missing-chunks', 'orphaned-chunks', 'chunk-order'],
    })
  })

  it('exposes Redis key import and export operation previews', () => {
    const operations = buildOperationManifestsForConnection(redisConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'redis.key.export',
          label: 'Export Key',
          risk: 'costly',
          scope: 'key',
          executionSupport: 'plan-only',
        }),
        expect.objectContaining({
          id: 'redis.key.import',
          label: 'Import Key',
          risk: 'write',
          scope: 'key',
          executionSupport: 'plan-only',
        }),
      ]),
    )
  })

  it('generates Redis key import and export previews', () => {
    const snapshot = {
      connections: [redisConnection],
      environments: [
        {
          id: 'env-local',
          name: 'Local',
          label: 'Local',
          risk: 'low',
          variables: {},
          sensitiveKeys: [],
        },
      ],
      activeEnvironmentId: 'env-local',
      preferences: {
        theme: 'dark',
        telemetry: 'opt-in',
        lockAfterMinutes: 15,
        safeModeEnabled: false,
      },
    } as unknown as WorkspaceSnapshot

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: redisConnection.id,
      environmentId: 'env-local',
      operationId: 'redis.key.export',
      objectName: 'product:luna-lamp',
      parameters: {
        key: 'product:luna-lamp',
        redisType: 'hash',
        format: 'json',
        includeTtl: true,
        includeType: true,
        includeMetadata: true,
      },
    })

    expect(JSON.parse(exportPlan.plan.generatedRequest)).toMatchObject({
      operation: 'redis.key.export',
      workflow: 'redis.key-file-workflow',
      key: 'product:luna-lamp',
      type: 'hash',
      format: 'json',
      target: {
        kind: 'file',
        path: '<selected-file>.json',
        overwrite: false,
      },
      includeType: true,
      includeTtl: true,
      includeMetadata: true,
      memberRead: 'bounded',
      serializer: {
        supportedFormats: ['json', 'ndjson'],
        supportedTypes: ['string', 'hash', 'list', 'set', 'zset', 'stream', 'json', 'timeseries', 'vectorset', 'bloom', 'cuckoo', 'cms', 'topk', 'tdigest'],
        moduleTypes: {
          live: ['json', 'timeseries', 'vectorset', 'bloom', 'cuckoo', 'cms', 'topk', 'tdigest'],
          humanReadable: ['json', 'timeseries', 'vectorset'],
          snapshot: ['bloom', 'cuckoo', 'cms', 'topk', 'tdigest'],
          planOnly: [],
        },
      },
      executionGate: {
        defaultSupport: 'desktop-live',
        browserSupport: 'plan-only',
      },
    })
    expect(exportPlan.plan.requiredPermissions).toEqual(['read metadata/query privilege'])

    const importPlan = planOperationLocally(snapshot, {
      connectionId: redisConnection.id,
      environmentId: 'env-local',
      operationId: 'redis.key.import',
      objectName: 'product:luna-lamp',
      parameters: {
        key: 'product:luna-lamp',
        redisType: 'hash',
        mode: 'create-or-replace',
        ttl: 'preserve',
      },
    })

    expect(JSON.parse(importPlan.plan.generatedRequest)).toMatchObject({
      operation: 'redis.key.import',
      workflow: 'redis.key-file-workflow',
      key: 'product:luna-lamp',
      type: 'hash',
      source: {
        kind: 'file',
        path: '<selected-file>.json',
      },
      mode: 'create-or-replace',
      ttl: 'preserve',
      validation: 'validate-before-write',
      serializer: {
        acceptedFormats: ['json', 'ndjson'],
        acceptedTypes: ['string', 'hash', 'list', 'set', 'zset', 'stream', 'json', 'timeseries', 'vectorset', 'bloom', 'cuckoo', 'cms', 'topk', 'tdigest'],
        moduleTypes: {
          live: ['json', 'timeseries', 'vectorset', 'bloom', 'cuckoo', 'cms', 'topk', 'tdigest'],
          humanReadable: ['json', 'timeseries', 'vectorset'],
          snapshot: ['bloom', 'cuckoo', 'cms', 'topk', 'tdigest'],
          planOnly: [],
        },
      },
      executionGate: {
        defaultSupport: 'desktop-live',
        browserSupport: 'plan-only',
      },
    })
    expect(importPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])
  })

  it('generates Valkey key file previews without Redis Stack module serializers', () => {
    const snapshot = {
      connections: [valkeyConnection],
      environments: [
        {
          id: 'env-local',
          name: 'Local',
          label: 'Local',
          risk: 'low',
          variables: {},
          sensitiveKeys: [],
        },
      ],
      activeEnvironmentId: 'env-local',
      preferences: {
        theme: 'dark',
        telemetry: 'opt-in',
        lockAfterMinutes: 15,
        safeModeEnabled: false,
      },
    } as unknown as WorkspaceSnapshot

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: valkeyConnection.id,
      environmentId: 'env-local',
      operationId: 'valkey.key.export',
      objectName: 'session:1',
      parameters: {
        key: 'session:1',
        redisType: 'hash',
        format: 'json',
      },
    })

    expect(JSON.parse(exportPlan.plan.generatedRequest)).toMatchObject({
      operation: 'valkey.key.export',
      workflow: 'redis.key-file-workflow',
      key: 'session:1',
      type: 'hash',
      serializer: {
        supportedTypes: ['string', 'hash', 'list', 'set', 'zset', 'stream'],
        moduleTypes: {
          live: [],
          humanReadable: [],
          snapshot: [],
          planOnly: ['json', 'timeseries', 'vectorset', 'bloom', 'cuckoo', 'cms', 'topk', 'tdigest'],
        },
      },
      executionGate: {
        defaultSupport: 'desktop-live',
        browserSupport: 'plan-only',
      },
    })
    expect(exportPlan.plan.requiredPermissions).toEqual(['read metadata/query privilege'])

    const importPlan = planOperationLocally(snapshot, {
      connectionId: valkeyConnection.id,
      environmentId: 'env-local',
      operationId: 'valkey.key.import',
      objectName: 'session:1',
      parameters: {
        key: 'session:1',
        redisType: 'stream',
        mode: 'create-or-replace',
      },
    })

    expect(JSON.parse(importPlan.plan.generatedRequest)).toMatchObject({
      operation: 'valkey.key.import',
      workflow: 'redis.key-file-workflow',
      key: 'session:1',
      type: 'stream',
      serializer: {
        acceptedTypes: ['string', 'hash', 'list', 'set', 'zset', 'stream'],
        moduleTypes: {
          live: [],
          humanReadable: [],
          snapshot: [],
          planOnly: ['json', 'timeseries', 'vectorset', 'bloom', 'cuckoo', 'cms', 'topk', 'tdigest'],
        },
      },
      executionGate: {
        defaultSupport: 'desktop-live',
        browserSupport: 'plan-only',
      },
    })
    expect(importPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])
  })

  it('redacts secret-shaped scalar parameters in generated operation previews', () => {
    const snapshot = {
      connections: [mongoConnection],
      environments: [
        {
          id: 'env-local',
          name: 'Local',
          label: 'Local',
          risk: 'low',
          variables: {},
          sensitiveKeys: [],
        },
      ],
      activeEnvironmentId: 'env-local',
      preferences: {
        theme: 'dark',
        telemetry: 'opt-in',
        lockAfterMinutes: 15,
        safeModeEnabled: false,
      },
    } as unknown as WorkspaceSnapshot

    const plan = planOperationLocally(snapshot, {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.index.create',
      objectName: 'products',
      parameters: {
        database: 'catalog',
        collection: 'products',
        indexName: 'credentials_1',
        options: {
          password: 'open-sesame',
          token: 'abc123',
        },
      },
    })

    expect(plan.plan.generatedRequest).not.toContain('open-sesame')
    expect(plan.plan.generatedRequest).not.toContain('abc123')
    expect(JSON.parse(plan.plan.generatedRequest).indexes[0]).toMatchObject({
      password: '********',
      token: '********',
    })
  })

  it('warns instead of resolving secret variables in browser operation previews', () => {
    const snapshot = {
      connections: [mongoConnection],
      environments: [
        {
          id: 'env-local',
          name: 'Local',
          label: 'Local',
          risk: 'low',
          variables: {},
          sensitiveKeys: ['API_TOKEN'],
          variableDefinitions: [
            {
              key: 'API_TOKEN',
              kind: 'secret',
              secretRef: {
                id: 'secret-env-local-api-token',
                provider: 'os-keyring',
                service: 'DataPad++',
                account: 'environment:env-local:API_TOKEN',
                label: 'API token',
              },
            },
          ],
        },
      ],
      activeEnvironmentId: 'env-local',
      preferences: {
        theme: 'dark',
        telemetry: 'opt-in',
        lockAfterMinutes: 15,
        safeModeEnabled: false,
      },
    } as unknown as WorkspaceSnapshot

    const request = {
      connectionId: mongoConnection.id,
      environmentId: 'env-local',
      operationId: 'mongodb.user.create',
      objectName: 'reporting',
      parameters: {
        database: 'catalog',
        name: '{{API_TOKEN}}',
        roles: [{ role: 'read', db: 'catalog' }],
      },
    }
    const plan = planOperationLocally(snapshot, request)
    const execution = executeOperationLocally(snapshot, request)

    expect(plan.plan.warnings).toContain('Secret variable API_TOKEN is resolved only by the desktop secret store.')
    expect(execution.executed).toBe(false)
    expect(execution.warnings).toContain('Secret variable API_TOKEN cannot be resolved in browser preview.')
    expect(JSON.parse(execution.plan.generatedRequest).createUser).toBe('{{API_TOKEN}}')
  })

  it('generates dialect-aware SQL operation previews instead of generic selects', () => {
    const snapshot = snapshotWith(sqlServerConnection)

    const explainPlan = planOperationLocally(snapshot, {
      connectionId: sqlServerConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlserver.query.explain',
      objectName: '[dbo].[Accounts]',
      parameters: {
        schema: 'dbo',
        table: 'Accounts',
      },
    })

    expect(explainPlan.plan.generatedRequest).toContain('set showplan_text on')
    expect(explainPlan.plan.generatedRequest).toContain('select top (100) * from [dbo].[Accounts]')
    expect(explainPlan.plan.generatedRequest).not.toContain('limit 100')

    const profilePlan = planOperationLocally(snapshot, {
      connectionId: sqlServerConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlserver.query.profile',
      objectName: '[dbo].[Accounts]',
      parameters: {
        schema: 'dbo',
        table: 'Accounts',
      },
    })

    expect(profilePlan.plan.generatedRequest).toContain('set showplan_xml on')
    expect(profilePlan.plan.generatedRequest).toContain('select top (100) * from [dbo].[Accounts]')
    expect(profilePlan.plan.generatedRequest).not.toContain('statistics io')
    expect(profilePlan.plan.confirmationText).toBeTruthy()

    const indexPlan = planOperationLocally(snapshot, {
      connectionId: sqlServerConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlserver.index.create',
      objectName: '[dbo].[Accounts]',
      parameters: {
        columnName: 'account_id',
        indexName: 'IX_Accounts_account_id',
      },
    })

    expect(indexPlan.plan.generatedRequest).toContain('create index [IX_Accounts_account_id] on [dbo].[Accounts] ([account_id]);')
    expect(indexPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const mariaSnapshot = snapshotWith(mariaDbConnection)
    const mariaExplainPlan = planOperationLocally(mariaSnapshot, {
      connectionId: mariaDbConnection.id,
      environmentId: 'env-local',
      operationId: 'mariadb.query.explain',
      objectName: '`shop`.`orders`',
      parameters: {
        schema: 'shop',
        table: 'orders',
      },
    })

    expect(mariaExplainPlan.plan.generatedRequest).toContain('explain format=json select * from `shop`.`orders` limit 100;')

    const mariaProfilePlan = planOperationLocally(mariaSnapshot, {
      connectionId: mariaDbConnection.id,
      environmentId: 'env-local',
      operationId: 'mariadb.query.profile',
      objectName: '`shop`.`orders`',
      parameters: {
        schema: 'shop',
        table: 'orders',
      },
    })

    expect(mariaProfilePlan.plan.generatedRequest).toContain('MariaDB ANALYZE FORMAT=JSON executes the statement')
    expect(mariaProfilePlan.plan.generatedRequest).toContain('analyze format=json select * from `shop`.`orders` limit 100;')
  })

  it('exposes permission, import/export, and backup operation manifests for SQL-family engines', () => {
    const operations = buildOperationManifestsForConnection(postgresConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'postgresql.security.inspect',
          label: 'Inspect Permissions',
          risk: 'diagnostic',
        }),
        expect.objectContaining({
          id: 'postgresql.query.profile',
          label: 'Profile Query',
          risk: 'costly',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'postgresql.data.import-export',
          label: 'Import / Export',
          risk: 'costly',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'postgresql.data.backup-restore',
          label: 'Backup / Restore',
          risk: 'destructive',
          executionSupport: 'live',
          previewOnly: false,
        }),
      ]),
    )
  })

  it('generates SQL Server maintenance operation previews', () => {
    const operations = buildOperationManifestsForConnection(sqlServerConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sqlserver.statistics.update',
          label: 'Update Statistics',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'sqlserver.index.reorganize',
          label: 'Reorganize Index',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'sqlserver.index.rebuild',
          label: 'Rebuild Index',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'sqlserver.query-store.top-queries',
          label: 'Query Store Top Queries',
          risk: 'diagnostic',
        }),
        expect.objectContaining({
          id: 'sqlserver.data.import-export',
          label: 'Import / Export',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'sqlserver.data.backup-restore',
          label: 'Backup / Restore',
          executionSupport: 'live',
          previewOnly: false,
        }),
      ]),
    )

    const snapshot = snapshotWith(sqlServerConnection)
    const statsPlan = planOperationLocally(snapshot, {
      connectionId: sqlServerConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlserver.statistics.update',
      objectName: '[dbo].[Accounts]',
      parameters: {
        schema: 'dbo',
        table: 'Accounts',
      },
    })
    expect(statsPlan.plan.generatedRequest).toBe('update statistics [dbo].[Accounts] with fullscan;')
    expect(statsPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const rebuildPlan = planOperationLocally(snapshot, {
      connectionId: sqlServerConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlserver.index.rebuild',
      objectName: '[dbo].[Accounts]',
      parameters: {
        schema: 'dbo',
        table: 'Accounts',
        indexName: 'IX_Accounts_status',
      },
    })
    expect(rebuildPlan.plan.generatedRequest).toContain('alter index [IX_Accounts_status] on [dbo].[Accounts] rebuild with (online = on);')
    expect(rebuildPlan.plan.confirmationText).toBeTruthy()

    const queryStorePlan = planOperationLocally(snapshot, {
      connectionId: sqlServerConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlserver.query-store.top-queries',
      objectName: 'Query Store',
    })
    expect(queryStorePlan.plan.generatedRequest).toContain('from sys.query_store_query')
    expect(queryStorePlan.plan.requiredPermissions).toEqual(['read metadata/query privilege'])

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: sqlServerConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlserver.data.import-export',
      objectName: '[dbo].[Accounts]',
      parameters: {
        schema: 'dbo',
        table: 'Accounts',
        mode: 'export',
        format: 'csv',
      },
    })
    const exportRequest = JSON.parse(exportPlan.plan.generatedRequest)
    expect(exportRequest).toMatchObject({
      workflow: 'sqlserver.table.export',
      schema: 'dbo',
      table: 'Accounts',
      executionGate: {
        defaultSupport: 'live',
      },
    })

    const importPlan = planOperationLocally(snapshot, {
      connectionId: sqlServerConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlserver.data.import-export',
      objectName: '[dbo].[Accounts]',
      parameters: {
        schema: 'dbo',
        table: 'Accounts',
        mode: 'validate-only',
        format: 'csv',
      },
    })
    const importRequest = JSON.parse(importPlan.plan.generatedRequest)
    expect(importRequest).toMatchObject({
      workflow: 'sqlserver.table.import',
      executionGate: {
        defaultSupport: 'live',
      },
    })
    expect(importRequest.executionGate.guards).toContain('insertable target-column validation')

    const backupPlan = planOperationLocally(snapshot, {
      connectionId: sqlServerConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlserver.data.backup-restore',
      objectName: 'datapadplusplus',
      parameters: {
        mode: 'backup',
      },
    })
    const backupRequest = JSON.parse(backupPlan.plan.generatedRequest)
    expect(backupRequest).toMatchObject({
      workflow: 'sqlserver.database.backup',
      database: 'datapadplusplus',
      executionGate: {
        defaultSupport: 'live',
      },
    })
  })

  it('generates CockroachDB cluster and data-movement operation previews', () => {
    const operations = buildOperationManifestsForConnection(cockroachConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cockroachdb.cockroach.jobs',
          label: 'Browse Jobs',
          risk: 'diagnostic',
        }),
        expect.objectContaining({
          id: 'cockroachdb.cockroach.ranges',
          label: 'Review Ranges',
          risk: 'diagnostic',
        }),
        expect.objectContaining({
          id: 'cockroachdb.cockroach.contention',
          label: 'Analyze Contention',
          risk: 'diagnostic',
        }),
        expect.objectContaining({
          id: 'cockroachdb.cockroach.backup',
          label: 'Backup Database',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'cockroachdb.cockroach.restore',
          label: 'Restore Database',
          risk: 'destructive',
        }),
        expect.objectContaining({
          id: 'cockroachdb.cockroach.import',
          label: 'Import Data',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'cockroachdb.cockroach.export',
          label: 'Export Data',
          risk: 'costly',
        }),
      ]),
    )

    const snapshot = snapshotWith(cockroachConnection)
    const rangesPlan = planOperationLocally(snapshot, {
      connectionId: cockroachConnection.id,
      environmentId: 'env-local',
      operationId: 'cockroachdb.cockroach.ranges',
      objectName: '"public"."accounts"',
    })
    expect(rangesPlan.plan.generatedRequest).toContain('crdb_internal.ranges_no_leases')
    expect(rangesPlan.plan.requiredPermissions).toEqual(['read metadata/query privilege'])

    const backupPlan = planOperationLocally(snapshot, {
      connectionId: cockroachConnection.id,
      environmentId: 'env-local',
      operationId: 'cockroachdb.cockroach.backup',
      objectName: '"datapadplusplus"',
    })
    expect(backupPlan.plan.generatedRequest).toContain('backup database "datapadplusplus"')
    expect(backupPlan.plan.confirmationText).toBeTruthy()

    const importPlan = planOperationLocally(snapshot, {
      connectionId: cockroachConnection.id,
      environmentId: 'env-local',
      operationId: 'cockroachdb.cockroach.import',
      objectName: '"public"."accounts"',
    })
    expect(importPlan.plan.generatedRequest).toContain('import into "public"."accounts" csv data')
    expect(importPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: cockroachConnection.id,
      environmentId: 'env-local',
      operationId: 'cockroachdb.cockroach.export',
      objectName: '"public"."accounts"',
    })
    expect(exportPlan.plan.generatedRequest).toContain("export into csv 'external://export-location/data.csv'")
    expect(exportPlan.plan.requiredPermissions).toEqual(['read metadata/query privilege'])

    const genericExportPlan = planOperationLocally(snapshot, {
      connectionId: cockroachConnection.id,
      environmentId: 'env-local',
      operationId: 'cockroachdb.data.import-export',
      objectName: '"public"."accounts"',
      parameters: {
        mode: 'export',
        externalUri: 'external://exports/accounts.csv',
      },
    })
    expect(genericExportPlan.plan.generatedRequest).toContain("export into csv 'external://exports/accounts.csv'")
  })

  it('hides CockroachDB operation manifests for disabled profile capabilities', () => {
    const connection: ConnectionProfile = {
      ...cockroachConnection,
      postgresOptions: {
        cockroachCapabilities: {
          inspectJobs: true,
          inspectRanges: false,
          inspectRegions: true,
          inspectClusterStatus: true,
          inspectClusterSettings: true,
          inspectSessions: true,
          inspectContention: false,
          inspectRolesAndGrants: false,
          inspectCertificates: false,
          inspectZoneConfigurations: false,
          explainAnalyze: false,
        },
      },
    }
    const operationIds = buildOperationManifestsForConnection(connection).map(
      (operation) => operation.id,
    )

    expect(operationIds).toContain('cockroachdb.cockroach.jobs')
    expect(operationIds).toContain('cockroachdb.cockroach.regions')
    expect(operationIds).toContain('cockroachdb.cockroach.backup')
    expect(operationIds).toContain('cockroachdb.cockroach.import')
    expect(operationIds).toContain('cockroachdb.cockroach.export')
    expect(operationIds).not.toContain('cockroachdb.cockroach.ranges')
    expect(operationIds).not.toContain('cockroachdb.cockroach.contention')
    expect(operationIds).not.toContain('cockroachdb.cockroach.roles-grants')
    expect(operationIds).not.toContain('cockroachdb.cockroach.zone-configs')
  })

  it('generates PostgreSQL maintenance operation previews', () => {
    const operations = buildOperationManifestsForConnection(postgresConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'postgresql.routine.execute',
          label: 'Run Routine',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'postgresql.session.cancel',
          label: 'Cancel Query',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'postgresql.session.terminate',
          label: 'Terminate Backend',
          risk: 'destructive',
        }),
        expect.objectContaining({
          id: 'postgresql.table.analyze',
          label: 'Analyze Table',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'postgresql.table.vacuum',
          label: 'Vacuum Table',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'postgresql.index.reindex',
          label: 'Reindex',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'postgresql.role.grant',
          label: 'Grant Role',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'postgresql.extension.update',
          label: 'Update Extension',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'postgresql.extension.drop',
          label: 'Drop Extension',
          risk: 'destructive',
        }),
      ]),
    )

    const snapshot = snapshotWith(postgresConnection)
    const analyzePlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.table.analyze',
      objectName: '"public"."accounts"',
    })
    expect(analyzePlan.plan.generatedRequest).toBe('analyze verbose "public"."accounts";')
    expect(analyzePlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const vacuumPlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.table.vacuum',
      objectName: '"public"."accounts"',
    })
    expect(vacuumPlan.plan.generatedRequest).toBe('vacuum (verbose, analyze) "public"."accounts";')
    expect(vacuumPlan.plan.confirmationText).toBeTruthy()

    const reindexPlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.index.reindex',
      objectName: '"public"."accounts_name_idx"',
    })
    expect(reindexPlan.plan.generatedRequest).toContain('reindex index concurrently "public"."accounts_name_idx";')
    expect(reindexPlan.plan.confirmationText).toBeTruthy()

    const profilePlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.query.profile',
      objectName: '"public"."accounts"',
      parameters: {
        query: 'select * from "public"."accounts" where active = true limit 50',
        format: 'json',
      },
    })
    expect(profilePlan.plan.generatedRequest).toContain('PostgreSQL query profile executes the statement')
    expect(profilePlan.plan.generatedRequest).toContain('explain (analyze true, buffers true, verbose true, format json)')
    expect(profilePlan.plan.generatedRequest).toContain('where active = true limit 50;')
    expect(profilePlan.plan.requiredPermissions).toEqual(['read metadata/query privilege'])
    expect(profilePlan.plan.confirmationText).toBeTruthy()

    const routinePlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.routine.execute',
      objectName: '"public"."refresh_account"',
      parameters: {
        schema: 'public',
        routineName: 'refresh_account',
        routineKind: 'procedure',
        arguments: 'account_id integer, force boolean DEFAULT false',
      },
    })
    expect(routinePlan.plan.generatedRequest).toContain('call "public"."refresh_account"(')
    expect(routinePlan.plan.generatedRequest).toContain('account_id => $1')
    expect(routinePlan.plan.generatedRequest).toContain('force => $2')
    expect(routinePlan.plan.generatedRequest).toContain('-- $1 account_id integer')
    expect(routinePlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])
    expect(routinePlan.plan.confirmationText).toBeTruthy()

    const cancelPlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.session.cancel',
      objectName: '"Diagnostics"',
      parameters: {
        sessionPid: 101,
        sessionUser: 'app',
        sessionDatabase: 'datapadplusplus',
        sessionState: 'active',
      },
    })
    expect(cancelPlan.plan.generatedRequest).toContain('pg_cancel_backend(101)')
    expect(cancelPlan.plan.generatedRequest).toContain('pg_backend_pid() = 101')
    expect(cancelPlan.plan.generatedRequest).toContain('-- Target: pid 101, user app')
    expect(cancelPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])
    expect(cancelPlan.plan.confirmationText).toBeTruthy()

    const terminatePlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.session.terminate',
      objectName: '"Diagnostics"',
      parameters: { sessionPid: 101 },
    })
    expect(terminatePlan.plan.generatedRequest).toContain('pg_terminate_backend(101)')
    expect(terminatePlan.plan.generatedRequest).toContain('rolls back its active transaction')
    expect(terminatePlan.plan.destructive).toBe(true)
    expect(terminatePlan.plan.requiredPermissions).toEqual(['owner/admin role or equivalent destructive privilege'])

    const securityPlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.security.inspect',
      objectName: '"Security"',
    })
    expect(securityPlan.plan.generatedRequest).toContain('pg_auth_members')
    expect(securityPlan.plan.generatedRequest).toContain('pg_default_acl')
    expect(securityPlan.plan.requiredPermissions).toEqual(['read metadata/query privilege'])

    const grantPlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.role.grant',
      objectName: '"Security"',
      parameters: { roleName: 'app', memberOf: 'reporting' },
    })
    expect(grantPlan.plan.generatedRequest).toContain('grant "reporting" to "app";')
    expect(grantPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])
    expect(grantPlan.plan.confirmationText).toBeTruthy()

    const extensionPlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.extension.update',
      objectName: '"public"."uuid-ossp"',
      parameters: { extensionName: 'uuid-ossp' },
    })
    expect(extensionPlan.plan.generatedRequest).toContain('alter extension "uuid-ossp" update;')
    expect(extensionPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const dropExtensionPlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.extension.drop',
      objectName: '"public"."uuid-ossp"',
      parameters: { extensionName: 'uuid-ossp' },
    })
    expect(dropExtensionPlan.plan.generatedRequest).toContain('drop extension "uuid-ossp";')
    expect(dropExtensionPlan.plan.destructive).toBe(true)

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.data.import-export',
      objectName: '"public"."accounts"',
      parameters: {
        schema: 'public',
        table: 'accounts',
        mode: 'export',
        format: 'ndjson',
      },
    })
    expect(exportPlan.plan.generatedRequest).toContain('"workflow": "postgresql.table.export"')
    expect(exportPlan.plan.generatedRequest).toContain('"defaultSupport": "live"')
    expect(exportPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const importPlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.data.import-export',
      objectName: '"public"."accounts"',
      parameters: {
        schema: 'public',
        table: 'accounts',
        mode: 'validate-only',
        format: 'csv',
      },
    })
    expect(importPlan.plan.generatedRequest).toContain('"workflow": "postgresql.table.import"')
    expect(importPlan.plan.generatedRequest).toContain('type-aware target column validation')

    const backupPlan = planOperationLocally(snapshot, {
      connectionId: postgresConnection.id,
      environmentId: 'env-local',
      operationId: 'postgresql.data.backup-restore',
      objectName: '"postgres"',
      parameters: { mode: 'backup', format: 'json', tableLimit: 5 },
    })
    expect(backupPlan.plan.generatedRequest).toContain('"workflow": "postgresql.database.backup"')
    expect(backupPlan.plan.generatedRequest).toContain('full pg_dump/pg_restore restore execution remains preview-first')
    expect(backupPlan.plan.destructive).toBe(true)
  })

  it('generates MySQL-family table maintenance and event operation previews', () => {
    const operations = buildOperationManifestsForConnection(mysqlConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mysql.table.check',
          label: 'Check Table',
          risk: 'diagnostic',
          executionSupport: 'plan-only',
          previewOnly: true,
        }),
        expect.objectContaining({
          id: 'mysql.table.analyze',
          label: 'Analyze Table',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'mysql.table.repair',
          label: 'Repair Table',
          risk: 'destructive',
        }),
        expect.objectContaining({
          id: 'mysql.routine.execute',
          label: 'Run Routine',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'mysql.event.enable',
          label: 'Enable Event',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'mysql.user.lock',
          label: 'Lock User',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'mysql.data.import-export',
          label: 'Import / Export',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'mysql.data.backup-restore',
          label: 'Backup / Restore',
          executionSupport: 'live',
          previewOnly: false,
        }),
      ]),
    )

    const snapshot = snapshotWith(mysqlConnection)
    const checkPlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.table.check',
      objectName: '`shop`.`orders`',
    })
    const checkRequest = JSON.parse(checkPlan.plan.generatedRequest)
    expect(checkRequest).toMatchObject({
      workflow: 'mysql.table.maintenance',
      operation: 'check',
      database: 'shop',
      table: 'orders',
      statement: 'check table `shop`.`orders`;',
      executionGate: {
        defaultSupport: 'plan-only',
      },
    })
    expect(checkRequest.executionGate.requiredPrivileges).toContain('SELECT privilege on the target table')
    expect(checkPlan.plan.requiredPermissions).toEqual(['read metadata/query privilege'])

    const repairPlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.table.repair',
      objectName: '`shop`.`orders`',
    })
    const repairRequest = JSON.parse(repairPlan.plan.generatedRequest)
    expect(repairRequest).toMatchObject({
      workflow: 'mysql.table.maintenance',
      operation: 'repair',
      statement: 'repair table `shop`.`orders`;',
    })
    expect(repairRequest.executionGate.guards).toContain('require owner/admin confirmation and a recent backup before repair')
    expect(repairPlan.plan.destructive).toBe(true)

    const routinePlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.routine.execute',
      objectName: '`shop`.`refresh_rollups`',
      parameters: {
        database: 'shop',
        routineName: 'refresh_rollups',
        routineKind: 'procedure',
        arguments: 'IN account_id bigint, IN force_refresh tinyint(1)',
      },
    })
    const routineRequest = JSON.parse(routinePlan.plan.generatedRequest)
    expect(routineRequest).toMatchObject({
      workflow: 'mysql.routine.execute',
      database: 'shop',
      routine: 'refresh_rollups',
      routineKind: 'procedure',
    })
    expect(routineRequest.statement).toContain('call `shop`.`refresh_rollups`(')
    expect(routineRequest.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'account_id', direction: 'IN' }),
      expect.objectContaining({ name: 'force_refresh', direction: 'IN' }),
    ]))

    const eventPlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.event.disable',
      objectName: '`shop`.`refresh_rollups`',
    })
    const eventRequest = JSON.parse(eventPlan.plan.generatedRequest)
    expect(eventRequest).toMatchObject({
      workflow: 'mysql.event.toggle',
      operation: 'disable',
      database: 'shop',
      event: 'refresh_rollups',
      statement: 'alter event `shop`.`refresh_rollups` disable;',
    })
    expect(eventRequest.executionGate.requiredPrivileges).toContain('EVENT privilege on the schema')

    const securityPlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.security.inspect',
      objectName: '`shop`',
      parameters: { database: 'shop' },
    })
    const securityRequest = JSON.parse(securityPlan.plan.generatedRequest)
    expect(securityRequest).toMatchObject({
      workflow: 'mysql.security.inspect',
      database: 'shop',
      executionGate: {
        defaultSupport: 'live',
      },
    })
    expect(securityRequest.statements.join('\n')).toContain('information_schema.schema_privileges')

    const lockPlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.user.lock',
      objectName: '`shop`',
      parameters: { userName: 'reporting', userHost: '%' },
    })
    const lockRequest = JSON.parse(lockPlan.plan.generatedRequest)
    expect(lockRequest).toMatchObject({
      workflow: 'mysql.user.account-state',
      operation: 'lock',
      user: 'reporting',
      host: '%',
      statement: "alter user 'reporting'@'%' account lock;",
    })
    expect(lockRequest.executionGate.guards).toContain('verify user@host identity before generating ALTER USER')

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.data.import-export',
      objectName: '`shop`.`orders`',
      parameters: {
        database: 'shop',
        table: 'orders',
        mode: 'export',
        format: 'ndjson',
      },
    })
    const exportRequest = JSON.parse(exportPlan.plan.generatedRequest)
    expect(exportRequest).toMatchObject({
      workflow: 'mysql.table.export',
      database: 'shop',
      table: 'orders',
      executionGate: {
        defaultSupport: 'live',
      },
    })
    expect(exportRequest.executionGate.guards).toContain('bounded row export')

    const importPlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.data.import-export',
      objectName: '`shop`.`orders`',
      parameters: {
        database: 'shop',
        table: 'orders',
        mode: 'validate-only',
        format: 'csv',
      },
    })
    const importRequest = JSON.parse(importPlan.plan.generatedRequest)
    expect(importRequest).toMatchObject({
      workflow: 'mysql.table.import',
      executionGate: {
        defaultSupport: 'live',
      },
    })
    expect(importRequest.executionGate.guards).toContain('insertable target-column validation')

    const backupPlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.data.backup-restore',
      objectName: 'shop',
      parameters: { mode: 'backup', tableLimit: 5 },
    })
    const backupRequest = JSON.parse(backupPlan.plan.generatedRequest)
    expect(backupRequest).toMatchObject({
      workflow: 'mysql.database.backup',
      database: 'shop',
      executionGate: {
        defaultSupport: 'live',
      },
    })
    expect(backupRequest.executionGate.residualRisk).toContain('full mysqldump/mysql restore execution remains preview-first')
  })

  it('generates MariaDB table maintenance and role-aware security previews', () => {
    const operations = buildOperationManifestsForConnection(mariaDbConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mariadb.table.analyze',
          label: 'Analyze Table',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'mariadb.security.inspect',
          label: 'Inspect Permissions',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'mariadb.data.import-export',
          label: 'Import / Export',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'mariadb.data.backup-restore',
          label: 'Backup / Restore',
          executionSupport: 'live',
          previewOnly: false,
        }),
      ]),
    )

    const snapshot = snapshotWith(mariaDbConnection)
    const securityPlan = planOperationLocally(snapshot, {
      connectionId: mariaDbConnection.id,
      environmentId: 'env-local',
      operationId: 'mariadb.security.inspect',
      objectName: '`shop`',
      parameters: { database: 'shop' },
    })
    const securityRequest = JSON.parse(securityPlan.plan.generatedRequest)
    expect(securityRequest).toMatchObject({
      workflow: 'mariadb.security.inspect',
      database: 'shop',
      executionGate: {
        defaultSupport: 'live',
      },
    })
    expect(securityRequest.statements.join('\n')).toContain('is_role')
    expect(securityRequest.statements.join('\n')).toContain('mysql.roles_mapping')
    expect(securityRequest.executionGate.residualRisk).toContain('mysql.roles_mapping')

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: mariaDbConnection.id,
      environmentId: 'env-local',
      operationId: 'mariadb.data.import-export',
      objectName: '`commerce`.`orders`',
      parameters: {
        database: 'commerce',
        table: 'orders',
        mode: 'export',
        format: 'json',
      },
    })
    const exportRequest = JSON.parse(exportPlan.plan.generatedRequest)
    expect(exportRequest).toMatchObject({
      workflow: 'mariadb.table.export',
      database: 'commerce',
      table: 'orders',
      executionGate: {
        defaultSupport: 'live',
      },
    })

    const backupPlan = planOperationLocally(snapshot, {
      connectionId: mariaDbConnection.id,
      environmentId: 'env-local',
      operationId: 'mariadb.data.backup-restore',
      objectName: 'commerce',
      parameters: { mode: 'backup', tableLimit: 5 },
    })
    const backupRequest = JSON.parse(backupPlan.plan.generatedRequest)
    expect(backupRequest).toMatchObject({
      workflow: 'mariadb.database.backup',
      database: 'commerce',
      executionGate: {
        defaultSupport: 'live',
      },
    })
    expect(backupRequest.executionGate.residualRisk).toContain('mariadb-dump/mysql restore execution remains preview-first')
  })

  it('generates SQLite local-file maintenance operation previews', () => {
    const operations = buildOperationManifestsForConnection(sqliteConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sqlite.database.integrity-check',
          label: 'Integrity Check',
          risk: 'diagnostic',
        }),
        expect.objectContaining({
          id: 'sqlite.database.vacuum',
          label: 'Vacuum Database',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'sqlite.database.backup',
          label: 'Backup Database',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'sqlite.table.export',
          label: 'Export Table',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'sqlite.table.import',
          label: 'Import Rows',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'sqlite.index.reindex',
          label: 'Reindex',
          risk: 'write',
        }),
      ]),
    )

    const snapshot = snapshotWith(sqliteConnection)
    const integrityPlan = planOperationLocally(snapshot, {
      connectionId: sqliteConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlite.database.integrity-check',
      objectName: '[main]',
    })
    expect(integrityPlan.plan.generatedRequest).toBe('pragma quick_check;\npragma integrity_check;')
    expect(integrityPlan.plan.requiredPermissions).toEqual(['read metadata/query privilege'])

    const vacuumPlan = planOperationLocally(snapshot, {
      connectionId: sqliteConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlite.database.vacuum',
      objectName: '[main]',
    })
    expect(vacuumPlan.plan.generatedRequest).toContain('vacuum;')
    expect(vacuumPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])
    expect(vacuumPlan.plan.confirmationText).toBeTruthy()

    const backupPlan = planOperationLocally(snapshot, {
      connectionId: sqliteConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlite.database.backup',
      objectName: '[main]',
      parameters: { targetPath: 'C:\\fixtures\\backup.sqlite' },
    })
    expect(backupPlan.plan.generatedRequest).toContain('"workflow": "sqlite.database.backup"')
    expect(backupPlan.plan.generatedRequest).toContain('backup.sqlite')
    expect(backupPlan.plan.confirmationText).toBeTruthy()

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: sqliteConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlite.table.export',
      objectName: '[main].[accounts]',
      parameters: {
        targetPath: 'C:\\fixtures\\accounts.csv',
        format: 'csv',
        limit: 500,
      },
    })
    expect(exportPlan.plan.generatedRequest).toContain('"workflow": "sqlite.table.export"')
    expect(exportPlan.plan.generatedRequest).toContain('"table": "accounts"')
    expect(exportPlan.plan.generatedRequest).toContain('"limit": 500')

    const importPlan = planOperationLocally(snapshot, {
      connectionId: sqliteConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlite.table.import',
      objectName: '[main].[accounts]',
      parameters: { sourcePath: 'C:\\fixtures\\accounts.csv', mode: 'append' },
    })
    expect(importPlan.plan.generatedRequest).toContain('"workflow": "sqlite.table.import"')
    expect(importPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const reindexPlan = planOperationLocally(snapshot, {
      connectionId: sqliteConnection.id,
      environmentId: 'env-local',
      operationId: 'sqlite.index.reindex',
      objectName: '[accounts_name_idx]',
    })
    expect(reindexPlan.plan.generatedRequest).toBe('reindex [accounts_name_idx];')
  })

  it('generates TimescaleDB native policy and aggregate refresh previews', () => {
    const operations = buildOperationManifestsForConnection(timescaleConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'timescaledb.timescale.compression-policy',
          label: 'Compression Policy',
          risk: 'write',
          disabledReason: expect.stringContaining('live policy execution is disabled'),
        }),
        expect.objectContaining({
          id: 'timescaledb.timescale.retention-policy',
          label: 'Retention Policy',
          risk: 'destructive',
        }),
        expect.objectContaining({
          id: 'timescaledb.timescale.refresh-continuous-aggregate',
          label: 'Refresh Aggregate',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'timescaledb.timescale.job-control',
          label: 'Job Control',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'timescaledb.data.import-export',
          description: expect.stringContaining('bounded time windows'),
          disabledReason: expect.stringContaining('preview-first'),
        }),
        expect.objectContaining({
          id: 'timescaledb.data.backup-restore',
          description: expect.stringContaining('extension-version'),
          disabledReason: expect.stringContaining('preview-first'),
        }),
      ]),
    )

    const snapshot = snapshotWith(timescaleConnection)
    const compressionPlan = planOperationLocally(snapshot, {
      connectionId: timescaleConnection.id,
      environmentId: 'env-local',
      operationId: 'timescaledb.timescale.compression-policy',
      objectName: '"public"."order_metrics"',
      parameters: {
        schema: 'public',
        table: 'order_metrics',
        compressAfter: '7 days',
      },
    })
    expect(compressionPlan.plan.generatedRequest).toContain('execution boundary: compression policy stays plan-only')
    expect(compressionPlan.plan.generatedRequest).toContain('timescaledb_information.hypertables')
    expect(compressionPlan.plan.generatedRequest).toContain("select add_compression_policy('public.order_metrics', interval '7 days', if_not_exists => true);")
    expect(compressionPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const retentionPlan = planOperationLocally(snapshot, {
      connectionId: timescaleConnection.id,
      environmentId: 'env-local',
      operationId: 'timescaledb.timescale.retention-policy',
      objectName: '"public"."order_metrics"',
      parameters: {
        schema: 'public',
        table: 'order_metrics',
        dropAfter: '90 days',
      },
    })
    expect(retentionPlan.plan.generatedRequest).toContain('execution boundary: retention policy stays plan-only')
    expect(retentionPlan.plan.generatedRequest).toContain("select add_retention_policy('public.order_metrics', interval '90 days', if_not_exists => true);")
    expect(retentionPlan.plan.destructive).toBe(true)
    expect(retentionPlan.plan.requiredPermissions).toEqual(['owner/admin role or equivalent destructive privilege'])

    const refreshPlan = planOperationLocally(snapshot, {
      connectionId: timescaleConnection.id,
      environmentId: 'env-local',
      operationId: 'timescaledb.timescale.refresh-continuous-aggregate',
      objectName: '"observability"."hourly_order_metrics"',
      parameters: {
        schema: 'observability',
        table: 'hourly_order_metrics',
        startOffset: '3 days',
      },
    })
    expect(refreshPlan.plan.generatedRequest).toContain('execution boundary: continuous aggregate refresh stays plan-only')
    expect(refreshPlan.plan.generatedRequest).toContain('timescaledb_information.continuous_aggregates')
    expect(refreshPlan.plan.generatedRequest).toContain("refresh_continuous_aggregate('observability.hourly_order_metrics'")
    expect(refreshPlan.plan.confirmationText).toBeTruthy()

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: timescaleConnection.id,
      environmentId: 'env-local',
      operationId: 'timescaledb.data.import-export',
      objectName: '"public"."order_metrics"',
      parameters: {
        schema: 'public',
        table: 'order_metrics',
        mode: 'export',
        format: 'csv',
        start: '2026-05-01T00:00:00Z',
        end: '2026-06-01T00:00:00Z',
      },
    })
    expect(exportPlan.plan.generatedRequest).toContain('execution boundary: export file workflow stays plan-only')
    expect(exportPlan.plan.generatedRequest).toContain('timescaledb_information.chunks')
    expect(exportPlan.plan.generatedRequest).toContain('compression_settings')
    expect(exportPlan.plan.generatedRequest).toContain('copy (select * from "public"."order_metrics"')
    expect(exportPlan.plan.generatedRequest).toContain('"time" >= timestamp with time zone')

    const importPlan = planOperationLocally(snapshot, {
      connectionId: timescaleConnection.id,
      environmentId: 'env-local',
      operationId: 'timescaledb.data.import-export',
      objectName: '"public"."order_metrics"',
      parameters: {
        schema: 'public',
        table: 'order_metrics',
        mode: 'import',
        format: 'ndjson',
      },
    })
    expect(importPlan.plan.generatedRequest).toContain('execution boundary: import file workflow stays plan-only')
    expect(importPlan.plan.generatedRequest).toContain('datapad_timescale_import_payload')
    expect(importPlan.plan.generatedRequest).toContain('column mapping and chunk policy checks')

    const restorePlan = planOperationLocally(snapshot, {
      connectionId: timescaleConnection.id,
      environmentId: 'env-local',
      operationId: 'timescaledb.data.backup-restore',
      parameters: {
        mode: 'restore',
        database: 'metrics',
      },
    })
    expect(restorePlan.plan.generatedRequest).toContain('execution boundary: restore file workflow stays plan-only')
    expect(restorePlan.plan.generatedRequest).toContain('pg_restore --clean --if-exists --dbname=metrics')
    expect(restorePlan.plan.generatedRequest).toContain('timescaledb_information.continuous_aggregates')
    expect(restorePlan.plan.destructive).toBe(true)

    const jobPlan = planOperationLocally(snapshot, {
      connectionId: timescaleConnection.id,
      environmentId: 'env-local',
      operationId: 'timescaledb.timescale.job-control',
      parameters: {
        jobId: 1001,
        action: 'pause',
      },
    })
    expect(jobPlan.plan.generatedRequest).toContain('execution boundary: job-control workflow stays plan-only')
    expect(jobPlan.plan.generatedRequest).toContain('timescaledb_information.job_stats')
    expect(jobPlan.plan.generatedRequest).toContain('select alter_job(1001, scheduled => false);')
    expect(jobPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])
  })

  it('uses TimescaleDB profile-specific disabled reasons for policy manifests', () => {
    const operations = buildOperationManifestsForConnection({
      ...timescaleConnection,
      postgresOptions: {
        timescaleCompressionDisabledReason: 'Owner role required.',
        timescaleRetentionDisabledReason: 'Retention can drop chunks.',
        timescaleContinuousAggregateDisabledReason: 'Refresh is manually approved.',
      },
    })

    expect(operations.find((operation) => operation.id.endsWith('compression-policy'))).toMatchObject({
      disabledReason: 'Owner role required.',
    })
    expect(operations.find((operation) => operation.id.endsWith('retention-policy'))).toMatchObject({
      disabledReason: 'Retention can drop chunks.',
    })
    expect(operations.find((operation) => operation.id.endsWith('refresh-continuous-aggregate'))).toMatchObject({
      disabledReason: 'Refresh is manually approved.',
    })
  })

  it('generates DuckDB local analytics operation previews', () => {
    const operations = buildOperationManifestsForConnection(duckDbConnection)

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'duckdb.table.analyze',
          label: 'Analyze Table',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'duckdb.database.checkpoint',
          label: 'Checkpoint',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'duckdb.extension.load',
          label: 'Load Extension',
          risk: 'write',
          disabledReason:
            'DuckDB extension loading remains plan-only until installed-state and native-code execution gates are live.',
        }),
        expect.objectContaining({
          id: 'duckdb.file.import',
          label: 'Import File',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'duckdb.data.import-export',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'duckdb.data.backup-restore',
          risk: 'costly',
          executionSupport: 'live',
          previewOnly: false,
        }),
      ]),
    )

    const snapshot = snapshotWith(duckDbConnection)
    const analyzePlan = planOperationLocally(snapshot, {
      connectionId: duckDbConnection.id,
      environmentId: 'env-local',
      operationId: 'duckdb.table.analyze',
      objectName: '"main"."orders"',
    })
    const analyzeRequest = JSON.parse(analyzePlan.plan.generatedRequest)
    expect(analyzeRequest).toMatchObject({
      workflow: 'duckdb.table.analyze-preview',
      operation: 'analyze-table',
      target: {
        kind: 'table',
        name: '"main"."orders"',
      },
      statement: 'analyze "main"."orders";',
      adminScope: {
        executionPolicy: 'plan-only',
        dataOrCatalogMutation: false,
        requiresWriteAccess: true,
      },
      adminExecutionBoundary: {
        executionPolicy: 'scoped-out',
        nativeClaim: 'admin-preview-only',
        operation: 'analyze-table',
        localDatabaseMayChange: true,
        manualExecutionOutsideScopedClaim: true,
        excludedFromLiveFixtureClaim: true,
      },
      executionGate: {
        defaultSupport: 'plan-only',
      },
    })
    expect(analyzeRequest.adminExecutionBoundary.promotionRequires).toContain(
      'exclusive DuckDB writer lock evidence',
    )
    expect(analyzeRequest.adminExecutionBoundary.promotionRequires).toContain(
      'post-operation catalog or statistics validation',
    )
    expect(analyzeRequest.adminExecutionBoundary.blockedReasons).toContain(
      'duckdb-admin-execution-scoped-out',
    )
    expect(analyzeRequest.adminExecutionBoundary.blockedReasons).toContain('requires-write-access')
    expect(analyzeRequest.executionGate.guards).toContain('cross-process lock probe')
    expect(analyzeRequest.executionGate.guards).toContain('rollback or backup boundary review')
    expect(analyzePlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const extensionPlan = planOperationLocally(snapshot, {
      connectionId: duckDbConnection.id,
      environmentId: 'env-local',
      operationId: 'duckdb.extension.load',
      objectName: 'httpfs',
      parameters: { extensionName: 'httpfs' },
    })
    const extensionRequest = JSON.parse(extensionPlan.plan.generatedRequest)
    expect(extensionRequest).toMatchObject({
      workflow: 'duckdb.extension.load-preview',
      operation: 'load',
      extensionName: 'httpfs',
      statement: 'load httpfs;',
      extensionPreflight: {
        catalogProbe: 'duckdb_extensions()',
        installedState: 'desktop-preflight-required',
        nativeCodeExecution: 'blocked-until-explicit-live-gate',
      },
      extensionExecutionBoundary: {
        executionPolicy: 'scoped-out',
        nativeClaim: 'extension-preflight-only',
        operation: 'load',
        extensionName: 'httpfs',
        nativeCodeExecution: true,
        manualExecutionOutsideScopedClaim: true,
        excludedFromLiveFixtureClaim: true,
      },
      executionGate: {
        defaultSupport: 'plan-only',
      },
    })
    expect(extensionRequest.extensionExecutionBoundary.promotionRequires).toContain(
      'offline extension source provenance',
    )
    expect(extensionRequest.extensionExecutionBoundary.promotionRequires).toContain(
      'native-code trust review',
    )
    expect(extensionRequest.extensionExecutionBoundary.blockedReasons).toContain(
      'duckdb-extension-execution-scoped-out',
    )
    expect(extensionRequest.extensionExecutionBoundary.blockedReasons).toContain(
      'installed-state-live-check-required',
    )
    expect(extensionRequest.executionGate.guards).toContain('installed-before-load check')
    expect(extensionRequest.executionGate.guards).toContain('native extension code execution review')

    const importPlan = planOperationLocally(snapshot, {
      connectionId: duckDbConnection.id,
      environmentId: 'env-local',
      operationId: 'duckdb.file.import',
      objectName: '"main"."orders_import"',
      parameters: { sourceFormat: 'csv', tableName: '"main"."orders_import"' },
    })
    expect(importPlan.plan.generatedRequest).toContain('read_csv_auto')
    expect(importPlan.plan.generatedRequest).toContain('create or replace table "main"."orders_import"')

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: duckDbConnection.id,
      environmentId: 'env-local',
      operationId: 'duckdb.data.import-export',
      objectName: '"main"."orders"',
      parameters: {
        mode: 'export',
        format: 'parquet',
        targetPath: 'C:\\exports\\orders.parquet',
        rowLimit: 25,
      },
    })
    const exportRequest = JSON.parse(exportPlan.plan.generatedRequest)
    expect(exportRequest).toMatchObject({
      workflow: 'duckdb.table.export',
      schema: 'main',
      table: 'orders',
      format: 'parquet',
      rowLimit: 25,
      formatPreflight: {
        extensionBacked: true,
        requiredExtension: 'parquet',
        extensionExecutionBoundary: {
          executionPolicy: 'preloaded-extension-required',
          nativeClaim: 'preloaded-extension-only',
          requiredExtension: 'parquet',
          networkAutoloadAllowed: false,
          extensionInstallExecutionIncluded: false,
        },
      },
      databaseLockBoundary: {
        policy: 'desktop-preflight-required',
        workflow: 'duckdb.table.export',
        requiresWriteAccess: false,
        exclusiveWriterLockValidated: false,
      },
      executionGate: {
        owner: 'duckdb-adapter',
        defaultSupport: 'live',
      },
    })
    expect(exportRequest.databaseLockBoundary.checks).toContain('filesystem read-open probe')
    expect(exportRequest.databaseLockBoundary.checks).toContain('DuckDB adapter open probe')
    expect(exportRequest.databaseLockBoundary.scopedResiduals).toContain(
      'external process contention is not part of the default fixture claim',
    )
    expect(exportRequest.executionGate.guards).toContain('bounded row export')
    expect(exportRequest.formatPreflight.extensionExecutionBoundary.promotionRequires).toContain(
      'offline extension source provenance',
    )
    expect(exportRequest.formatPreflight.extensionExecutionBoundary.blockedReasons).toContain(
      'extension-install-load-scoped-out',
    )
    expect(exportRequest.executionGate.guards).toContain('database file read/open preflight')
    expect(exportRequest.executionGate.guards).toContain('format capability preflight')
    expect(exportRequest.executionGate.guards).toContain('JSON/Parquet extension catalog probe')

    const genericImportPlan = planOperationLocally(snapshot, {
      connectionId: duckDbConnection.id,
      environmentId: 'env-local',
      operationId: 'duckdb.data.import-export',
      objectName: '"main"."orders_import"',
      parameters: {
        mode: 'import',
        sourceFormat: 'csv',
        sourcePath: 'C:\\imports\\orders.csv',
        targetTable: '"main"."orders_import"',
      },
    })
    const genericImportRequest = JSON.parse(genericImportPlan.plan.generatedRequest)
    expect(genericImportRequest).toMatchObject({
      workflow: 'duckdb.table.import',
      mode: 'import',
      schema: 'main',
      table: 'orders_import',
      format: 'csv',
      formatPreflight: {
        extensionBacked: false,
        requiredExtension: null,
        extensionExecutionBoundary: {
          executionPolicy: 'bundled-native',
          nativeClaim: 'bundled-csv-reader-writer',
          networkAutoloadAllowed: false,
          extensionInstallExecutionIncluded: false,
        },
      },
      databaseLockBoundary: {
        policy: 'desktop-preflight-required',
        workflow: 'duckdb.table.import',
        requiresWriteAccess: true,
        exclusiveWriterLockValidated: false,
      },
      executionGate: {
        defaultSupport: 'live',
      },
    })
    expect(genericImportRequest.databaseLockBoundary.checks).toContain('filesystem write-open probe')
    expect(genericImportRequest.databaseLockBoundary.promotionRequires).toContain(
      'exclusive DuckDB writer lock acquisition evidence',
    )
    expect(genericImportRequest.executionGate.guards).toContain('read-only connection blocked')
    expect(genericImportRequest.executionGate.guards).toContain('database file access/read-only preflight')
    expect(genericImportRequest.executionGate.guards).toContain('format capability preflight')

    const backupPlan = planOperationLocally(snapshot, {
      connectionId: duckDbConnection.id,
      environmentId: 'env-local',
      operationId: 'duckdb.data.backup-restore',
      objectName: 'main',
      parameters: {
        mode: 'backup',
        targetPath: 'C:\\exports\\duckdb-backup',
      },
    })
    const backupRequest = JSON.parse(backupPlan.plan.generatedRequest)
    expect(backupRequest).toMatchObject({
      workflow: 'duckdb.database.backup',
      databaseLockBoundary: {
        policy: 'desktop-preflight-required',
        workflow: 'duckdb.database.backup',
        requiresWriteAccess: false,
      },
      executionGate: {
        defaultSupport: 'live',
      },
    })
    expect(backupRequest.executionGate.guards).toContain('database file read/open preflight')
    expect(backupRequest.executionGate.guards).toContain('format capability preflight')
    expect(backupRequest.executionGate.residualRisk).toContain('restore execution remains preview-first')

    const restorePlan = planOperationLocally(snapshot, {
      connectionId: duckDbConnection.id,
      environmentId: 'env-local',
      operationId: 'duckdb.data.backup-restore',
      objectName: 'main',
      parameters: {
        mode: 'restore',
        sourcePath: 'C:\\exports\\duckdb-backup',
      },
    })
    const restoreRequest = JSON.parse(restorePlan.plan.generatedRequest)
    expect(restoreRequest).toMatchObject({
      workflow: 'duckdb.database.restore-preview',
      restorePreflight: {
        sourcePackageValidated: 'desktop-preflight-required',
        operationValidated: false,
      },
      databaseLockBoundary: {
        policy: 'desktop-preflight-required',
        workflow: 'duckdb.database.restore-preview',
        requiresWriteAccess: true,
        exclusiveWriterLockValidated: false,
      },
      restoreExecutionBoundary: {
        executionPolicy: 'scoped-out',
        nativeClaim: 'restore-preflight-only',
        destructive: true,
      },
      executionGate: {
        defaultSupport: 'plan-only',
      },
    })
    expect(restoreRequest.restorePreflight.checks).toContain('schema.sql marker')
    expect(restoreRequest.restorePreflight.checks).toContain('load.sql marker')
    expect(restoreRequest.executionGate.guards).toContain('absolute restore source folder')
    expect(restoreRequest.executionGate.guards).toContain('source folder readability preflight')
    expect(restoreRequest.executionGate.guards).toContain('schema.sql/load.sql package marker check')
    expect(restoreRequest.executionGate.guards).toContain('target database write/open preflight')
    expect(restoreRequest.executionGate.guards).toContain('restore execution explicitly scoped out of native claim')
    expect(restoreRequest.restoreExecutionBoundary.promotionRequires).toContain(
      'target snapshot or rollback artifact before IMPORT DATABASE',
    )
    expect(restoreRequest.restoreExecutionBoundary.blockedReasons).toContain('restore-execution-scoped-out')
  })

  it('generates search-family profile, index, and security operation previews', () => {
    const snapshot = snapshotWith(searchConnection)
    const operations = buildOperationManifestsForConnection(searchConnection)
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'elasticsearch.index.force-merge',
          label: 'Force Merge',
        }),
        expect.objectContaining({
          id: 'elasticsearch.index.reindex',
          label: 'Reindex',
        }),
        expect.objectContaining({
          id: 'elasticsearch.alias.put',
          label: 'Add Alias',
        }),
        expect.objectContaining({
          id: 'elasticsearch.lifecycle.explain',
          label: 'Explain ILM',
        }),
        expect.objectContaining({
          id: 'elasticsearch.pipeline.simulate',
          label: 'Simulate Pipeline',
        }),
        expect.objectContaining({
          id: 'elasticsearch.pipeline.put',
          label: 'Update Pipeline',
        }),
        expect.objectContaining({
          id: 'elasticsearch.snapshot.restore',
          label: 'Restore Snapshot',
        }),
        expect.objectContaining({
          id: 'elasticsearch.diagnostics.slow-log',
          label: 'Slow Log Plan',
        }),
        expect.objectContaining({
          id: 'elasticsearch.diagnostics.allocation',
          label: 'Allocation Explain',
        }),
      ]),
    )

    const profilePlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.query.profile',
      objectName: 'products-v1',
      parameters: {
        query: { term: { active: true } },
        size: 20,
      },
    })
    expect(JSON.parse(profilePlan.plan.generatedRequest)).toMatchObject({
      method: 'POST',
      path: '/products-v1/_search',
      body: {
        profile: true,
        query: { term: { active: true } },
        size: 20,
      },
    })

    const dropPlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.index.drop',
      objectName: 'products-v1',
    })
    expect(JSON.parse(dropPlan.plan.generatedRequest)).toMatchObject({
      method: 'DELETE',
      path: '/products-v1',
    })
    expect(dropPlan.plan.destructive).toBe(true)

    const securityPlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.security.inspect',
      objectName: 'security',
    })
    expect(JSON.parse(securityPlan.plan.generatedRequest)).toMatchObject({
      method: 'GET',
      path: '/_security/role',
    })

    const mappingPlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.index.put-mapping',
      objectName: 'products-v1',
      parameters: {
        mappings: {
          properties: {
            embedding: { type: 'dense_vector', dims: 384 },
          },
        },
      },
    })
    expect(JSON.parse(mappingPlan.plan.generatedRequest)).toMatchObject({
      method: 'PUT',
      path: '/products-v1/_mapping',
      body: {
        properties: {
          embedding: { type: 'dense_vector', dims: 384 },
        },
      },
    })

    const aliasPlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.alias.put',
      objectName: 'products-v1',
      parameters: {
        alias: 'products-read',
      },
    })
    expect(JSON.parse(aliasPlan.plan.generatedRequest)).toMatchObject({
      method: 'POST',
      path: '/_aliases',
      body: {
        actions: [
          {
            add: {
              index: 'products-v1',
              alias: 'products-read',
            },
          },
        ],
      },
    })

    const lifecyclePlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.lifecycle.explain',
      objectName: 'products-v1',
    })
    expect(JSON.parse(lifecyclePlan.plan.generatedRequest)).toMatchObject({
      method: 'GET',
      path: '/products-v1/_ilm/explain',
    })

    const forceMergePlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.index.force-merge',
      objectName: 'products-v1',
      parameters: { maxNumSegments: 1 },
    })
    expect(JSON.parse(forceMergePlan.plan.generatedRequest)).toMatchObject({
      method: 'POST',
      path: '/products-v1/_forcemerge',
      body: { max_num_segments: 1 },
    })
    expect(forceMergePlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const reindexPlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.index.reindex',
      objectName: 'products-v1',
      parameters: { destinationIndex: 'products-v2' },
    })
    expect(JSON.parse(reindexPlan.plan.generatedRequest)).toMatchObject({
      method: 'POST',
      path: '/_reindex',
      body: {
        source: { index: 'products-v1' },
        dest: { index: 'products-v2' },
      },
    })

    const pipelinePlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.pipeline.put',
      objectName: 'normalize-products',
    })
    expect(JSON.parse(pipelinePlan.plan.generatedRequest)).toMatchObject({
      method: 'PUT',
      path: '/_ingest/pipeline/normalize-products',
      body: { description: 'DataPad++ pipeline preview' },
    })

    const simulatePlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.pipeline.simulate',
      objectName: 'normalize-products',
    })
    expect(JSON.parse(simulatePlan.plan.generatedRequest)).toMatchObject({
      method: 'POST',
      path: '/_ingest/pipeline/normalize-products/_simulate',
      body: { docs: [] },
    })
    expect(simulatePlan.plan.generatedRequest).not.toContain('sample')

    const taskPlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.task.cancel',
      objectName: 'node-a:123',
      parameters: { taskId: 'node-a:123' },
    })
    expect(JSON.parse(taskPlan.plan.generatedRequest)).toMatchObject({
      method: 'POST',
      path: '/_tasks/node-a%3A123/_cancel',
    })

    const slowLogPlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.diagnostics.slow-log',
      objectName: 'products-v1',
    })
    expect(JSON.parse(slowLogPlan.plan.generatedRequest)).toMatchObject({
      operation: 'Search.SlowLogDashboardPlan',
      requests: expect.arrayContaining([
        { method: 'GET', path: '/_settings?filter_path=**.search.slowlog*' },
        { method: 'GET', path: '/_nodes/stats/indices/search,indexing' },
      ]),
      executionGate: {
        defaultSupport: 'plan-only',
        runtimeEvidence: 'live',
      },
    })

    const allocationPlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.diagnostics.allocation',
      objectName: 'products-v1',
    })
    expect(JSON.parse(allocationPlan.plan.generatedRequest)).toMatchObject({
      operation: 'Search.AllocationExplainPlan',
      requests: expect.arrayContaining([
        { method: 'GET', path: '/_cluster/allocation/explain' },
        { method: 'GET', path: '/_cat/shards?format=json&bytes=b' },
      ]),
      executionGate: {
        defaultSupport: 'plan-only',
        runtimeEvidence: 'live',
      },
    })

    const importExportPlan = planOperationLocally(snapshot, {
      connectionId: searchConnection.id,
      environmentId: 'env-local',
      operationId: 'elasticsearch.data.import-export',
      objectName: 'products-v1',
    })
    expect(JSON.parse(importExportPlan.plan.generatedRequest)).toMatchObject({
      method: 'POST',
      path: '/products-v1/_search',
      executionGate: {
        defaultSupport: 'plan-only',
        disabledReasons: expect.arrayContaining([
          expect.stringContaining('preview-first'),
          expect.stringContaining('plain HTTP'),
        ]),
      },
    })
  })

  it('generates DynamoDB capacity, index, access, and export operation previews', () => {
    const snapshot = snapshotWith(dynamoConnection)
    const operations = buildOperationManifestsForConnection(dynamoConnection)
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dynamodb.capacity.update',
          label: 'Update Capacity',
        }),
        expect.objectContaining({
          id: 'dynamodb.ttl.update',
          label: 'Update TTL',
        }),
        expect.objectContaining({
          id: 'dynamodb.streams.update',
          label: 'Update Streams',
        }),
        expect.objectContaining({
          id: 'dynamodb.backup.create',
          label: 'Create Backup',
        }),
        expect.objectContaining({
          id: 'dynamodb.backup.restore',
          label: 'Restore Backup',
        }),
        expect.objectContaining({
          id: 'dynamodb.data.backup-restore',
          label: 'Backup / Restore',
        }),
      ]),
    )

    const metricsPlan = planOperationLocally(snapshot, {
      connectionId: dynamoConnection.id,
      environmentId: 'env-local',
      operationId: 'dynamodb.diagnostics.metrics',
      objectName: 'Orders',
      parameters: {
        tableName: 'Orders',
        region: 'local',
      },
    })
    expect(JSON.parse(metricsPlan.plan.generatedRequest)).toMatchObject({
      operation: 'CloudWatch.GetMetricData',
      namespace: 'AWS/DynamoDB',
      tableName: 'Orders',
      metrics: expect.arrayContaining(['ConsumedReadCapacityUnits', 'ReadThrottleEvents']),
      authEvidence: {
        scheme: 'AWS4-HMAC-SHA256',
        endpointMode: 'local-http',
        liveCloudRuntime: false,
        signedHeaders: expect.arrayContaining(['x-amz-date', 'x-amz-target']),
      },
      disabledReasons: expect.arrayContaining([
        expect.stringContaining('CloudWatch account/table metrics'),
      ]),
    })

    const indexPlan = planOperationLocally(snapshot, {
      connectionId: dynamoConnection.id,
      environmentId: 'env-local',
      operationId: 'dynamodb.index.create',
      objectName: 'Orders',
      parameters: {
        tableName: 'Orders',
        indexName: 'customer-status-index',
        partitionKey: 'customerId',
        projection: 'ALL',
      },
    })
    expect(JSON.parse(indexPlan.plan.generatedRequest)).toMatchObject({
      operation: 'DynamoDB.UpdateTable',
      tableName: 'Orders',
      globalSecondaryIndexUpdates: [
        {
          create: {
            indexName: 'customer-status-index',
            keySchema: [{ attributeName: 'customerId', keyType: 'HASH' }],
          },
        },
      ],
    })

    const capacityPlan = planOperationLocally(snapshot, {
      connectionId: dynamoConnection.id,
      environmentId: 'env-local',
      operationId: 'dynamodb.capacity.update',
      objectName: 'Orders',
      parameters: {
        tableName: 'Orders',
        billingMode: 'PROVISIONED',
        readCapacityUnits: 80,
        writeCapacityUnits: 40,
      },
    })
    expect(JSON.parse(capacityPlan.plan.generatedRequest)).toMatchObject({
      operation: 'DynamoDB.UpdateTable',
      tableName: 'Orders',
      billingMode: 'PROVISIONED',
      provisionedThroughput: {
        readCapacityUnits: 80,
        writeCapacityUnits: 40,
      },
    })

    const ttlPlan = planOperationLocally(snapshot, {
      connectionId: dynamoConnection.id,
      environmentId: 'env-local',
      operationId: 'dynamodb.ttl.update',
      objectName: 'Orders',
      parameters: {
        tableName: 'Orders',
        ttlAttribute: 'expiresAt',
        enabled: true,
      },
    })
    expect(JSON.parse(ttlPlan.plan.generatedRequest)).toMatchObject({
      operation: 'DynamoDB.UpdateTimeToLive',
      tableName: 'Orders',
      timeToLiveSpecification: {
        enabled: true,
        attributeName: 'expiresAt',
      },
    })

    const streamPlan = planOperationLocally(snapshot, {
      connectionId: dynamoConnection.id,
      environmentId: 'env-local',
      operationId: 'dynamodb.streams.update',
      objectName: 'Orders',
      parameters: {
        tableName: 'Orders',
        streamViewType: 'NEW_AND_OLD_IMAGES',
        enabled: true,
      },
    })
    expect(JSON.parse(streamPlan.plan.generatedRequest)).toMatchObject({
      operation: 'DynamoDB.UpdateTable',
      tableName: 'Orders',
      streamSpecification: {
        streamEnabled: true,
        streamViewType: 'NEW_AND_OLD_IMAGES',
      },
    })

    const accessPlan = planOperationLocally(snapshot, {
      connectionId: dynamoConnection.id,
      environmentId: 'env-local',
      operationId: 'dynamodb.security.inspect',
      objectName: 'Orders',
      parameters: {
        tableName: 'Orders',
      },
    })
    expect(JSON.parse(accessPlan.plan.generatedRequest)).toMatchObject({
      operation: 'IAM.SimulatePrincipalPolicy',
      tableName: 'Orders',
      actions: expect.arrayContaining(['dynamodb:Query', 'dynamodb:UpdateItem']),
      authEvidence: {
        scheme: 'AWS4-HMAC-SHA256',
        credentialsProvider: 'local',
      },
      disabledReasons: expect.arrayContaining([
        expect.stringContaining('IAM policy simulation'),
      ]),
    })

    const cloudMetricsPlan = planOperationLocally(snapshotWith({
      ...dynamoConnection,
      host: 'dynamodb.us-east-2.amazonaws.com',
      port: 443,
      database: 'us-east-2',
      dynamoDbOptions: {
        connectMode: 'assume-role',
        region: 'us-east-2',
        roleArn: 'arn:aws:iam::123456789012:role/DataPadReadOnly',
      },
    }), {
      connectionId: dynamoConnection.id,
      environmentId: 'env-local',
      operationId: 'dynamodb.diagnostics.metrics',
      objectName: 'Orders',
      parameters: {
        tableName: 'Orders',
      },
    })
    expect(JSON.parse(cloudMetricsPlan.plan.generatedRequest)).toMatchObject({
      authEvidence: {
        connectMode: 'assume-role',
        credentialsProvider: 'assume-role',
        signingRegion: 'us-east-2',
        endpointMode: 'aws-cloud-contract',
        liveCloudRuntime: false,
      },
      disabledReasons: expect.arrayContaining([
        expect.stringContaining('STS AssumeRole'),
        expect.stringContaining('CloudWatch account/table metrics'),
      ]),
    })

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: dynamoConnection.id,
      environmentId: 'env-local',
      operationId: 'dynamodb.data.import-export',
      objectName: 'Orders',
      parameters: {
        tableName: 'Orders',
        mode: 'export',
      },
    })
    expect(JSON.parse(exportPlan.plan.generatedRequest)).toMatchObject({
      operation: 'DynamoDB.ExportTableToPointInTime',
      tableName: 'Orders',
      validation: 'point-in-time-export',
    })

    const backupPlan = planOperationLocally(snapshot, {
      connectionId: dynamoConnection.id,
      environmentId: 'env-local',
      operationId: 'dynamodb.backup.create',
      objectName: 'Orders',
      parameters: {
        tableName: 'Orders',
        backupName: 'Orders-manual',
      },
    })
    expect(JSON.parse(backupPlan.plan.generatedRequest)).toMatchObject({
      operation: 'DynamoDB.CreateBackup',
      tableName: 'Orders',
      backupName: 'Orders-manual',
    })

    const restorePlan = planOperationLocally(snapshot, {
      connectionId: dynamoConnection.id,
      environmentId: 'env-local',
      operationId: 'dynamodb.backup.restore',
      objectName: 'Orders',
      parameters: {
        tableName: 'Orders',
        sourceBackupArn: 'arn:aws:dynamodb:local:000000000000:table/Orders/backup/manual',
        targetTableName: 'OrdersRestored',
      },
    })
    expect(JSON.parse(restorePlan.plan.generatedRequest)).toMatchObject({
      operation: 'DynamoDB.RestoreTableFromBackup',
      targetTableName: 'OrdersRestored',
      validation: 'restore-preview',
    })
  })

  it('generates Cassandra tracing, index, permission, metrics, export, and snapshot operation previews', () => {
    const snapshot = snapshotWith(cassandraConnection)

    const tracePlan = planOperationLocally(snapshot, {
      connectionId: cassandraConnection.id,
      environmentId: 'env-local',
      operationId: 'cassandra.query.profile',
      objectName: '"app"."orders_by_customer"',
      parameters: {
        keyspace: 'app',
        tableName: 'orders_by_customer',
      },
    })
    expect(tracePlan.plan.generatedRequest).toContain('tracing on;')
    expect(tracePlan.plan.generatedRequest).toContain('select * from "app"."orders_by_customer" limit 100;')
    expect(tracePlan.plan.generatedRequest).toContain('system_traces.events')

    const indexPlan = planOperationLocally(snapshot, {
      connectionId: cassandraConnection.id,
      environmentId: 'env-local',
      operationId: 'cassandra.index.create',
      objectName: '"app"."orders_by_customer"',
      parameters: {
        keyspace: 'app',
        tableName: 'orders_by_customer',
        indexName: 'orders_status_sai',
        columnName: 'status',
      },
    })
    expect(indexPlan.plan.generatedRequest).toContain('create custom index if not exists "orders_status_sai"')
    expect(indexPlan.plan.generatedRequest).toContain("using 'StorageAttachedIndex'")

    const securityPlan = planOperationLocally(snapshot, {
      connectionId: cassandraConnection.id,
      environmentId: 'env-local',
      operationId: 'cassandra.security.inspect',
      objectName: '"app"."orders_by_customer"',
      parameters: {
        keyspace: 'app',
      },
    })
    expect(securityPlan.plan.generatedRequest).toContain('list all permissions on keyspace "app";')
    expect(securityPlan.plan.generatedRequest).toContain('list roles;')

    const metricsPlan = planOperationLocally(snapshot, {
      connectionId: cassandraConnection.id,
      environmentId: 'env-local',
      operationId: 'cassandra.diagnostics.metrics',
      objectName: '"app"."orders_by_customer"',
      parameters: {
        keyspace: 'app',
      },
    })
    expect(metricsPlan.plan.generatedRequest).toContain('system.local')
    expect(metricsPlan.plan.generatedRequest).toContain("keyspace_name = 'app'")

    const exportPlan = planOperationLocally(snapshot, {
      connectionId: cassandraConnection.id,
      environmentId: 'env-local',
      operationId: 'cassandra.data.import-export',
      objectName: '"app"."orders_by_customer"',
      parameters: {
        keyspace: 'app',
        tableName: 'orders_by_customer',
        mode: 'export',
        format: 'csv',
      },
    })
    expect(exportPlan.plan.generatedRequest).toContain('cqlsh COPY is contract-only')
    expect(exportPlan.plan.generatedRequest).toContain('copy "app"."orders_by_customer" to')

    const snapshotPlan = planOperationLocally(snapshot, {
      connectionId: cassandraConnection.id,
      environmentId: 'env-local',
      operationId: 'cassandra.data.backup-restore',
      objectName: '"app"."orders_by_customer"',
      parameters: {
        keyspace: 'app',
        tableName: 'orders_by_customer',
        mode: 'backup',
        snapshotName: 'orders_manual',
      },
    })
    expect(snapshotPlan.plan.generatedRequest).toContain('nodetool snapshot')
    expect(snapshotPlan.plan.generatedRequest).toContain('--table "orders_by_customer" "app"')
  })

  it('generates native time-series profile, metrics, export, and guarded delete previews', () => {
    const prometheusSnapshot = snapshotWith(prometheusConnection)
    const prometheusOperations = buildOperationManifestsForConnection(prometheusConnection)
    expect(prometheusOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'prometheus.cardinality.analyze',
          label: 'Analyze Cardinality',
          risk: 'costly',
        }),
      ]),
    )

    const prometheusProfile = planOperationLocally(prometheusSnapshot, {
      connectionId: prometheusConnection.id,
      environmentId: 'env-local',
      operationId: 'prometheus.query.profile',
      objectName: 'http_requests_total',
      parameters: {
        query: 'sum(rate(http_requests_total[5m]))',
        objectKind: 'metric',
      },
    })
    expect(JSON.parse(prometheusProfile.plan.generatedRequest)).toMatchObject({
      method: 'GET',
      path: '/api/v1/query',
      query: {
        query: 'sum(rate(http_requests_total[5m]))',
      },
      profile: {
        checks: expect.arrayContaining(['cardinality', 'sample-count']),
      },
    })

    const prometheusCardinality = planOperationLocally(prometheusSnapshot, {
      connectionId: prometheusConnection.id,
      environmentId: 'env-local',
      operationId: 'prometheus.cardinality.analyze',
      objectName: 'http_requests_total',
      parameters: {
        match: 'http_requests_total',
      },
    })
    expect(JSON.parse(prometheusCardinality.plan.generatedRequest)).toMatchObject({
      method: 'GET',
      path: '/api/v1/series',
      analysis: {
        checks: expect.arrayContaining(['high-cardinality-labels']),
      },
    })
    expect(prometheusCardinality.plan.confirmationText).toBeTruthy()

    const influxSnapshot = snapshotWith(influxConnection)
    const influxOperations = buildOperationManifestsForConnection(influxConnection)
    expect(influxOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'influxdb.retention.update',
          label: 'Update Retention',
          risk: 'write',
        }),
      ]),
    )

    const influxExport = planOperationLocally(influxSnapshot, {
      connectionId: influxConnection.id,
      environmentId: 'env-local',
      operationId: 'influxdb.data.import-export',
      objectName: 'cpu',
      parameters: {
        bucket: 'telemetry',
        measurement: 'cpu',
        mode: 'export',
      },
    })
    expect(JSON.parse(influxExport.plan.generatedRequest)).toMatchObject({
      operation: 'line-protocol.export',
      bucket: 'telemetry',
      measurement: 'cpu',
      format: 'line-protocol',
      validation: 'bounded-export',
    })

    const influxDelete = planOperationLocally(influxSnapshot, {
      connectionId: influxConnection.id,
      environmentId: 'env-local',
      operationId: 'influxdb.object.drop',
      objectName: 'cpu',
      parameters: {
        bucket: 'telemetry',
        measurement: 'cpu',
        objectKind: 'measurement',
      },
    })
    expect(JSON.parse(influxDelete.plan.generatedRequest)).toMatchObject({
      method: 'DELETE',
      path: '/api/v2/delete',
      body: {
        bucket: 'telemetry',
        measurement: 'cpu',
      },
    })
    expect(influxDelete.plan.destructive).toBe(true)

    const influxRetention = planOperationLocally(influxSnapshot, {
      connectionId: influxConnection.id,
      environmentId: 'env-local',
      operationId: 'influxdb.retention.update',
      objectName: 'telemetry',
      parameters: {
        bucket: 'telemetry',
        retentionPeriod: '7d',
      },
    })
    expect(JSON.parse(influxRetention.plan.generatedRequest)).toMatchObject({
      method: 'PATCH',
      path: '/api/v2/buckets/telemetry',
      body: {
        retentionRules: [{ type: 'expire', everySeconds: 604800 }],
      },
    })

    const openTsdbSnapshot = snapshotWith(openTsdbConnection)
    const openTsdbOperations = buildOperationManifestsForConnection(openTsdbConnection)
    expect(openTsdbOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'opentsdb.uid.repair',
          label: 'Repair UID Metadata',
          risk: 'write',
        }),
      ]),
    )

    const openTsdbMetrics = planOperationLocally(openTsdbSnapshot, {
      connectionId: openTsdbConnection.id,
      environmentId: 'env-local',
      operationId: 'opentsdb.diagnostics.metrics',
      objectName: 'http.requests',
      parameters: {
        metric: 'http.requests',
        objectKind: 'metric',
      },
    })
    expect(JSON.parse(openTsdbMetrics.plan.generatedRequest)).toMatchObject({
      method: 'GET',
      path: '/api/stats',
      query: {
        metric: 'http.requests',
      },
    })

    const openTsdbRepair = planOperationLocally(openTsdbSnapshot, {
      connectionId: openTsdbConnection.id,
      environmentId: 'env-local',
      operationId: 'opentsdb.uid.repair',
      objectName: 'http.requests',
      parameters: {
        metric: 'http.requests',
        displayName: 'HTTP Requests',
      },
    })
    expect(JSON.parse(openTsdbRepair.plan.generatedRequest)).toMatchObject({
      operation: 'opentsdb.uid.repair',
      metric: 'http.requests',
      update: {
        displayName: 'HTTP Requests',
      },
    })
  })

  it('generates graph-native profile, index, access, metrics, and export operation previews', () => {
    const neo4jSnapshot = snapshotWith(neo4jConnection)
    const neo4jOperations = buildOperationManifestsForConnection(neo4jConnection)
    expect(neo4jOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'neo4j.query.explain',
          label: 'View Execution Plan',
          risk: 'diagnostic',
        }),
        expect.objectContaining({
          id: 'neo4j.data.import-export',
          label: 'Import / Export',
          risk: 'costly',
        }),
      ]),
    )

    const explainPlan = planOperationLocally(neo4jSnapshot, {
      connectionId: neo4jConnection.id,
      environmentId: 'env-local',
      operationId: 'neo4j.query.explain',
      objectName: 'Account',
      parameters: {
        label: 'Account',
        query: 'MATCH (n:`Account`) RETURN n LIMIT 25',
      },
    })
    expect(explainPlan.plan.generatedRequest).toContain('EXPLAIN MATCH (n:`Account`) RETURN n LIMIT 25')

    const profilePlan = planOperationLocally(neo4jSnapshot, {
      connectionId: neo4jConnection.id,
      environmentId: 'env-local',
      operationId: 'neo4j.query.profile',
      objectName: 'Account',
      parameters: {
        label: 'Account',
        query: 'MATCH (n:`Account`) RETURN n LIMIT 25',
      },
    })
    expect(profilePlan.plan.generatedRequest).toContain('PROFILE MATCH (n:`Account`) RETURN n LIMIT 25')

    const indexPlan = planOperationLocally(neo4jSnapshot, {
      connectionId: neo4jConnection.id,
      environmentId: 'env-local',
      operationId: 'neo4j.index.create',
      objectName: 'Account',
      parameters: {
        label: 'Account',
        propertyName: 'email',
        indexName: 'account_email_lookup',
      },
    })
    expect(indexPlan.plan.generatedRequest).toContain('CREATE INDEX account_email_lookup')
    expect(indexPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const neptuneSnapshot = snapshotWith(neptuneConnection)
    const neptuneOperations = buildOperationManifestsForConnection(neptuneConnection)
    expect(neptuneOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'neptune.security.inspect',
          label: 'Inspect Permissions',
          risk: 'read',
        }),
      ]),
    )

    const metricsPlan = planOperationLocally(neptuneSnapshot, {
      connectionId: neptuneConnection.id,
      environmentId: 'env-local',
      operationId: 'neptune.diagnostics.metrics',
      objectName: 'analytics',
      parameters: {
        graphName: 'analytics',
      },
    })
    expect(JSON.parse(metricsPlan.plan.generatedRequest)).toMatchObject({
      operation: 'CloudWatch.GetMetricData',
      namespace: 'AWS/Neptune',
      metrics: expect.arrayContaining(['CPUUtilization', 'GremlinRequestsPerSec']),
    })

    const exportPlan = planOperationLocally(neptuneSnapshot, {
      connectionId: neptuneConnection.id,
      environmentId: 'env-local',
      operationId: 'neptune.data.import-export',
      objectName: 'analytics',
      parameters: {
        format: 'neptune-bulk',
      },
    })
    expect(JSON.parse(exportPlan.plan.generatedRequest)).toMatchObject({
      operation: 'Neptune.StartLoaderJob',
      scope: 'analytics',
      validation: 'validate-before-write',
    })

    const accessPlan = planOperationLocally(neptuneSnapshot, {
      connectionId: neptuneConnection.id,
      environmentId: 'env-local',
      operationId: 'neptune.security.inspect',
      objectName: 'analytics',
      parameters: {
        graphName: 'analytics',
      },
    })
    expect(JSON.parse(accessPlan.plan.generatedRequest)).toMatchObject({
      operation: 'IAM.SimulatePrincipalPolicy',
      resource: 'analytics',
    })
  })

  it('generates warehouse-native plan, cost, metrics, access, and export operation previews', () => {
    const snowflakeSnapshot = snapshotWith(snowflakeConnection)
    const snowflakeOperations = buildOperationManifestsForConnection(snowflakeConnection)
    expect(snowflakeOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'snowflake.table.clone',
          label: 'Clone Table',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'snowflake.warehouse.suspend',
          label: 'Suspend Warehouse',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'snowflake.warehouse.resume',
          label: 'Resume Warehouse',
          risk: 'write',
        }),
      ]),
    )

    const costPlan = planOperationLocally(snowflakeSnapshot, {
      connectionId: snowflakeConnection.id,
      environmentId: 'env-local',
      operationId: 'snowflake.query.profile',
      objectName: 'orders',
      parameters: {
        schema: 'ANALYTICS',
        query: 'select * from "ANALYTICS"."orders" limit 100;',
      },
    })
    expect(costPlan.plan.generatedRequest).toContain('information_schema.query_history')
    expect(costPlan.plan.generatedRequest).toContain('select * from "ANALYTICS"."orders" limit 100;')

    const clonePlan = planOperationLocally(snowflakeSnapshot, {
      connectionId: snowflakeConnection.id,
      environmentId: 'env-local',
      operationId: 'snowflake.table.clone',
      objectName: 'orders',
      parameters: {
        cloneName: 'orders_clone',
      },
    })
    expect(clonePlan.plan.generatedRequest).toContain('CREATE TABLE')
    expect(clonePlan.plan.generatedRequest).toContain('CLONE')

    const suspendPlan = planOperationLocally(snowflakeSnapshot, {
      connectionId: snowflakeConnection.id,
      environmentId: 'env-local',
      operationId: 'snowflake.warehouse.suspend',
      objectName: 'ANALYTICS_XS',
      parameters: {},
    })
    expect(suspendPlan.plan.generatedRequest).toBe('ALTER WAREHOUSE "ANALYTICS_XS" SUSPEND;')

    const bigQuerySnapshot = snapshotWith(bigQueryConnection)
    const bigQueryOperations = buildOperationManifestsForConnection(bigQueryConnection)
    expect(bigQueryOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bigquery.table.copy',
          label: 'Copy Table',
          risk: 'write',
        }),
      ]),
    )

    const dryRunPlan = planOperationLocally(bigQuerySnapshot, {
      connectionId: bigQueryConnection.id,
      environmentId: 'env-local',
      operationId: 'bigquery.query.profile',
      objectName: 'orders',
      parameters: {
        schema: 'analytics',
        query: 'select * from `analytics.orders` limit 100;',
      },
    })
    expect(JSON.parse(dryRunPlan.plan.generatedRequest)).toMatchObject({
      operation: 'BigQuery.Jobs.QueryDryRun',
      dryRun: true,
      estimate: expect.arrayContaining(['bytesProcessed', 'slotMs']),
    })

    const copyPlan = planOperationLocally(bigQuerySnapshot, {
      connectionId: bigQueryConnection.id,
      environmentId: 'env-local',
      operationId: 'bigquery.table.copy',
      objectName: 'orders',
      parameters: {
        destinationTable: 'orders_copy',
      },
    })
    expect(JSON.parse(copyPlan.plan.generatedRequest)).toMatchObject({
      operation: 'BigQuery.Tables.Copy',
      sourceTable: 'orders',
      destinationTable: 'orders_copy',
    })

    const clickHouseSnapshot = snapshotWith(clickHouseConnection)
    const clickHouseOperations = buildOperationManifestsForConnection(clickHouseConnection)
    expect(clickHouseOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'clickhouse.table.optimize',
          label: 'Optimize Table',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'clickhouse.table.materialize-ttl',
          label: 'Materialize TTL',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'clickhouse.table.freeze',
          label: 'Freeze Table',
          risk: 'write',
        }),
      ]),
    )

    const exportPlan = planOperationLocally(clickHouseSnapshot, {
      connectionId: clickHouseConnection.id,
      environmentId: 'env-local',
      operationId: 'clickhouse.data.import-export',
      objectName: 'orders',
      parameters: {
        format: 'parquet',
      },
    })
    expect(exportPlan.plan.generatedRequest).toContain('INTO OUTFILE')
    expect(exportPlan.plan.generatedRequest).toContain('FORMAT PARQUET')

    const optimizePlan = planOperationLocally(clickHouseSnapshot, {
      connectionId: clickHouseConnection.id,
      environmentId: 'env-local',
      operationId: 'clickhouse.table.optimize',
      objectName: 'orders',
      parameters: {},
    })
    expect(optimizePlan.plan.generatedRequest).toContain('OPTIMIZE TABLE')
    expect(optimizePlan.plan.confirmationText).toBeTruthy()

    const ttlPlan = planOperationLocally(clickHouseSnapshot, {
      connectionId: clickHouseConnection.id,
      environmentId: 'env-local',
      operationId: 'clickhouse.table.materialize-ttl',
      objectName: 'orders',
      parameters: {},
    })
    expect(ttlPlan.plan.generatedRequest).toContain('MATERIALIZE TTL')
    expect(ttlPlan.plan.confirmationText).toBeTruthy()

    const freezePlan = planOperationLocally(clickHouseSnapshot, {
      connectionId: clickHouseConnection.id,
      environmentId: 'env-local',
      operationId: 'clickhouse.table.freeze',
      objectName: 'orders',
      parameters: {
        snapshotName: "orders'backup",
      },
    })
    expect(freezePlan.plan.generatedRequest).toContain('FREEZE WITH NAME')
    expect(freezePlan.plan.generatedRequest).toContain("orders\\'backup")
  })

  it('generates Cosmos DB, LiteDB, and Memcached native operation previews', () => {
    const cosmosSnapshot = snapshotWith(cosmosConnection)
    const cosmosOperations = buildOperationManifestsForConnection(cosmosConnection)
    expect(cosmosOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cosmosdb.throughput.update',
          label: 'Update Throughput',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'cosmosdb.consistency.update',
          label: 'Update Consistency',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'cosmosdb.regions.failover',
          label: 'Failover Regions',
          risk: 'write',
        }),
      ]),
    )

    const cosmosIndex = planOperationLocally(cosmosSnapshot, {
      connectionId: cosmosConnection.id,
      environmentId: 'env-local',
      operationId: 'cosmosdb.index.create',
      objectName: 'catalog/products',
      parameters: {
        database: 'catalog',
        container: 'products',
        path: '/*',
      },
    })
    expect(JSON.parse(cosmosIndex.plan.generatedRequest)).toMatchObject({
      method: 'PATCH',
      path: '/dbs/catalog/colls/products',
      body: {
        indexingPolicy: {
          includedPaths: [{ path: '/*' }],
        },
      },
    })

    const cosmosThroughput = planOperationLocally(cosmosSnapshot, {
      connectionId: cosmosConnection.id,
      environmentId: 'env-local',
      operationId: 'cosmosdb.throughput.update',
      objectName: 'catalog/products',
      parameters: {
        database: 'catalog',
        container: 'products',
        mode: 'autoscale',
        maxRuPerSecond: 4000,
      },
    })
    expect(JSON.parse(cosmosThroughput.plan.generatedRequest)).toMatchObject({
      operation: 'CosmosDB.ReplaceOffer',
      scope: '/dbs/catalog/colls/products',
      throughputParameters: {
        autoscaleSettings: {
          maxThroughput: 4000,
        },
      },
    })

    const cosmosConsistency = planOperationLocally(cosmosSnapshot, {
      connectionId: cosmosConnection.id,
      environmentId: 'env-local',
      operationId: 'cosmosdb.consistency.update',
      objectName: 'catalog-account',
      parameters: {
        account: 'catalog-account',
        consistencyLevel: 'Session',
      },
    })
    expect(JSON.parse(cosmosConsistency.plan.generatedRequest)).toMatchObject({
      operation: 'CosmosDB.UpdateAccountConsistency',
      account: 'catalog-account',
      consistencyPolicy: {
        defaultConsistencyLevel: 'Session',
      },
    })

    const cosmosFailover = planOperationLocally(cosmosSnapshot, {
      connectionId: cosmosConnection.id,
      environmentId: 'env-local',
      operationId: 'cosmosdb.regions.failover',
      objectName: 'catalog-account',
      parameters: {
        account: 'catalog-account',
        writeRegion: 'West Europe',
      },
    })
    expect(JSON.parse(cosmosFailover.plan.generatedRequest)).toMatchObject({
      operation: 'CosmosDB.FailoverPriorityChange',
      account: 'catalog-account',
      writeRegion: 'West Europe',
    })

    const liteDbSnapshot = snapshotWith(liteDbConnection)
    const liteDbOperations = buildOperationManifestsForConnection(liteDbConnection)
    expect(liteDbOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'litedb.storage.checkpoint',
          label: 'Checkpoint',
          risk: 'write',
        }),
        expect.objectContaining({
          id: 'litedb.storage.compact',
          label: 'Compact File',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'litedb.storage.rebuild-indexes',
          label: 'Rebuild Indexes',
          risk: 'costly',
        }),
        expect.objectContaining({
          id: 'litedb.data.import-export',
          label: 'Import / Export',
          risk: 'costly',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'litedb.file-storage.import',
          label: 'Import Stored File',
          risk: 'write',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'litedb.file-storage.export',
          label: 'Export Stored File',
          risk: 'costly',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'litedb.file-storage.delete',
          label: 'Delete Stored File',
          risk: 'destructive',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'litedb.index.create',
          risk: 'write',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'litedb.index.drop',
          risk: 'destructive',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'litedb.object.drop',
          risk: 'destructive',
          executionSupport: 'live',
          previewOnly: false,
        }),
        expect.objectContaining({
          id: 'litedb.data.backup-restore',
          label: 'Backup / Restore',
          risk: 'destructive',
        }),
      ]),
    )

    const liteDbIndex = planOperationLocally(liteDbSnapshot, {
      connectionId: liteDbConnection.id,
      environmentId: 'env-local',
      operationId: 'litedb.index.create',
      objectName: 'products',
      parameters: {
        databaseFile: 'catalog.db',
        collection: 'products',
        indexName: 'idx_products_sku',
        field: 'sku',
      },
    })
    expect(liteDbIndex.plan.generatedRequest).toContain('EnsureIndex')
    expect(liteDbIndex.plan.generatedRequest).toContain('idx_products_sku')
    expect(JSON.parse(liteDbIndex.plan.generatedRequest)).toMatchObject({
      operation: 'LiteDB.EnsureIndex',
      collection: 'products',
      indexName: 'idx_products_sku',
      sidecarExecutionBoundary: {
        runtime: 'dotnet-litedb-sidecar',
      },
    })

    const liteDbCompact = planOperationLocally(liteDbSnapshot, {
      connectionId: liteDbConnection.id,
      environmentId: 'env-local',
      operationId: 'litedb.storage.compact',
      objectName: 'catalog.db',
      parameters: {
        databaseFile: 'catalog.db',
      },
    })
    expect(JSON.parse(liteDbCompact.plan.generatedRequest)).toMatchObject({
      operation: 'LiteDB.Compact',
      databaseFile: 'catalog.db',
      localFilePreflight: {
        lockBoundary: {
          exclusiveWriterLockValidated: false,
        },
        encryptionBoundary: {
          status: 'sidecar-required',
        },
      },
      sidecarExecutionBoundary: {
        status: 'plan-only-until-sidecar',
      },
    })

    const liteDbRebuild = planOperationLocally(liteDbSnapshot, {
      connectionId: liteDbConnection.id,
      environmentId: 'env-local',
      operationId: 'litedb.storage.rebuild-indexes',
      objectName: 'products',
      parameters: {
        databaseFile: 'catalog.db',
        collection: 'products',
      },
    })
    expect(JSON.parse(liteDbRebuild.plan.generatedRequest)).toMatchObject({
      operation: 'LiteDB.RebuildIndexes',
      databaseFile: 'catalog.db',
      collection: 'products',
      localFilePreflight: {
        intent: 'storage-rebuild-indexes',
      },
    })

    const liteDbExport = planOperationLocally(liteDbSnapshot, {
      connectionId: liteDbConnection.id,
      environmentId: 'env-local',
      operationId: 'litedb.data.import-export',
      objectName: 'products',
      parameters: {
        databaseFile: 'catalog.db',
        collection: 'products',
        mode: 'export',
        format: 'json',
      },
    })
    expect(JSON.parse(liteDbExport.plan.generatedRequest)).toMatchObject({
      operation: 'LiteDB.ExportCollection',
      databaseFile: 'catalog.db',
      collection: 'products',
      format: 'json',
      localFilePreflight: {
        intent: 'data-export',
      },
      sidecarExecutionBoundary: {
        runtime: 'dotnet-litedb-sidecar',
      },
    })

    const liteDbFileImport = planOperationLocally(liteDbSnapshot, {
      connectionId: liteDbConnection.id,
      environmentId: 'env-local',
      operationId: 'litedb.file-storage.import',
      objectName: 'files/terms.txt',
      parameters: {
        databaseFile: 'catalog.db',
        fileId: 'files/terms.txt',
        sourcePath: 'C:/fixtures/terms.txt',
        filename: 'terms.txt',
        overwrite: true,
      },
    })
    expect(JSON.parse(liteDbFileImport.plan.generatedRequest)).toMatchObject({
      operation: 'LiteDB.ImportFile',
      databaseFile: 'catalog.db',
      fileId: 'files/terms.txt',
      sourcePath: 'C:/fixtures/terms.txt',
      filename: 'terms.txt',
      overwrite: true,
      localFilePreflight: {
        intent: 'file-storage-import',
        lockBoundary: {
          writeIntent: true,
        },
      },
    })

    const liteDbFileExport = planOperationLocally(liteDbSnapshot, {
      connectionId: liteDbConnection.id,
      environmentId: 'env-local',
      operationId: 'litedb.file-storage.export',
      objectName: 'files/terms.txt',
      parameters: {
        databaseFile: 'catalog.db',
        fileId: 'files/terms.txt',
        targetPath: 'C:/fixtures/exported-terms.txt',
      },
    })
    expect(JSON.parse(liteDbFileExport.plan.generatedRequest)).toMatchObject({
      operation: 'LiteDB.ExportFile',
      databaseFile: 'catalog.db',
      fileId: 'files/terms.txt',
      targetPath: 'C:/fixtures/exported-terms.txt',
      localFilePreflight: {
        intent: 'file-storage-export',
        lockBoundary: {
          writeIntent: false,
        },
      },
    })

    const liteDbFileDelete = planOperationLocally(liteDbSnapshot, {
      connectionId: liteDbConnection.id,
      environmentId: 'env-local',
      operationId: 'litedb.file-storage.delete',
      objectName: 'files/terms.txt',
      parameters: {
        databaseFile: 'catalog.db',
        fileId: 'files/terms.txt',
      },
    })
    expect(JSON.parse(liteDbFileDelete.plan.generatedRequest)).toMatchObject({
      operation: 'LiteDB.DeleteFile',
      databaseFile: 'catalog.db',
      fileId: 'files/terms.txt',
      localFilePreflight: {
        intent: 'file-storage-delete',
        lockBoundary: {
          writeIntent: true,
        },
      },
    })

    const liteDbBackup = planOperationLocally(liteDbSnapshot, {
      connectionId: liteDbConnection.id,
      environmentId: 'env-local',
      operationId: 'litedb.data.backup-restore',
      objectName: 'catalog.db',
      parameters: {
        databaseFile: 'catalog.db',
      },
    })
    expect(JSON.parse(liteDbBackup.plan.generatedRequest)).toMatchObject({
      operation: 'LiteDB.Backup',
      databaseFile: 'catalog.db',
      localFilePreflight: {
        encryptionBoundary: {
          requiredForEncryptedFiles: expect.arrayContaining([
            'sidecar LiteDB open probe',
          ]),
        },
      },
      sidecarExecutionBoundary: {
        runtime: 'dotnet-litedb-sidecar',
      },
    })

    const memcachedSnapshot = snapshotWith(memcachedConnection)
    const memcachedDump = planOperationLocally(memcachedSnapshot, {
      connectionId: memcachedConnection.id,
      environmentId: 'env-local',
      operationId: 'memcached.data.import-export',
      objectName: 'class:2',
      parameters: {
        classId: '2',
      },
    })
    expect(memcachedDump.plan.generatedRequest).toContain('lru_crawler metadump 2')

    const memcachedFlush = planOperationLocally(memcachedSnapshot, {
      connectionId: memcachedConnection.id,
      environmentId: 'env-local',
      operationId: 'memcached.cache.flush',
      objectName: 'server',
      parameters: {
        delaySeconds: 5,
      },
    })
    expect(memcachedFlush.plan.generatedRequest).toContain('flush_all 5')
    expect(memcachedFlush.plan.destructive).toBe(true)

    const memcachedSet = planOperationLocally(memcachedSnapshot, {
      connectionId: memcachedConnection.id,
      environmentId: 'env-local',
      operationId: 'memcached.key.set',
      objectName: 'session:1',
      parameters: {
        key: 'session:1',
        value: 'cached-user',
        ttlSeconds: 60,
      },
    })
    expect(memcachedSet.plan.generatedRequest).toContain('set session:1 0 60 11')
    expect(memcachedSet.plan.generatedRequest).toContain('cached-user')

    const memcachedDecrement = planOperationLocally(memcachedSnapshot, {
      connectionId: memcachedConnection.id,
      environmentId: 'env-local',
      operationId: 'memcached.key.decrement',
      objectName: 'counter:1',
      parameters: {
        key: 'counter:1',
        delta: 2,
      },
    })
    expect(memcachedDecrement.plan.generatedRequest).toBe('decr counter:1 2')

    const memcachedDelete = planOperationLocally(memcachedSnapshot, {
      connectionId: memcachedConnection.id,
      environmentId: 'env-local',
      operationId: 'memcached.key.delete',
      objectName: 'session:1',
      parameters: {
        key: 'session:1',
      },
    })
    expect(memcachedDelete.plan.generatedRequest).toBe('delete session:1')
    expect(memcachedDelete.plan.destructive).toBe(true)
  })
})

function snapshotWith(connection: ConnectionProfile) {
  return {
    connections: [connection],
    environments: [
      {
        id: 'env-local',
        name: 'Local',
        label: 'Local',
        risk: 'low',
        variables: {},
        sensitiveKeys: [],
      },
    ],
    activeEnvironmentId: 'env-local',
    preferences: {
      theme: 'dark',
      telemetry: 'opt-in',
      lockAfterMinutes: 15,
      safeModeEnabled: false,
    },
  } as unknown as WorkspaceSnapshot
}

const mongoConnection: ConnectionProfile = {
  id: 'conn-mongo',
  name: 'MongoDB',
  engine: 'mongodb',
  family: 'document',
  host: 'localhost',
  port: 27017,
  database: 'catalog',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'mongodb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const redisConnection: ConnectionProfile = {
  id: 'conn-redis',
  name: 'Redis',
  engine: 'redis',
  family: 'keyvalue',
  host: 'localhost',
  port: 6379,
  database: '0',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'redis',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const valkeyConnection: ConnectionProfile = {
  ...redisConnection,
  id: 'conn-valkey',
  name: 'Valkey',
  engine: 'valkey',
  icon: 'valkey',
}

const sqlServerConnection: ConnectionProfile = {
  id: 'conn-sqlserver',
  name: 'SQL Server',
  engine: 'sqlserver',
  family: 'sql',
  host: 'localhost',
  port: 1433,
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'sqlserver',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const postgresConnection: ConnectionProfile = {
  id: 'conn-postgres',
  name: 'PostgreSQL',
  engine: 'postgresql',
  family: 'sql',
  host: 'localhost',
  port: 5432,
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'postgresql',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const cockroachConnection: ConnectionProfile = {
  id: 'conn-cockroach',
  name: 'CockroachDB',
  engine: 'cockroachdb',
  family: 'sql',
  host: 'localhost',
  port: 26257,
  database: 'datapadplusplus',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cockroachdb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const mysqlConnection: ConnectionProfile = {
  id: 'conn-mysql',
  name: 'MySQL',
  engine: 'mysql',
  family: 'sql',
  host: 'localhost',
  port: 3306,
  database: 'shop',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'mysql',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const mariaDbConnection: ConnectionProfile = {
  ...mysqlConnection,
  id: 'conn-mariadb',
  name: 'MariaDB',
  engine: 'mariadb',
  port: 3307,
  icon: 'mariadb',
}

const timescaleConnection: ConnectionProfile = {
  id: 'conn-timescale',
  name: 'TimescaleDB',
  engine: 'timescaledb',
  family: 'timeseries',
  host: 'localhost',
  port: 5432,
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'timescaledb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const duckDbConnection: ConnectionProfile = {
  id: 'conn-duckdb',
  name: 'DuckDB',
  engine: 'duckdb',
  family: 'embedded-olap',
  host: 'tests/fixtures/duckdb/datapad.duckdb',
  port: undefined,
  database: 'tests/fixtures/duckdb/datapad.duckdb',
  connectionString: undefined,
  connectionMode: 'local-file',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'duckdb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const sqliteConnection: ConnectionProfile = {
  id: 'conn-sqlite',
  name: 'SQLite',
  engine: 'sqlite',
  family: 'sql',
  host: 'tests/fixtures/sqlite/datapad.sqlite',
  port: undefined,
  database: 'tests/fixtures/sqlite/datapad.sqlite',
  connectionString: undefined,
  connectionMode: 'local-file',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'sqlite',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const searchConnection: ConnectionProfile = {
  id: 'conn-search',
  name: 'Elasticsearch',
  engine: 'elasticsearch',
  family: 'search',
  host: 'localhost',
  port: 9200,
  database: 'elasticsearch-local',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'elasticsearch',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const dynamoConnection: ConnectionProfile = {
  id: 'conn-dynamodb',
  name: 'DynamoDB',
  engine: 'dynamodb',
  family: 'widecolumn',
  host: 'localhost',
  port: 8000,
  database: 'local',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'dynamodb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'local' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const cassandraConnection: ConnectionProfile = {
  id: 'conn-cassandra',
  name: 'Cassandra',
  engine: 'cassandra',
  family: 'widecolumn',
  host: 'localhost',
  port: 9042,
  database: 'app',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cassandra',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'cassandra' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const prometheusConnection: ConnectionProfile = {
  id: 'conn-prometheus',
  name: 'Prometheus',
  engine: 'prometheus',
  family: 'timeseries',
  host: 'localhost',
  port: 9090,
  database: undefined,
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'prometheus',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const influxConnection: ConnectionProfile = {
  id: 'conn-influxdb',
  name: 'InfluxDB',
  engine: 'influxdb',
  family: 'timeseries',
  host: 'localhost',
  port: 8086,
  database: 'telemetry',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'influxdb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const openTsdbConnection: ConnectionProfile = {
  id: 'conn-opentsdb',
  name: 'OpenTSDB',
  engine: 'opentsdb',
  family: 'timeseries',
  host: 'localhost',
  port: 4242,
  database: undefined,
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'opentsdb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const neo4jConnection: ConnectionProfile = {
  id: 'conn-neo4j',
  name: 'Neo4j',
  engine: 'neo4j',
  family: 'graph',
  host: 'localhost',
  port: 7687,
  database: 'neo4j',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'neo4j',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const neptuneConnection: ConnectionProfile = {
  id: 'conn-neptune',
  name: 'Neptune',
  engine: 'neptune',
  family: 'graph',
  host: 'neptune.local',
  port: 8182,
  database: 'analytics',
  connectionString: undefined,
  connectionMode: 'cloud-iam',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'neptune',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const snowflakeConnection: ConnectionProfile = {
  id: 'conn-snowflake',
  name: 'Snowflake',
  engine: 'snowflake',
  family: 'warehouse',
  host: 'account.snowflakecomputing.com',
  port: undefined,
  database: 'ANALYTICS',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'snowflake',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const bigQueryConnection: ConnectionProfile = {
  id: 'conn-bigquery',
  name: 'BigQuery',
  engine: 'bigquery',
  family: 'warehouse',
  host: 'bigquery.googleapis.com',
  port: undefined,
  database: 'analytics',
  connectionString: undefined,
  connectionMode: 'cloud-iam',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'bigquery',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const clickHouseConnection: ConnectionProfile = {
  id: 'conn-clickhouse',
  name: 'ClickHouse',
  engine: 'clickhouse',
  family: 'warehouse',
  host: 'localhost',
  port: 8123,
  database: 'default',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'clickhouse',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const cosmosConnection: ConnectionProfile = {
  id: 'conn-cosmos',
  name: 'Cosmos DB',
  engine: 'cosmosdb',
  family: 'document',
  host: 'account.documents.azure.com',
  port: undefined,
  database: 'catalog',
  connectionString: undefined,
  connectionMode: 'cloud-iam',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cosmosdb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const liteDbConnection: ConnectionProfile = {
  id: 'conn-litedb',
  name: 'LiteDB',
  engine: 'litedb',
  family: 'document',
  host: 'catalog.db',
  port: undefined,
  database: 'catalog.db',
  connectionString: undefined,
  connectionMode: 'local-file',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'litedb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const memcachedConnection: ConnectionProfile = {
  id: 'conn-memcached',
  name: 'Memcached',
  engine: 'memcached',
  family: 'keyvalue',
  host: 'localhost',
  port: 11211,
  database: undefined,
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'memcached',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
