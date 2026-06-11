import { describe, expect, it } from 'vitest'
import {
  DATASTORE_FEATURE_BACKLOG,
  type ConnectionProfile,
  type DataEditPlanRequest,
  type DatastoreFeatureBacklogEntry,
} from '@datapadplusplus/shared-types'
import {
  buildDatastoreExperiences,
  planDataEditLocally,
} from '../../../../src/services/runtime/browser-datastore-platform'
import { runtimeSliceForEngine } from '../../../../src/services/runtime/datastores/registry'

const experiencesByEngine = new Map(
  buildDatastoreExperiences().map((experience) => [experience.engine, experience]),
)

describe('datastore runtime data-edit contracts', () => {
  it('routes every editable datastore through a typed runtime slice data-edit hook', () => {
    for (const entry of DATASTORE_FEATURE_BACKLOG) {
      const editableScopes = experiencesByEngine.get(entry.engine)?.editableScopes ?? []
      if (editableScopes.length === 0) continue

      const slice = runtimeSliceForEngine(entry.engine)
      expect(
        typeof slice?.dataEdit?.buildRequest,
        `${entry.engine} declares editable scopes and should expose a data-edit builder`,
      ).toBe('function')

      const editKind = editableScopes[0]?.editKinds[0]
      expect(editKind, `${entry.engine} editable scope should declare an edit kind`).toBeTruthy()

      const request = dataEditRequestFor(entry, editKind)
      const response = planDataEditLocally(connectionFor(entry), request)

      expect(response.connectionId).toBe(request.connectionId)
      expect(response.environmentId).toBe(request.environmentId)
      expect(response.editKind).toBe(editKind)
      expect(response.executionSupport).toBe('plan-only')
      expect(response.plan.engine).toBe(entry.engine)
      expect(response.plan.operationId).toBe(`${entry.engine}.data-edit.${editKind}`)
      expect(response.plan.generatedRequest.trim().length).toBeGreaterThan(0)
      expect(response.plan.requiredPermissions.length).toBeGreaterThan(0)
      expect(response.plan.warnings).toContain(
        'Preview mode generates guarded data-edit plans without mutating the datastore.',
      )
    }
  })
})

function dataEditRequestFor(
  entry: DatastoreFeatureBacklogEntry,
  editKind: DataEditPlanRequest['editKind'],
): DataEditPlanRequest {
  return {
    connectionId: `conn-${entry.engine}`,
    environmentId: 'env-local',
    editKind,
    target: {
      objectKind: objectKindFor(entry),
      path: [entry.displayName, 'catalog', 'products'],
      database: 'catalog',
      schema: entry.engine === 'cassandra' ? 'app' : 'public',
      table: tableFor(entry),
      collection: 'products',
      key: 'catalog:product:1',
      documentId: 'product-1',
      itemKey: { pk: 'catalog', sk: 'product#1' },
      primaryKey: { id: 1 },
    },
    changes: changesFor(editKind),
  }
}

function changesFor(editKind: DataEditPlanRequest['editKind']): DataEditPlanRequest['changes'] {
  if (['delete-row', 'delete-key', 'delete-document', 'delete-item', 'persist-ttl'].includes(editKind)) {
    return []
  }

  if (editKind === 'rename-field') {
    return [{ field: 'status', newName: 'state' }]
  }

  if (editKind === 'set-ttl') {
    return [{ field: 'ttl', value: 3600 }]
  }

  if (editKind === 'stream-delete-entry') {
    return [{ field: '1700000000000-0' }]
  }

  if (editKind === 'timeseries-delete-sample') {
    return [{ value: { from: 1700000000000, to: 1700000060000 } }]
  }

  if (editKind === 'vector-remove-member') {
    return [{ field: 'product-1' }]
  }

  return [{ field: 'status', path: ['status'], value: 'active' }]
}

function objectKindFor(entry: DatastoreFeatureBacklogEntry) {
  if (entry.family === 'keyvalue') return 'key'
  if (entry.family === 'document') return 'collection'
  if (entry.family === 'search') return 'index'
  return 'table'
}

function tableFor(entry: DatastoreFeatureBacklogEntry) {
  if (entry.family === 'search') return 'products'
  if (entry.engine === 'dynamodb') return 'Products'
  return 'products'
}

function connectionFor(entry: DatastoreFeatureBacklogEntry): ConnectionProfile {
  return {
    id: `conn-${entry.engine}`,
    name: `${entry.displayName} data-edit connection`,
    engine: entry.engine,
    family: entry.family,
    host: 'localhost',
    port: entry.defaultPort,
    database: entry.family === 'keyvalue' ? '0' : 'catalog',
    connectionString: undefined,
    connectionMode: entry.connectionModes[0] ?? 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: entry.engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
