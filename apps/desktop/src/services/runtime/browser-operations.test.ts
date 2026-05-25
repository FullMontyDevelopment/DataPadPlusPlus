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
})

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
