import type { ConnectionProfile, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { buildOperationManifestsForConnection, planOperationLocally } from './browser-operations'

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
        roles: [{ role: 'read', db: 'catalog' }],
      },
    })

    expect(JSON.parse(userPlan.plan.generatedRequest)).toMatchObject({
      database: 'catalog',
      createUser: 'reporting',
      pwd: '********',
      roles: [{ role: 'read', db: 'catalog' }],
    })
    expect(userPlan.plan.generatedRequest).not.toContain('password')
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
