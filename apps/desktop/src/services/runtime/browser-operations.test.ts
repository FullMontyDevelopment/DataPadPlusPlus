import type { ConnectionProfile, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  buildOperationManifestsForConnection,
  executeOperationLocally,
  planOperationLocally,
} from './browser-operations'

describe('browser operation runtime', () => {
  it('exposes guarded index visibility operations for MongoDB-capable profiles', () => {
    const operations = buildOperationManifestsForConnection(mongoConnection)

    expect(operations).toEqual(expect.arrayContaining([
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
    ]))
  })

  it('exposes Memcached known-key operation manifests without key browsing capabilities', () => {
    const operations = buildOperationManifestsForConnection(memcachedConnection)

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'memcached.key.get', label: 'Get Key', risk: 'read' }),
      expect.objectContaining({ id: 'memcached.key.set', label: 'Set Key', risk: 'write' }),
      expect.objectContaining({ id: 'memcached.key.touch', label: 'Touch Key', risk: 'write' }),
      expect.objectContaining({ id: 'memcached.key.delete', label: 'Delete Key', risk: 'destructive' }),
    ]))
    expect(operations.map((operation) => operation.id).join(' ')).not.toContain('key.browser')
  })

  it('generates MongoDB collMod previews for index hide and unhide requests', () => {
    const snapshot = {
      connections: [mongoConnection],
      environments: [{ id: 'env-local', name: 'Local', label: 'Local', risk: 'low', variables: {}, sensitiveKeys: [] }],
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
      environments: [{ id: 'env-local', name: 'Local', label: 'Local', risk: 'low', variables: {}, sensitiveKeys: [] }],
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

  it('generates MongoDB collection import and export previews', () => {
    const snapshot = {
      connections: [mongoConnection],
      environments: [{ id: 'env-local', name: 'Local', label: 'Local', risk: 'low', variables: {}, sensitiveKeys: [] }],
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
      format: 'extended-json',
      filter: { active: true },
      projection: { sku: 1 },
      sort: { sku: 1 },
      batchSize: 500,
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
      format: 'ndjson',
      mode: 'insertMany',
      validation: 'validate-before-write',
    })
    expect(importPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])
  })

  it('generates MongoDB GridFS export, upload, and validation previews', () => {
    const snapshot = {
      connections: [mongoConnection],
      environments: [{ id: 'env-local', name: 'Local', label: 'Local', risk: 'low', variables: {}, sensitiveKeys: [] }],
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

    expect(operations).toEqual(expect.arrayContaining([
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
    ]))
  })

  it('generates Redis key import and export previews', () => {
    const snapshot = {
      connections: [redisConnection],
      environments: [{ id: 'env-local', name: 'Local', label: 'Local', risk: 'low', variables: {}, sensitiveKeys: [] }],
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
      operation: 'key.export',
      key: 'product:luna-lamp',
      type: 'hash',
      format: 'json',
      includeType: true,
      includeTtl: true,
      includeMetadata: true,
      memberRead: 'bounded',
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
      operation: 'key.import',
      key: 'product:luna-lamp',
      type: 'hash',
      mode: 'create-or-replace',
      ttl: 'preserve',
      validation: 'validate-before-write',
    })
    expect(importPlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])
  })

  it('redacts secret-shaped scalar parameters in generated operation previews', () => {
    const snapshot = {
      connections: [mongoConnection],
      environments: [{ id: 'env-local', name: 'Local', label: 'Local', risk: 'low', variables: {}, sensitiveKeys: [] }],
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
      environments: [{
        id: 'env-local',
        name: 'Local',
        label: 'Local',
        risk: 'low',
        variables: {},
        sensitiveKeys: ['API_TOKEN'],
        variableDefinitions: [{
          key: 'API_TOKEN',
          kind: 'secret',
          secretRef: {
            id: 'secret-env-local-api-token',
            provider: 'os-keyring',
            service: 'DataPad++',
            account: 'environment:env-local:API_TOKEN',
            label: 'API token',
          },
        }],
      }],
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

    expect(plan.plan.warnings).toContain(
      'Secret variable API_TOKEN is resolved only by the desktop secret store.',
    )
    expect(execution.executed).toBe(false)
    expect(execution.warnings).toContain(
      'Secret variable API_TOKEN cannot be resolved in browser preview.',
    )
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
  })

  it('exposes permission, import/export, and backup operation manifests for SQL-family engines', () => {
    const operations = buildOperationManifestsForConnection(postgresConnection)

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'postgresql.security.inspect',
        label: 'Inspect Permissions',
        risk: 'diagnostic',
      }),
      expect.objectContaining({
        id: 'postgresql.data.import-export',
        label: 'Import / Export',
        risk: 'costly',
      }),
      expect.objectContaining({
        id: 'postgresql.data.backup-restore',
        label: 'Backup / Restore',
        risk: 'destructive',
      }),
    ]))
  })

  it('generates SQL Server maintenance operation previews', () => {
    const operations = buildOperationManifestsForConnection(sqlServerConnection)

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sqlserver.statistics.update', label: 'Update Statistics', risk: 'costly' }),
      expect.objectContaining({ id: 'sqlserver.index.reorganize', label: 'Reorganize Index', risk: 'costly' }),
      expect.objectContaining({ id: 'sqlserver.index.rebuild', label: 'Rebuild Index', risk: 'costly' }),
      expect.objectContaining({ id: 'sqlserver.query-store.top-queries', label: 'Query Store Top Queries', risk: 'diagnostic' }),
    ]))

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
  })

  it('generates CockroachDB cluster and data-movement operation previews', () => {
    const operations = buildOperationManifestsForConnection(cockroachConnection)

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cockroachdb.cockroach.jobs', label: 'Browse Jobs', risk: 'diagnostic' }),
      expect.objectContaining({ id: 'cockroachdb.cockroach.ranges', label: 'Review Ranges', risk: 'diagnostic' }),
      expect.objectContaining({ id: 'cockroachdb.cockroach.contention', label: 'Analyze Contention', risk: 'diagnostic' }),
      expect.objectContaining({ id: 'cockroachdb.cockroach.backup', label: 'Backup Database', risk: 'costly' }),
      expect.objectContaining({ id: 'cockroachdb.cockroach.restore', label: 'Restore Database', risk: 'destructive' }),
      expect.objectContaining({ id: 'cockroachdb.cockroach.import', label: 'Import Data', risk: 'write' }),
    ]))

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
  })

  it('generates PostgreSQL maintenance operation previews', () => {
    const operations = buildOperationManifestsForConnection(postgresConnection)

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'postgresql.table.analyze', label: 'Analyze Table', risk: 'costly' }),
      expect.objectContaining({ id: 'postgresql.table.vacuum', label: 'Vacuum Table', risk: 'costly' }),
      expect.objectContaining({ id: 'postgresql.index.reindex', label: 'Reindex', risk: 'costly' }),
    ]))

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
  })

  it('generates MySQL-family table maintenance and event operation previews', () => {
    const operations = buildOperationManifestsForConnection(mysqlConnection)

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mysql.table.check', label: 'Check Table', risk: 'diagnostic' }),
      expect.objectContaining({ id: 'mysql.table.analyze', label: 'Analyze Table', risk: 'costly' }),
      expect.objectContaining({ id: 'mysql.table.repair', label: 'Repair Table', risk: 'destructive' }),
      expect.objectContaining({ id: 'mysql.event.enable', label: 'Enable Event', risk: 'write' }),
    ]))

    const snapshot = snapshotWith(mysqlConnection)
    const checkPlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.table.check',
      objectName: '`shop`.`orders`',
    })
    expect(checkPlan.plan.generatedRequest).toBe('check table `shop`.`orders`;')
    expect(checkPlan.plan.requiredPermissions).toEqual(['read metadata/query privilege'])

    const repairPlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.table.repair',
      objectName: '`shop`.`orders`',
    })
    expect(repairPlan.plan.generatedRequest).toBe('repair table `shop`.`orders`;')
    expect(repairPlan.plan.destructive).toBe(true)

    const eventPlan = planOperationLocally(snapshot, {
      connectionId: mysqlConnection.id,
      environmentId: 'env-local',
      operationId: 'mysql.event.disable',
      objectName: '`shop`.`refresh_rollups`',
    })
    expect(eventPlan.plan.generatedRequest).toBe('alter event `shop`.`refresh_rollups` disable;')
  })

  it('generates SQLite local-file maintenance operation previews', () => {
    const operations = buildOperationManifestsForConnection(sqliteConnection)

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sqlite.database.integrity-check', label: 'Integrity Check', risk: 'diagnostic' }),
      expect.objectContaining({ id: 'sqlite.database.vacuum', label: 'Vacuum Database', risk: 'write' }),
      expect.objectContaining({ id: 'sqlite.index.reindex', label: 'Reindex', risk: 'write' }),
    ]))

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

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'timescaledb.timescale.compression-policy', label: 'Compression Policy', risk: 'write' }),
      expect.objectContaining({ id: 'timescaledb.timescale.retention-policy', label: 'Retention Policy', risk: 'destructive' }),
      expect.objectContaining({ id: 'timescaledb.timescale.refresh-continuous-aggregate', label: 'Refresh Aggregate', risk: 'costly' }),
    ]))

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
    expect(compressionPlan.plan.generatedRequest).toBe("select add_compression_policy('public.order_metrics', interval '7 days', if_not_exists => true);")
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
    expect(retentionPlan.plan.generatedRequest).toBe("select add_retention_policy('public.order_metrics', interval '90 days', if_not_exists => true);")
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
    expect(refreshPlan.plan.generatedRequest).toContain("refresh_continuous_aggregate('observability.hourly_order_metrics'")
    expect(refreshPlan.plan.confirmationText).toBeTruthy()
  })

  it('generates DuckDB local analytics operation previews', () => {
    const operations = buildOperationManifestsForConnection(duckDbConnection)

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'duckdb.table.analyze', label: 'Analyze Table', risk: 'costly' }),
      expect.objectContaining({ id: 'duckdb.database.checkpoint', label: 'Checkpoint', risk: 'write' }),
      expect.objectContaining({ id: 'duckdb.extension.load', label: 'Load Extension', risk: 'write' }),
      expect.objectContaining({ id: 'duckdb.file.import', label: 'Import File', risk: 'write' }),
    ]))

    const snapshot = snapshotWith(duckDbConnection)
    const analyzePlan = planOperationLocally(snapshot, {
      connectionId: duckDbConnection.id,
      environmentId: 'env-local',
      operationId: 'duckdb.table.analyze',
      objectName: '"main"."orders"',
    })
    expect(analyzePlan.plan.generatedRequest).toBe('analyze "main"."orders";')
    expect(analyzePlan.plan.requiredPermissions).toEqual(['write/admin privilege for the target object'])

    const extensionPlan = planOperationLocally(snapshot, {
      connectionId: duckDbConnection.id,
      environmentId: 'env-local',
      operationId: 'duckdb.extension.load',
      objectName: 'httpfs',
      parameters: { extensionName: 'httpfs' },
    })
    expect(extensionPlan.plan.generatedRequest).toBe('load httpfs;')

    const importPlan = planOperationLocally(snapshot, {
      connectionId: duckDbConnection.id,
      environmentId: 'env-local',
      operationId: 'duckdb.file.import',
      objectName: '"main"."orders_import"',
      parameters: { sourceFormat: 'csv', tableName: '"main"."orders_import"' },
    })
    expect(importPlan.plan.generatedRequest).toContain('read_csv_auto')
    expect(importPlan.plan.generatedRequest).toContain('create or replace table "main"."orders_import"')
  })

  it('generates search-family profile, index, and security operation previews', () => {
    const snapshot = snapshotWith(searchConnection)
    const operations = buildOperationManifestsForConnection(searchConnection)
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'elasticsearch.index.force-merge', label: 'Force Merge' }),
      expect.objectContaining({ id: 'elasticsearch.index.reindex', label: 'Reindex' }),
      expect.objectContaining({ id: 'elasticsearch.pipeline.put', label: 'Update Pipeline' }),
      expect.objectContaining({ id: 'elasticsearch.snapshot.restore', label: 'Restore Snapshot' }),
    ]))

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
  })

  it('generates DynamoDB capacity, index, access, and export operation previews', () => {
    const snapshot = snapshotWith(dynamoConnection)

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
      tableName: 'Orders',
      metrics: expect.arrayContaining(['ConsumedReadCapacityUnits', 'ReadThrottleEvents']),
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
      globalSecondaryIndexUpdates: [{
        create: {
          indexName: 'customer-status-index',
          keySchema: [{ attributeName: 'customerId', keyType: 'HASH' }],
        },
      }],
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
  })

  it('generates Cassandra tracing, index, permission, and metrics operation previews', () => {
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
    expect(indexPlan.plan.generatedRequest).toContain('using \'StorageAttachedIndex\'')

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
  })

  it('generates native time-series profile, metrics, export, and guarded delete previews', () => {
    const prometheusSnapshot = snapshotWith(prometheusConnection)
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
  })

  it('generates warehouse-native plan, cost, metrics, access, and export operation previews', () => {
    const snowflakeSnapshot = snapshotWith(snowflakeConnection)
    const snowflakeOperations = buildOperationManifestsForConnection(snowflakeConnection)
    expect(snowflakeOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'snowflake.table.clone', label: 'Clone Table', risk: 'write' }),
      expect.objectContaining({ id: 'snowflake.warehouse.suspend', label: 'Suspend Warehouse', risk: 'write' }),
      expect.objectContaining({ id: 'snowflake.warehouse.resume', label: 'Resume Warehouse', risk: 'write' }),
    ]))

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
    expect(bigQueryOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bigquery.table.copy', label: 'Copy Table', risk: 'write' }),
    ]))

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
    expect(clickHouseOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'clickhouse.table.optimize', label: 'Optimize Table', risk: 'costly' }),
      expect.objectContaining({ id: 'clickhouse.table.materialize-ttl', label: 'Materialize TTL', risk: 'costly' }),
      expect.objectContaining({ id: 'clickhouse.table.freeze', label: 'Freeze Table', risk: 'write' }),
    ]))

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

    const liteDbSnapshot = snapshotWith(liteDbConnection)
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
    environments: [{ id: 'env-local', name: 'Local', label: 'Local', risk: 'low', variables: {}, sensitiveKeys: [] }],
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
